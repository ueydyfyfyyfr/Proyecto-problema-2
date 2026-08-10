# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
node server.js          # Servidor estático en http://localhost:3000
node build_bundle.js    # OBLIGATORIO tras cualquier cambio en js/ — regenera bundle.js
```

No hay `package.json`, gestor de dependencias ni linter. **La restricción de "cero dependencias" es deliberada** (TASKS.md S-3): no ejecutes `npm install` ni introduzcas librerías externas.

Pruebas: no existen todavía. La estrategia acordada (TASKS.md T-F3-5) es `tests/*.test.mjs` con el runner integrado de Node — `node --test tests/stats-engine.test.mjs` — sin instalar nada. El directorio `tests/` no debe entrar en `build_bundle.js`.

Credenciales de la sesión por defecto (precargadas en el formulario de login): `admin` / `admin123`.

## Arquitectura

Aplicación web de una sola página que simula una planta industrial ciberfísica (celda de distribución con 4 cintas, plataforma giratoria y tolva) más un PLC con firewall OT.

### El bundle es lo que se ejecuta

`index.html:658` carga **`bundle.js`**, no los módulos ES6. `build_bundle.js` concatena `js/*.js` en el orden declarado en su array `FILES`, elimina las líneas `import`/`export` con expresiones regulares y envuelve todo en una IIFE. Consecuencias:

- **Un cambio en `js/` no se ve en el navegador hasta ejecutar `node build_bundle.js`.** Es el error más fácil de cometer aquí.
- El *stripping* es textual: `import`/`export` deben estar al inicio de línea y con la forma que la regex reconoce. Un `export` en medio de una expresión rompe el bundle en silencio.
- Los módulos nuevos deben añadirse al array `FILES` **en orden de dependencia** (antes de sus consumidores; `js/app.js` va siempre último).
- Como todo acaba en un único scope, dos módulos no pueden declarar el mismo nombre de nivel superior (p. ej. `PLC_SHARED_SECRET` está duplicado a propósito en `hmi-controller.js` y `plc-simulation.js` — ambos usan `var`, no `const`).

### Frontera HMI ↔ PLC

El punto arquitectónico central: el HMI **nunca** muta `PLC_STATE` directamente. Todo pasa por una frontera de red simulada.

```
app.js  →  sendSecureCommand()      [hmi-controller.js]
             firma payload con HMAC-SHA256 + nonce + timestamp
           handleNetworkMessage()   [plc-simulation.js]  ← "firewall OT"
             verifica HMAC → nonce no visto → timestamp dentro de 60 s
           executeCommand()         → muta PLC_STATE
```

Cualquier fallo de verificación llama a `triggerSecurityLockdown()`, que apaga todos los motores y deja la planta bloqueada hasta un comando `SECURITY_RESET`. Los tres botones de ataque de la pestaña Seguridad (`app.js`, "unsigned" / "tampered" / "replay") inyectan tramas directamente en `handleNetworkMessage()` saltándose `sendSecureCommand()` — así es como se demuestra que el firewall funciona. Al añadir comandos nuevos, añádelos al `switch` de `executeCommand()`, nunca como llamada directa desde la UI.

### Bucle de simulación

`initSimulation(onStateUpdate)` arranca un `setInterval` a 20 ms (50 FPS) que ejecuta, en este orden:

1. `updateStats(dt)` — envuelto en `try/catch` a propósito: la estadística nunca puede detener el control.
2. `updatePhysics(dt)` — mueve ángulo, tolva y partículas; deriva los finales de carrera (`FC1..FC3`, `FCTolAb/Ce`) del estado físico, **no al revés**.
3. `updatePLCLogic(dt)` — máquina de estados (`IDLE → ROTATING → RUNNING → DISCHARGING_C0 → DISCHARGING_DEST`, más `ALARM` y `EMERGENCY_LOCK`).
4. `onStateUpdate(PLC_STATE)` → `updateUI()` en `app.js`, que redibuja el canvas y los LEDs.

`PLC_STATE` es un singleton exportado y mutado in situ; la UI lee de él en cada tick. Los detectores de flanco (`prevMotorState`, `prevEffectiveState`) son módulo-globales y se reinician en `initSimulation()`.

**La persistencia no ocurre en el bucle.** `flushMetrics()` se invoca por temporizador cada 5 s y en eventos clave (cierre de ciclo, alarma, lockdown, logout). Escribir en `localStorage` a 50 Hz degradaba la UI — no reintroduzcas escrituras por tick.

### Estadística: `PLC_STATE.stats`

Contrato completo documentado en `TASKS.md §6.1`. Reglas que ya están implementadas y hay que respetar:

- `unitsTransferred` cuenta partículas entregadas; `batchesProcessed` cuenta **ciclos productivos cerrados** (`finishProductionCycle()`), y solo si el ciclo llegó a entregar material. No son intercambiables.
- El desglose por motor (`motorKWh`) y el total de planta (`powerConsumptionKWh`) se acumulan en el **mismo recorrido** para que cuadren por construcción.
- `plcStats` y `plcMetrics` son dos claves de `localStorage` que deben tratarse como una unidad: borrar una sin la otra descuadra la energía de forma permanente (TASKS.md N-7).
- `effectiveState()` reporta `SECURITY_LOCKDOWN` como estado superpuesto que prevalece sobre `control.status`.
- `mergeSavedStats()` hace merge defensivo sobre la estructura por defecto: ampliar el contrato no rompe datos antiguos.

### Autenticación y RBAC

Dos capas, con nombres parecidos y significados distintos:

- **Rol** (`Admin | Gerente | Supervisor | Operador`) — jerarquía estricta tipo pirámide ISA-95. Cada rol solo puede crear el nivel inmediatamente inferior (validado en `createUser()` en `auth.js`), y `applyRBACPermissions()` muestra/oculta pestañas según el rol.
- **Capacidades** (`CONTROL_MANUAL`, `CHANGE_SETPOINTS`) — solo aplican al Operador, se asignan con checklist al crearlo y las lee `checkPermission()`.

Separación de funciones OT: **Admin y Gerente no operan la planta** — `checkPermission('BASIC_CONTROL')` solo es cierto para Supervisor u Operador con `CONTROL_MANUAL`. Si los mandos aparecen deshabilitados con la sesión `admin` por defecto, es el comportamiento diseñado (ver el aviso de `#control-permission-hint`), no un fallo.

Contraseñas: PBKDF2-SHA256, 100 000 iteraciones, salt de 16 bytes por usuario, vía Web Crypto API. Nunca en texto plano. `loadUsersDB()` intenta en cascada `fetch('./usuarios.json')` → `localStorage['usuarios_json']` → array embebido en `auth.js`; ese último *fallback* existe para que la app funcione abierta con `file://` sin servidor, y por eso el bundle es auto-contenido.

Usuarios creados desde el HMI viven en `localStorage['dynamic_users_pbkdf2']`, no en `usuarios.json` (que se descarga/importa manualmente desde la pestaña Usuarios). Tras cualquier alta o baja hay que llamar a `invalidateCache()`.

### Comunicación entre módulos

Además de las llamadas directas, hay eventos `CustomEvent` en `window` a los que la UI se suscribe: `audit-log-updated`, `network-traffic-updated`, `plc-state-change`, `plc-alarm`, `plc-lockdown`. Al instrumentar algo nuevo, emitir un evento es preferible a que `plc-simulation.js` toque el DOM — ese módulo no debe conocer la UI.

`js/audit-log.js` mantiene el array en memoria como fuente de verdad (máx. 500 entradas, orden cronológico inverso) y solo lee `localStorage` una vez; el listener de `storage` lo recarga si otra pestaña escribe.

### Claves de `localStorage`

`currentUser` · `usuarios_json` · `dynamic_users_pbkdf2` · `auditLogs` · `plcConfig` · `plcMetrics` · `plcStats` · `businessConfig`

## Documentos del repositorio

- **`TASKS.md`** — plan de implementación por fases (F0…F8) con tareas de ID estable (`T-F3-1`). F0 y F1 están completadas; F2–F8 pendientes. Contiene los contratos de datos (§6) que las fases futuras no deben reinterpretar, y los hallazgos `N-1…N-7`. **Consúltalo antes de trabajar en métricas, KPIs, historial o el asistente IA**, y marca los checkboxes conforme avances.
- `DOCUMENTACION.md` — documentación técnica funcional (roles, criptografía, flujos).
- `INFORME_PROYECTO.md`, `INFORME_DASHBOARD_METRICAS.md` — informes académicos; el segundo es el origen del plan de TASKS.md.

El proyecto es un trabajo académico en español: comentarios, mensajes de log, identificadores de dominio (`PMARCHA`, `MTolAb`, `VigC1`) y textos de UI están en español. Mantén ese idioma.
