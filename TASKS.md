# TASKS.md — Plan de implementación por fases

**Proyecto:** HMI Ciberfísico / Celda de Distribución (Problema 2)
**Origen:** `INFORME_DASHBOARD_METRICAS.md` (8 ago 2026)
**Fecha del plan:** 9 de agosto de 2026
**Estado:** planificación. **Este documento no contiene código y no se ha modificado ningún archivo del proyecto.**

---

## 0. Cómo usar este documento

- Cada fase (**F0…F8**) es un *issue ejecutable*: contiene su interpretación técnica, hechos verificados en el código, supuestos, tareas con ID y criterios de aceptación.
- **Las tareas, los criterios de aceptación y las definiciones de terminado son checkboxes.** Márcalos cambiando `- [ ]` por `- [x]` conforme avances.
- Los IDs de tarea (`T-F1-3`) son estables: úsalos en commits y PRs para mantener trazabilidad.
- Los identificadores `P-1…P-12` son los problemas del informe original; `N-1…N-5` son hallazgos nuevos detectados al verificar el código para este plan (§2).
- Los identificadores `A-1…G-6` son métricas del catálogo del informe (§4 del informe).
- **Regla operativa que aplica a TODA tarea que toque `js/`:** ejecutar `node build_bundle.js` antes de probar en el navegador. `index.html:649` carga `bundle.js`, no los módulos ES6.

### Convención de estimaciones
`XS` ≤ 30 min · `S` ≈ 1–2 h · `M` ≈ 3–6 h · `L` ≈ 1–2 días · `XL` > 2 días

---

## 1. Tablero de progreso

**55 tareas repartidas en 9 fases.** Marca la fase completa solo cuando su "Definición de terminado" esté verificada.

- [x] **F0** — Correcciones de fiabilidad previas · 12 tareas · `M` · **Crítica**
- [x] **F1** — Instrumentación `PLC_STATE.stats` · 8 tareas · `M` · Alta
- [x] **F2** — `history-store.js` · 3 tareas · `S` · Alta
- [ ] **F3** — `stats-engine.js` · 5 tareas · `M` · Alta
- [ ] **F4** — `charts.js` (SVG) · 4 tareas · `M` · Media
- [ ] **F5** — Pestaña "Analítica & IA" + KPIs reales · 8 tareas · `L` · Alta
- [ ] **F6** — `n8n-connector.js` + trazabilidad IA · 4 tareas · `M` · Media
- [ ] **F7** — Widget de chat + modo degradado · 5 tareas · `M` · Media
- [ ] **F8** — Workflows n8n + despliegue · 6 tareas · `L` · Media

**Hito mínimo demostrable (MVP):** F0 + F1 + F3 + F5 reducida (solo tarjetas KPI, sin gráficos).

- [ ] **MVP alcanzado**

---

## 2. Resumen ejecutivo

| Fase | Contenido | Categoría principal | Severidad | Prioridad | Esfuerzo | Confianza | Bloquea a |
|---|---|---|---|---|:---:|:---:|---|
| **F0** | Correcciones de fiabilidad previas (P-1, P-2, P-6, P-8, P-10, P-11 + N-1…N-5) | Calidad de datos / Seguridad | **Crítica** | Inmediata | M | Alta | Todo |
| **F1** | Instrumentación `PLC_STATE.stats` | Lógica de negocio / Observabilidad | Alta | Inmediata | M | Alta | F2, F3 |
| **F2** | `history-store.js` (serie temporal) | Arquitectura / Datos | Alta | Alta | S | Alta | 14 métricas 🔴, memoria del chat |
| **F3** | `stats-engine.js` (KPIs puros) | Lógica de negocio | Alta | Alta | M | Alta | F5, F7 |
| **F4** | `charts.js` (SVG sin dependencias) | Frontend | Media | Normal | M | Media | F5 |
| **F5** | Pestaña "Analítica & IA" + reconstrucción de "KPIs & Negocio" | Frontend / UX | Alta | Alta | L | Media | — |
| **F6** | `n8n-connector.js` + tipo de log `AI_INTERACTION` | API/Integración / Seguridad | Media | Normal | M | Media | F7 |
| **F7** | Widget de chat + modo degradado por reglas | Frontend / Seguridad | Media | Normal | M | Media | — |
| **F8** | Workflows n8n (WF-1…WF-5) + despliegue estático | Infraestructura / DevOps | Media | Baja | L | **Baja** | — |

**Confianza global del análisis: alta** para F0–F3 (verificado línea a línea en el código), **media** para F4–F7 (diseño nuevo, sin código previo que contrastar), **baja** para F8 (depende de infraestructura n8n que no consta en el repositorio).

---

## 3. Hallazgos nuevos (no recogidos en el informe original)

Detectados al verificar el código para redactar este plan. Se incorporan a F0 porque afectan a la fiabilidad de las métricas o a la demostrabilidad del sistema.

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| **N-1** | **Ningún rol Admin ni Gerente pasa `checkPermission('BASIC_CONTROL')`.** Solo devuelve `true` para `Supervisor` o `Operador` con `CONTROL_MANUAL`. La sesión por defecto es `admin`, y `applyRBACPermissions()` deshabilita Marcha/Paro/Selec/Emergencia/Reset-CI. | `auth.js:308-309` vs `app.js:321-326`, `app.js:420-421` | El evaluador entra como `admin` y **no puede operar la planta**. Sin operar la planta no se generan datos y ninguna métrica se puebla. Es bloqueante para toda demo. |
| **N-2** | **El rol `Ingeniero` no existe pero el código lo consulta.** `createUser()` solo admite `Admin\|Gerente\|Supervisor\|Operador`, pero `app.js` ramifica por `'Ingeniero'` en tres sitios. | `auth.js:204` vs `app.js:304`, `app.js:332`, `app.js:369` | La rama `app.js:332` (precargar setpoints en el panel de Ingeniería) **nunca se ejecuta**: los inputs de configuración salen vacíos. Afecta a D-3 (vaciado real vs. setpoint). |
| **N-3** | **Tormenta de alarmas posible.** La evaluación de vigilancia no excluye el estado `ALARM`. Si un Supervisor fuerza `MC0=true` (`FORCE_ACTUATOR`) mientras `VigC0=false`, `triggerAlarm()` se dispara **cada 20 ms**, y cada llamada hace `logEvent()` → `JSON.stringify` de hasta 500 entradas a `localStorage`. | `plc-simulation.js:273-283`, `:275`, `audit-log.js:34-41` | 50 escrituras/s a `localStorage` + inflado artificial de `alarmCount` → **MTBF y MTTR (C-3/C-4) quedarían falseados** justo por el escenario que se usará para demostrarlos. |
| **N-4** | **`getLogs()` re-parsea `localStorage` en cada llamada.** `loadLogs()` hace `JSON.parse` de hasta 500 eventos y reemplaza el array en memoria. | `audit-log.js:6-15`, `:48-51` | Si `stats-engine` consulta el log a 1 Hz para E-*/F-*, se paga un `JSON.parse` de ~500 objetos por segundo. Debe cachearse o invalidarse por evento. |
| **N-5** | **No hay `package.json` ni runner de pruebas** en el repositorio. Los módulos usan `export` ES6 pero Node los interpretaría como CommonJS. | `ls` raíz del proyecto; `js/*.js` | La estrategia de pruebas debe definirse explícitamente (§F3, T-F3-5), o las funciones "puras y deterministas" de `stats-engine.js` quedarán sin verificar. |

### Hallazgo posterior, detectado al verificar F0

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| **N-6** | **`renderNetworkTraffic()` revienta con las tramas de ataque sin firma.** La rama de paquete enviado hace `t.data.hmac.slice(0, 10)` sin comprobar que exista, pero el ataque de "trama no firmada" construye deliberadamente `{ payload }` **sin `hmac`**. | `app.js:128` (línea idéntica en `HEAD`, anterior a este trabajo) vs `app.js:738` | `TypeError` en consola y **la tabla de tráfico de red deja de pintarse** desde ese momento. Rompe justo la demo de ciberseguridad, y afecta a las métricas E-1/E-2 que F5 tomará de esa tabla. |

| **N-7** | **`plcStats` y `plcMetrics` son dos claves que pueden desincronizarse.** El desglose por motor vive en `plcStats` y el total de planta en `plcMetrics` (esta última conservada por compatibilidad con `app.js:71-77`). Borrar una sin la otra deja `Σ motorKWh` y `powerConsumptionKWh` descuadrados **de forma permanente**. | Detectado al verificar F1: borrar solo `plcStats` produjo un descuadre del **78,8 %**, frente al 0,000000 % con ambas limpias. | El cuadre de energía es un criterio de aceptación de F1 y la base de B-2. Cualquier reinicio de estadísticas debe tratar ambas claves como una unidad. **Corregido en el plan:** T-F5-7 pasa a limpiar `plcMetrics` además de `plcStats` y `plcHistory`. |

> **N-6 no corregido:** queda fuera del alcance declarado de F0 (no es ninguno de P-1…P-12 ni N-1…N-5). Se asigna a **T-F5-8**, que ya toca `renderNetworkTraffic` y la persistencia del tráfico. La corrección es una guarda de una línea; puede adelantarse a F0 si se prefiere.

### Correcciones menores al informe original

- **E-2 está más avanzada de lo indicado.** El informe la marca 🟡. `logEvent()` ya acepta `details` (`audit-log.js:24`) y `triggerSecurityLockdown()` ya pasa `{ reason, detailMsg }` estructurado (`plc-simulation.js:679`). **E-2 es 🟢 desde el log**, sin contador nuevo. El contador de F1 sigue siendo útil como agregado rápido, pero no es bloqueante.
- **P-11 es peor de lo descrito.** El informe dice que el único usuario real es `admin / admin123`; correcto, pero la pantalla anuncia además `admin / manager123` (`index.html:57`), es decir **también la contraseña del admin anunciado es incorrecta**, pese a que `app.js:420-421` autocompleta la correcta.

---

## 4. Supuestos y decisiones tomadas por defecto

El informe cerraba con 6 decisiones pendientes (§9). Para que este plan sea ejecutable sin bloqueo, se adopta la recomendación del propio informe en cada una. **Todas son reversibles**; si el usuario decide lo contrario, se indica qué tareas cambian.

| # | Decisión adoptada | Justificación | Tareas afectadas si se cambia |
|---|---|---|---|
| S-1 | **Corregir `batchesProcessed` (P-1)** y conservar `unitsTransferred` como métrica secundaria. | Sin esto, OEE, kWh/lote y coste/lote no tienen sentido. | T-F0-1, T-F1-4 |
| S-2 | **Pestaña nueva "Analítica & IA"**; "KPIs & Negocio" queda como vista ejecutiva del Gerente. | Recomendación del informe §9.2. | Toda F5 |
| S-3 | **Gráficos SVG propios, sin dependencias.** | RNF-10 prohíbe `npm install`; el repositorio no tiene `package.json` (N-5), lo que confirma la restricción. | Toda F4 |
| S-4 | **Persistencia en `localStorage`** con buffer circular, no IndexedDB. | 2 000 muestras ≈ 250 KB frente a un límite de ~5 MB. | Toda F2 |
| S-5 | **Widget de chat flotante global**, no pestaña dedicada. | Permite preguntar mientras se observa el proceso. | Toda F7 |
| S-6 | **El chat se construye primero contra el modo degradado local**; el conector n8n se enchufa después. | No consta ninguna URL de webhook ni configuración de n8n en el repositorio. **Supuesto de confianza media**: si ya existe instancia n8n, F6 y F8 pueden adelantarse. | F6, F7, F8 |
| S-7 | **La tarifa eléctrica y el factor de CO₂ pasan a un bloque de configuración de negocio** persistido en `localStorage`, con los valores actuales como defecto (0,15 USD/kWh). | Hoy está *hardcoded* en `app.js:76`. | T-F0-7 |

---

## 5. Orden de implementación y ruta crítica

```
F0 ──► F1 ──► F2 ──► F3 ──► F5
        │             ▲      ▲
        │             │      │
        └─────────────┘      │
                    F4 ──────┘

F3 ──► F6 ──► F7        F8 (independiente, al final)
```

**Ruta crítica:** `F0 → F1 → F3 → F5`.
**Paralelizable:** F4 puede desarrollarse en paralelo a F1–F3 (no depende de datos reales; se prueba con datos sintéticos). F6 puede empezar en cuanto F3 exponga su contrato.

---

## 6. Contratos de datos compartidos

> Estos contratos son **propuesta de diseño** derivada de §5.1–5.3 del informe, no código existente. Se fijan aquí para que las fases F1, F2, F3, F5 y F7 no reinterpreten los nombres de campo. Cualquier cambio debe hacerse en este apartado y propagarse.

### 6.1 `PLC_STATE.stats` (creado en F1)

```
stats: {
  totalElapsedSeconds,          // tiempo de calendario desde initSimulation — resuelve P-2
  sessionStartedAt,             // epoch ms (G-5) — NO se restaura entre sesiones
  stateTime: {                  // segundos acumulados por estado
    IDLE, ROTATING, RUNNING, DISCHARGING_C0, DISCHARGING_DEST,
    ALARM, EMERGENCY_LOCK, SECURITY_LOCKDOWN
  },
  stateEntries: { ...mismos 8 estados... },   // nº de entradas a cada estado (para D-9)
  alarmCount:  { C0, C1, C2, C3 },            // incrementado POR FLANCO en triggerAlarm()
  firstAlarmAt, lastAlarmAt,                  // epoch ms | null
  motorSeconds:{ MC0, MC1, MC2, MC3, MGIzq, MGDer, MTolAb, MTolCe },
  motorKWh:    { ...mismas 8 salidas... },
  motorCycles: { ...mismas 8 salidas... },    // flancos de subida
  unitsTransferred,                           // partículas C0 → destino (A-2)
  batchesByDest: { 1, 2, 3 },                 // ciclos productivos por destino (A-4)
  scrapCount,                                 // partículas perdidas con destino parado (P-7 → A-5)
  commandCounts:    { <COMANDO>: n },         // comandos recibidos y verificados, por tipo
  rejectedCommands: { <COMANDO intentado>: n },// comandos rechazados, por comando
  securityEvents: {                           // rechazos por tipo de ataque
    COMANDO_NO_FIRMADO, INTEGRIDAD_COMPROMETIDA,
    ATAQUE_REPLAY_DETECTADO, TRAMA_EXPIRADA, FORMATO_CORRUPTO
  },
  lockdownCount,                              // ENTRADAS en bloqueo, no rechazos
  hopperCycles,                               // flancos de FCTolAb (D-4)
  totalDegreesRotated,                        // integral de |Δ currentAngle| (D-6)
  loop: { ticks, avgDtMs, maxDtMs, jitterMs } // salud del bucle (G-1/G-2) — NO se restaura
}
```

**Tres desviaciones respecto al contrato original, decididas al implementar F1:**

1. **`SECURITY_LOCKDOWN` como octavo estado.** `control.securityLockdown` es un modo superpuesto: mientras dura, `control.status` conserva el valor que tuviera al producirse la intrusión (por ejemplo `RUNNING`), pero la planta está parada. Sin un estado propio, el tiempo de bloqueo inflaba la disponibilidad. El estado *efectivo* que se contabiliza es `securityLockdown ? 'SECURITY_LOCKDOWN' : control.status`.
2. **`rejectedCommands` se indexa por comando intentado, no por motivo.** Con el motivo, este mapa habría sido una copia exacta de `securityEvents`, porque las cuatro ramas de rechazo de `handleNetworkMessage()` pasan por `triggerSecurityLockdown()` con uno de los 5 motivos. Indexado por comando aporta información que no existe en ningún otro sitio ("¿qué intentaron ejecutar?") y E-1 sigue siendo `Σ commandCounts` vs `Σ rejectedCommands`.
3. **Bloque `loop` añadido.** El contrato §6.3 exige `system.fps` y `system.jitterMs`, pero §6.1 no preveía dónde acumular la materia prima. `loop` y `sessionStartedAt` describen la sesión en curso y **no se restauran** desde `localStorage`.

**Además:** `lockdownCount` cuenta *entradas* en bloqueo, no rechazos. Un segundo ataque con el firewall ya cerrado suma en `securityEvents` pero no en `lockdownCount`.

**Nota de compatibilidad:** `physical.batchesProcessed`, `physical.runTimeSeconds` y `physical.powerConsumptionKWh` **se conservan** con sus nombres actuales para no romper `app.js:71-77`. Cambia solo la *semántica* de `batchesProcessed` (S-1).

### 6.2 Muestra de historial (creada en F2)

Una muestra cada 5 s, buffer circular de 2 000 muestras, clave `plcHistory`:

```
{ t, status, batches, units, scrap, kWh, activeMotors, alarmCount }
```
`t` = epoch ms · `status` = string del estado · `alarmCount` = total agregado de las 4 cintas.

**Precisiones fijadas al implementar F2:**

1. **`status` es el estado *efectivo***, es decir `effectiveState()` de `plc-simulation.js` (`securityLockdown ? 'SECURITY_LOCKDOWN' : control.status`), coherente con la desviación 1 de §6.1. `effectiveState` y `MOTOR_KEYS` pasan a ser exportaciones públicas del módulo de simulación.
2. **`batches`, `units`, `scrap` y `kWh` son acumulados absolutos**, no incrementos por intervalo. F3 debe derivar los ritmos restando extremos de la ventana. Por eso `downsample()` toma el último punto de cada tramo en lugar de promediar: promediar rompería la monotonía.
3. **API real del módulo:** a las cinco funciones de §5.2 del informe se añaden `flushHistory()` (consolida la escritura agrupada pendiente; se invoca sola al ocultarse la pestaña) y `historyCount()` (número de muestras, para que F3 decida `meta.degraded` sin materializar `range()`). Todas se exponen también en la fachada `HistoryStore`, **que es la vía recomendada de consumo**: `build_bundle.js` funde todos los módulos en un ámbito único y los nombres sueltos `push`, `range` y `clear` son colisionables.
4. **Muestra malformada = muestra descartada.** `push()` normaliza al contrato y devuelve `null` si falta `t` o no es fecha; los campos numéricos ausentes caen a `0` y `status` a `'DESCONOCIDO'`. Ningún `NaN` puede entrar en la serie.

### 6.3 Objeto de KPIs (devuelto por `stats-engine.js` en F3)

```
{
  production:  { batches, units, scrap, qualityRate, throughputPerMin, byDest },
  availability:{ availability, mtbfSeconds, mttrSeconds, stateTimePct, alarmsByBelt },
  energy:      { totalKWh, instantKW, byMotor, kWhPerBatch, costUSD, costPerBatch, co2Kg },
  oee:         { availability, performance, quality, oee },
  security:    { accepted, rejected, byReason, lockdowns, forcedActuators, injectedFaults },
  maintenance: { byActuator: [{ id, hours, cycles, wearPct, hoursToService }] },
  system:      { fps, jitterMs, storageBytes, logFill, uptimeSeconds },
  meta:        { computedAt, windowSeconds, degraded }
}
```

`degraded: true` indica que faltó historial suficiente y algunos campos son `null`. **Ningún consumidor debe asumir que todos los campos son numéricos.**

---

# 7. Fases

---

## F0 — Correcciones de fiabilidad previas

> Original (informe §8): *"F0 — Correcciones previas: P-1, P-2, P-6, P-8, P-10, P-11 | Tamaño S | Bloquea a: todo el catálogo"*
> **Ajuste de este plan:** el tamaño real es **M**, no S, al incorporarse N-1…N-5.

### Resumen

Hoy los tres contadores existentes miden cosas distintas de lo que su nombre indica, la sesión no transporta capacidades, la escritura a disco ocurre 50 veces por segundo y las credenciales anunciadas no funcionan. Afecta a cualquiera que abra la aplicación (evaluador incluido) y contamina **todas** las métricas aguas abajo. Ninguna fase posterior puede confiar en los datos hasta que F0 esté cerrada.

### Interpretación técnica expandida

Cinco defectos independientes con una consecuencia común — datos no confiables — más dos de acceso que impiden generar datos:

1. `batchesProcessed` se incrementa una vez por partícula transferida (`plc-simulation.js:204`), con generación de partículas a `Math.random() < 0.15` por tick de 20 ms (`:182`) ⇒ ~7,5 incrementos/s. El nombre promete "lotes".
2. `runTimeSeconds` solo avanza si `activeMotorsCount > 0` (`:232-233`) ⇒ no sirve como denominador de disponibilidad.
3. `localStorage.setItem('plcMetrics', …)` está dentro de ese mismo bloque (`:239`) ⇒ serialización a 50 Hz mientras la planta opera.
4. `login()` construye la sesión con 4 campos y **omite `capabilities`** (`auth.js:158-163`), pero `checkPermission()` la lee (`auth.js:305`) ⇒ siempre `[]`.
5. `receivedNonces` es un `Set` que solo crece (`plc-simulation.js:94`, `:551`); `maxNonceAgeMs` se usa para validar la trama pero nunca para purgar.
6. Credenciales anunciadas ≠ credenciales reales (`index.html:57-59`).
7. Con la sesión `admin` por defecto, los botones de control quedan deshabilitados (N-1).

### Clasificación

- **Categoría principal:** Calidad de datos
- **Secundarias:** Seguridad · Rendimiento · Lógica de negocio · Experiencia de usuario
- **Severidad:** Crítica — **Prioridad:** Inmediata — **Confianza:** Alta (todo verificado línea a línea)

### Hechos confirmados

- `plc-simulation.js:182` genera partículas con probabilidad 0,15/tick; `:204` incrementa `batchesProcessed` por partícula.
- `plc-simulation.js:194-209`: si `destMotor` es falso, la partícula se elimina (`return false`) **sin contabilizar** (P-7).
- `plc-simulation.js:232-244`: `runTimeSeconds`, `powerConsumptionKWh` y el `setItem` viven todos bajo `if (activeMotorsCount > 0)`.
- `auth.js:158-163`: el objeto de sesión no incluye `capabilities`.
- `auth.js:308-309`: `BASIC_CONTROL` excluye a `Admin` y `Gerente`.
- `auth.js:204`: roles válidos = `Admin, Gerente, Supervisor, Operador`. `app.js:304/332/369` consultan `'Ingeniero'`.
- `plc-simulation.js:273-283`: la guarda de evaluación de vigilancia excluye `IDLE`, `ROTATING` y `EMERGENCY_LOCK`, **no** `ALARM`.
- `index.html:57-59` vs `app.js:420-421`: credenciales anunciadas incorrectas.
- `audit-log.js:6-15,48-51`: `getLogs()` re-parsea `localStorage` en cada llamada.

### Supuestos

- **Un "lote" = un ciclo productivo `RUNNING → IDLE` que entregó ≥ 1 unidad.** Es la definición más defendible con la máquina de estados actual. *Alternativa descartada:* contar aperturas completas de tolva — más simple pero cuenta lotes que no entregaron nada.
- Admin y Gerente **no** deben poder operar la planta (separación de funciones OT). La corrección de N-1 es de **UX**, no de permisos: ver T-F0-5.

### Posibles causas / consideraciones

El contador se colocó en el punto de transferencia física porque era el único sitio donde "algo llega al destino". La corrección no es mover el contador sino **añadir un nivel de agregación**: la partícula sigue siendo el evento físico (`unitsTransferred`), el lote pasa a ser el evento de negocio.

### Información que verificar

- ¿Existen capturas o vídeos ya entregados que muestren el valor actual de "Lotes Procesados"? Determina si hay que documentar el cambio de semántica en `DOCUMENTACION.md`. → §8 Q1.

### Solución recomendada

Corregir en el sitio, sin refactor estructural. F0 no introduce módulos nuevos: solo modifica `plc-simulation.js`, `auth.js`, `audit-log.js`, `app.js` e `index.html`.

### Tareas (12)

**Bloque A — Simulación**

- [x] **T-F0-1 — Redefinir `batchesProcessed` y añadir `unitsTransferred`** · `S`
  - **Objetivo:** que "Lotes Procesados" cuente ciclos productivos, no partículas.
  - **Descripción:** en `plc-simulation.js:204`, sustituir el incremento por `unitsTransferred++` y marcar una bandera `cycleProducedMaterial`. En la transición `DISCHARGING_DEST → IDLE` (`:379`), si la bandera está activa, incrementar `batchesProcessed` y `batchesByDest[activeDest]`, y limpiar la bandera.
  - **Área:** Lógica de negocio (simulación) · **Archivos:** `js/plc-simulation.js`
  - **Dependencias:** ninguna
  - **Criterios de aceptación:** tras un ciclo Marcha→Paro→IDLE completo con material entregado, `batchesProcessed` incrementa exactamente 1. `unitsTransferred` refleja el número de partículas.
  - **Pruebas:** manual — 3 ciclos completos ⇒ `batchesProcessed === 3`. Un ciclo abortado sin material entregado **no** incrementa.
  - **Riesgos:** `app.js:72` lee `state.physical.batchesProcessed`; conservar la ruta exacta evita tocar la UI. Un `RESET_CI` a mitad de ciclo debe limpiar la bandera.

- [x] **T-F0-2 — Contabilizar el scrap (P-7)** · `XS`
  - **Objetivo:** dejar de perder información de calidad.
  - **Descripción:** en el `filter` de `plc-simulation.js:194-209`, la rama en que `destMotor` es falso incrementa `stats.scrapCount` antes de descartar la partícula.
  - **Área:** Lógica de negocio · **Archivos:** `js/plc-simulation.js`
  - **Dependencias:** T-F1-1 (el bloque `stats` debe existir). *Puede implementarse con una variable temporal si se ejecuta antes de F1.*
  - **Criterios de aceptación:** forzar `MC0=true` con el motor de destino apagado ⇒ `scrapCount` crece mientras `unitsTransferred` no.
  - **Riesgos:** ninguno; la rama ya existe, solo se añade el contador.

- [x] **T-F0-3 — Añadir `totalElapsedSeconds` (P-2)** · `XS`
  - **Objetivo:** disponer del denominador real de disponibilidad.
  - **Descripción:** acumular `dt` en `updatePhysics()` **fuera** del `if (activeMotorsCount > 0)`. No modificar `runTimeSeconds`, que conserva su semántica de "tiempo en régimen activo" ya mostrada en la UI (`app.js:71`).
  - **Área:** Lógica de negocio · Observabilidad · **Archivos:** `js/plc-simulation.js`
  - **Criterios de aceptación:** `totalElapsedSeconds` avanza con la planta en `IDLE`; `runTimeSeconds` no.

- [x] **T-F0-4 — Escritura periódica en lugar de 50 Hz (P-6)** · `S`
  - **Objetivo:** eliminar la serialización a `localStorage` 50 veces por segundo.
  - **Descripción:** extraer el `setItem` de `plc-simulation.js:239` a una función `flushMetrics()` invocada por un temporizador de 5 s y, además, en eventos clave: entrada en `IDLE`, `triggerAlarm()`, `triggerSecurityLockdown()` y `logout()`.
  - **Área:** Rendimiento · **Archivos:** `js/plc-simulation.js`, `js/auth.js` (llamada en `logout`)
  - **Criterios de aceptación:** con la planta en marcha, las escrituras a `plcMetrics` en 10 s son ≤ 3, no ~500. Recargar no pierde más de 5 s de acumulados.
  - **Pruebas:** instrumentar temporalmente `localStorage.setItem` con un contador en consola.
  - **Riesgos:** pérdida de hasta 5 s ante cierre abrupto de pestaña. Mitigación aceptada: `beforeunload` es poco fiable; **no** se añade.

- [x] **T-F0-8 — Purgar `receivedNonces` por antigüedad (P-10)** · `S`
  - **Objetivo:** cerrar la fuga de memoria y hacer medible E-10.
  - **Descripción:** sustituir el `Set` de `plc-simulation.js:94` por un `Map<nonce, timestamp>` y purgar entradas con antigüedad > `maxNonceAgeMs` en cada `handleNetworkMessage()`. La detección de replay se conserva idéntica (`.has(nonce)`).
  - **Área:** Seguridad · Rendimiento · **Archivos:** `js/plc-simulation.js`
  - **Criterios de aceptación:** tras 60 s sin comandos, el tamaño del mapa vuelve a 0. **Un replay dentro de la ventana de 60 s sigue siendo detectado y bloqueado.**
  - **Pruebas:** enviar comando → pulsar "Ataque de Replay" inmediatamente ⇒ debe bloquearse. La trama expirada ya la rechaza la validación de timestamp (`:545`).
  - **Riesgos:** **Regresión de seguridad si la ventana de purga es menor que `maxNonceAgeMs`.** Deben ser exactamente el mismo valor.

- [x] **T-F0-9 — Excluir `ALARM` de la evaluación de vigilancia (N-3)** · `S`
  - **Objetivo:** impedir la tormenta de alarmas y el falseo de MTBF/MTTR.
  - **Descripción:** añadir `'ALARM'` a la lista de estados excluidos en `plc-simulation.js:273`. Complementariamente, `triggerAlarm()` debe ser idempotente: si `control.alarms[beltKey]` ya es `true`, retornar sin registrar evento ni incrementar contador.
  - **Área:** Lógica de negocio · Calidad de datos · **Archivos:** `js/plc-simulation.js`
  - **Dependencias:** conviene hacerla junto a T-F1-2 (contador por flanco).
  - **Criterios de aceptación:** con `VigC0` en falla y `MC0` forzado a `true` en estado `ALARM`, no se generan eventos de log repetidos y `alarmCount.C0` no crece.
  - **Riesgos:** verificar si una alarma **nueva en otra cinta** durante `ALARM` debe registrarse. *Supuesto:* no — en `ALARM` la planta ya está detenida.

**Bloque B — Auth y RBAC**

- [x] **T-F0-5 — Corregir la sesión RBAC (P-8 + N-1)** · `S`
  - **Objetivo:** que `checkPermission()` funcione y que la aplicación sea operable en la demo.
  - **Descripción:** (a) incluir `capabilities: user.capabilities || []` en el objeto de sesión de `auth.js:158-163`; (b) añadir los casos `VIEW_ANALYTICS` y `USE_AI_ASSISTANT` a `checkPermission()` — propuesta: `VIEW_ANALYTICS` para `Admin|Gerente|Supervisor`, `USE_AI_ASSISTANT` para todos los roles autenticados; (c) para N-1, **no** conceder `BASIC_CONTROL` a Admin: en su lugar, `applyRBACPermissions()` muestra un aviso visible ("Rol sin permiso de operación — inicie sesión como Supervisor") junto a los botones deshabilitados.
  - **Área:** Seguridad · UX · **Archivos:** `js/auth.js`, `js/app.js`
  - **Criterios de aceptación:** un Operador con `CONTROL_MANUAL` tiene los botones habilitados. Un Admin los ve deshabilitados **con explicación**, no en silencio.
  - **Pruebas:** crear un Operador con y sin la capacidad y comparar; verificar en consola que `getCurrentUser().capabilities` es un array.
  - **Riesgos:** sesiones ya guardadas sin `capabilities` degradan bien, pero conviene invalidar la sesión al desplegar.

- [x] **T-F0-6 — Corregir credenciales anunciadas (P-11)** · `XS`
  - **Objetivo:** que las credenciales de la pantalla de login funcionen.
  - **Descripción:** sustituir el bloque `index.html:55-60` por las credenciales reales (`admin / admin123`) e indicar que los roles Gerente/Supervisor/Operador se crean desde "Gestión de Usuarios" siguiendo la pirámide. Actualizar también el `placeholder` de `index.html:43`, que sugiere usuarios inexistentes.
  - **Área:** UX · Documentación · **Archivos:** `index.html`, `DOCUMENTACION.md`
  - **Criterios de aceptación:** todas las credenciales visibles en pantalla permiten iniciar sesión.

- [x] **T-F0-11 — Resolver el rol fantasma `Ingeniero` (N-2)** · `XS`
  - **Objetivo:** que el panel de Ingeniería precargue los setpoints.
  - **Descripción:** sustituir las tres comprobaciones de `'Ingeniero'` en `app.js:304`, `:332` y `:369` por `'Supervisor'`, alineándolas con `auth.js:204`. Revisar y unificar los textos de UI que mencionan "Ingeniero".
  - **Área:** Frontend · Configuración · **Archivos:** `js/app.js`, `index.html`
  - **Criterios de aceptación:** un Supervisor ve `cfg-hopper-delay`, `cfg-cinta0-time` y `cfg-dest-time` precargados desde `PLC_STATE.config`.
  - **Dependencias:** bloqueante para D-3 en F5.

**Bloque C — Logging y configuración**

- [x] **T-F0-7 — Extraer la tarifa eléctrica a configuración de negocio (S-7)** · `S`
  - **Objetivo:** que el coste deje de ser una constante en la capa de UI.
  - **Descripción:** crear `businessConfig` (`{ tariffUSDPerKWh: 0.15, co2KgPerKWh: 0.4, motorRatedKW: 1.5 }`) persistido en `localStorage['businessConfig']`, y sustituir el literal de `app.js:76`. `motorRatedKW` también está hardcoded en `plc-simulation.js:235`.
  - **Área:** Configuración · **Archivos:** `js/app.js`, `js/plc-simulation.js`
  - **Dependencias:** ninguna. La UI para editarlo llega en T-F5-7.
  - **Criterios de aceptación:** modificar `businessConfig` en `localStorage` y recargar cambia el coste mostrado.
  - **Riesgos:** el factor de CO₂ (0,4 kg/kWh) es de referencia genérica; documentar como estimación, no como dato medido.

- [x] **T-F0-10 — Cachear el log de auditoría (N-4)** · `S`
  - **Objetivo:** evitar `JSON.parse` de 500 entradas por cada consulta.
  - **Descripción:** en `audit-log.js`, cargar una sola vez al inicializar y no volver a llamar a `loadLogs()` dentro de `getLogs()`; invalidar solo si otra pestaña modifica la clave (evento `storage`). Añadir `getLogsSince(ts)` y `getLogsByType(type)`, requeridos por F3 y F6.
  - **Área:** Rendimiento · Observabilidad · **Archivos:** `js/audit-log.js`
  - **Criterios de aceptación:** 1 000 llamadas seguidas a `getLogs()` no degradan perceptiblemente; los eventos nuevos siguen apareciendo en la tabla.
  - **Riesgos:** `app.js:20-22` re-renderiza en cada evento del log; verificar que no se rompe la sincronización.

**Bloque D — Verificación**

- [x] **T-F0-12 — Regenerar el bundle y verificar no-regresión** · `XS`
  - **Descripción:** ejecutar `node build_bundle.js` y recorrer la lista de criterios de aceptación de esta fase.
  - **Área:** DevOps · Testing · **Archivos:** `bundle.js` (generado)

### Criterios de aceptación (Dado / Cuando / Entonces)

- [x] **Dado** un sistema recién reiniciado, **cuando** ejecuto un ciclo Marcha → (material entregado) → Paro → IDLE, **entonces** "Lotes Procesados" muestra `1` y no un número de tres cifras.
- [x] **Dado** que la planta está en `IDLE`, **cuando** transcurren 60 s, **entonces** `totalElapsedSeconds` ≈ 60 y `runTimeSeconds` no ha variado.
- [x] **Dado** un Operador con capacidad `CONTROL_MANUAL`, **cuando** inicia sesión, **entonces** los botones Marcha/Paro/Selec están habilitados.
- [x] **Dado** que soy Admin, **cuando** inicio sesión, **entonces** veo los botones deshabilitados **junto a una explicación del motivo**.
- [x] **Dado** cualquier credencial mostrada en la pantalla de login, **cuando** la introduzco, **entonces** el acceso es correcto.
- [x] **Dado** un comando legítimo enviado hace 5 s, **cuando** ejecuto el ataque de Replay, **entonces** sigue siendo bloqueado.
- [x] **Dado** el estado `ALARM` con un motor forzado sobre un sensor en falla, **cuando** observo 10 s, **entonces** el log no crece y `alarmCount` permanece estable.
- [x] **Dado** que la planta lleva 10 s en marcha, **cuando** cuento las escrituras a `plcMetrics`, **entonces** son ≤ 3.

### Riesgos y dependencias

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La purga de nonces (T-F0-8) abre una ventana de replay | Media | Ventana de purga **idéntica** a `maxNonceAgeMs`; prueba de regresión explícita con el botón de ataque |
| Cambiar la semántica de lotes invalida material entregado previamente | Media | Documentar el cambio en `DOCUMENTACION.md`; conservar `unitsTransferred` como equivalente al valor antiguo |
| Olvidar `node build_bundle.js` y depurar código que no corre | **Alta** | T-F0-12 al final de cada fase; documentar el paso en `DOCUMENTACION.md` |
| Sesiones antiguas en `localStorage` sin `capabilities` | Baja | `checkPermission` ya usa `\|\| []` como defecto; forzar logout tras desplegar |

### Definición de terminado (F0)

- [x] Las 12 tareas cerradas
- [x] `bundle.js` regenerado
- [x] Los 8 criterios Dado/Cuando/Entonces verificados manualmente
- [x] `DOCUMENTACION.md` actualizado con la nueva semántica de `batchesProcessed` y las credenciales correctas

---

## F1 — Instrumentación `PLC_STATE.stats`

> Original (informe §8): *"F1 — Instrumentación `PLC_STATE.stats` (§5.1) | Tamaño M | Bloquea a: F2, F3"*

### Resumen

El PLC genera eventos pero no los recuerda. F1 añade la capa de acumuladores que convierte el 70 % del catálogo de métricas en calculable sin lógica de negocio nueva. Es el cambio con **mayor riesgo de regresión de todo el plan** porque toca el bucle de control a 50 Hz.

### Interpretación técnica expandida

Todos los puntos de instrumentación ya existen como ramas de código; solo hay que colgar contadores de ellos:

| Instrumento | Punto de enganche verificado |
|---|---|
| Tiempo por estado | `switch (PLC_STATE.control.status)` — `plc-simulation.js:286` |
| Alarmas por flanco | `triggerAlarm()` — `:468` |
| Horas/kWh/ciclos por motor | bucle de conteo de motores — `:224-230` |
| Unidades y destino | transferencia C0→destino — `:194-209` |
| Comandos por tipo | `executeCommand()` — `:564-567` |
| Rechazos y tipos de ataque | `handleNetworkMessage()` — `:516-561` |
| Lockdowns | `triggerSecurityLockdown()` — `:675` |
| Ciclos de tolva | `FCTolAb` — `:175` |
| Grados girados | `currentAngle` — `:144-152` |

### Clasificación

- **Categoría principal:** Lógica de negocio
- **Secundarias:** Observabilidad · Rendimiento
- **Severidad:** Alta — **Prioridad:** Inmediata — **Confianza:** Alta

### Hechos confirmados

- `PLC_STATE` es un objeto exportado y mutable (`plc-simulation.js:5`); añadir una rama `stats` no rompe a ningún consumidor.
- `initSimulation()` ya restaura acumulados desde `localStorage['plcMetrics']` (`:113-121`); el mismo mecanismo sirve para `stats`.
- El bucle corre a 20 ms con `dt` calculado por diferencia de `Date.now()` (`:125-134`), lo que da acceso directo a G-1 y G-2.

### Supuestos

- Los acumuladores de `stats` **persisten entre sesiones**, igual que `plcMetrics`. Se añade una acción explícita de "reiniciar estadísticas" en T-F5-7 para poder empezar una demo limpia.
- `motorKWh` reparte el consumo proporcionalmente: cada motor activo consume `businessConfig.motorRatedKW`. Es la misma hipótesis que ya usa `plc-simulation.js:235`, solo que desglosada. **No es una medida física, es una estimación** y debe etiquetarse así en la UI.

### Solución recomendada

Un único bloque `stats` en `PLC_STATE` (contrato §6.1) más una función `updateStats(dt)` llamada desde el bucle, con enganches puntuales en `triggerAlarm`, `executeCommand`, `handleNetworkMessage` y `triggerSecurityLockdown`.

**Alternativa considerada y descartada:** un módulo observador externo que sondee `PLC_STATE` a 1 Hz. Descartada porque perdería flancos (alarmas, ciclos de motor) que ocurren entre muestras.

### Tareas (8)

- [x] **T-F1-1 — Crear el bloque `stats` y su persistencia** · `S`
  - **Objetivo:** estructura de datos y ciclo de vida.
  - **Descripción:** añadir `PLC_STATE.stats` según §6.1, inicializarlo en `initSimulation()`, cargarlo desde `localStorage['plcStats']` con *merge* defensivo (claves nuevas se rellenan con 0) y añadirlo al `flushMetrics()` de T-F0-4.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F0-4
  - **Criterios de aceptación:** recargar conserva los acumulados; añadir una clave nueva al contrato no rompe la carga de datos antiguos.
  - **Riesgos:** un `stats` guardado con esquema antiguo debe degradar, no lanzar excepción.

- [x] **T-F1-2 — Tiempo por estado y contadores de alarma** · `M`
  - **Objetivo:** habilitar C-1, C-2, C-3, C-4, C-7, D-9.
  - **Descripción:** acumular `dt` en `stats.stateTime[status]` al inicio de `updatePLCLogic()`; detectar cambio de `status` respecto al tick anterior para incrementar `stateEntries`. En `triggerAlarm()`, incrementar `alarmCount[beltKey]` **solo si la alarma no estaba ya activa** (ver T-F0-9) y fijar `firstAlarmAt` / `lastAlarmAt`.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F1-1, T-F0-9
  - **Criterios de aceptación:** la suma de `stateTime` ≈ `totalElapsedSeconds` (±1 %). Tres alarmas en C1 dan `alarmCount.C1 === 3`.
  - **Pruebas:** inyectar falla, acusar con Paro, repetir 3 veces.
  - **Riesgos:** el `return` temprano por `securityLockdown` (`:249-253`) salta la acumulación. El tiempo en lockdown debe acumularse en un estado propio, no perderse.

- [x] **T-F1-3 — Horas, energía y ciclos por actuador** · `M`
  - **Objetivo:** habilitar B-2, C-9, C-10, C-11 y sustituir el gráfico falso de `index.html:522-543`.
  - **Descripción:** en el bloque `:224-230`, recorrer las 8 salidas de motor; para cada una activa, acumular `motorSeconds += dt` y `motorKWh += (motorRatedKW * dt) / 3600`. Comparar con el tick anterior para contar flancos de subida en `motorCycles`.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F1-1, T-F0-7
  - **Criterios de aceptación:** `Σ motorKWh` ≈ `powerConsumptionKWh` (±0,1 %). Arrancar y parar MC0 tres veces ⇒ `motorCycles.MC0 === 3`.
  - **Riesgos:** el conteo actual agrupa `MGIzq|MGDer` y `MTolAb|MTolCe` como un solo motor (`:229-230`). El desglose los separa: verificar que no se cuenta doble si ambos están activos (imposible por lógica, pero forzable desde el panel de forzado).

- [x] **T-F1-4 — Contadores de producción y destino** · `XS`
  - **Objetivo:** A-2, A-4, A-5, A-6.
  - **Descripción:** conectar `unitsTransferred`, `batchesByDest` y `scrapCount` (introducidos en T-F0-1 y T-F0-2) al bloque `stats` definitivo.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F0-1, T-F0-2, T-F1-1
  - **Criterios de aceptación:** `Σ batchesByDest === batchesProcessed`.

- [x] **T-F1-5 — Contadores de comandos y seguridad** · `S`
  - **Objetivo:** E-1, E-2, E-3, E-6, E-7, E-8, E-9.
  - **Descripción:** en `executeCommand()` incrementar `commandCounts[command]`; en cada rama de rechazo de `handleNetworkMessage()` incrementar `rejectedCommands[motivo]` y `securityEvents[reason]`; en `triggerSecurityLockdown()` incrementar `lockdownCount`.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F1-1
  - **Criterios de aceptación:** los tres botones de ataque del sandbox incrementan exactamente el contador correspondiente en `securityEvents` y `lockdownCount`.
  - **Pruebas:** manual con los tres botones de Ciberseguridad (`app.js:731`, `:745`, `:768`).
  - **Riesgos:** `executeCommand()` se ejecuta también con comandos que la máquina de estados ignora (p. ej. `PMARCHA` fuera de `IDLE`). **Recomendación: contar comandos *recibidos*** y documentarlo.

- [x] **T-F1-6 — Métricas de proceso y de salud del bucle** · `S`
  - **Objetivo:** D-4, D-6, G-1, G-2, G-5.
  - **Descripción:** contar flancos de `FCTolAb` (`hopperCycles`); acumular `|Δ currentAngle|` en `totalDegreesRotated`; mantener media móvil de `dt` y su desviación respecto a 20 ms; registrar `sessionStartedAt`.
  - **Archivos:** `js/plc-simulation.js` · **Dependencias:** T-F1-1
  - **Criterios de aceptación:** con la pestaña en primer plano, la media de `dt` está en 20 ± 5 ms. Un giro de Pos 1 a Pos 3 suma ~180° a `totalDegreesRotated`.
  - **Riesgos:** con la pestaña en segundo plano el navegador estrangula `setInterval`. **Documentar** que G-2 solo es válido con la pestaña visible.

- [x] **T-F1-7 — Eventos de dominio (`CustomEvent`)** · `S`
  - **Objetivo:** que F2 y F3 no tengan que sondear.
  - **Descripción:** emitir `plc-state-change` (con `{ from, to, at }`), `plc-alarm` y `plc-lockdown` mediante `window.dispatchEvent`, siguiendo el patrón de `audit-log.js:44` y `hmi-controller.js:24`.
  - **Archivos:** `js/plc-simulation.js`
  - **Criterios de aceptación:** un listener en consola recibe un evento por cada transición real, sin duplicados.

- [x] **T-F1-8 — Regenerar bundle y verificar rendimiento** · `XS`
  - **Descripción:** `node build_bundle.js` y comprobar que el FPS medido (G-1) no ha caído respecto a la línea base de F0.
  - **Criterios de aceptación:** media de `dt` ≤ 22 ms con la planta en marcha.

### Criterios de aceptación (Dado / Cuando / Entonces)

- [x] **Dado** un sistema en marcha durante 2 minutos, **cuando** inspecciono `PLC_STATE.stats`, **entonces** la suma de `stateTime` coincide con `totalElapsedSeconds` (±1 %) y `Σ motorKWh` coincide con `powerConsumptionKWh` (±0,1 %).
- [x] **Dado** que ejecuto los tres ataques del sandbox, **cuando** consulto `stats.securityEvents`, **entonces** hay exactamente un incremento por ataque en la categoría correcta.
- [x] **Dado** el sistema instrumentado, **cuando** mido el FPS del bucle, **entonces** no ha empeorado respecto a F0.

### Riesgos y dependencias

| Riesgo | Mitigación |
|---|---|
| **Regresión en el bucle de control**: un error en `updateStats` rompe la planta entera | Envolver `updateStats(dt)` en `try/catch`: la estadística nunca debe tumbar el control |
| Coste de CPU a 50 Hz | Solo aritmética y comparaciones; **ninguna** serialización ni acceso al DOM dentro de `updateStats` |
| Doble conteo de energía en el desglose por motor | Criterio de aceptación explícito de cuadre de sumas |
| `securityLockdown` hace `return` temprano y saltaría la acumulación | Acumular tiempo **antes** de esa guarda |

### Definición de terminado (F1)

- [x] Contrato §6.1 implementado íntegro
- [x] Sumas cuadradas (estados y energía)
- [x] Eventos de dominio emitidos
- [x] FPS sin regresión
- [x] Bundle regenerado

---

## F2 — `history-store.js`

> Original (informe §8): *"F2 — `history-store.js` (§5.2) | Tamaño S | Bloquea a: métricas 🔴 y memoria del chat"*

### Resumen

Sin serie temporal no hay tendencias, ni comparación por turno, ni respuesta a "¿qué pasó hace 10 minutos?". Es el módulo más pequeño del plan y desbloquea 14 métricas.

### Clasificación

- **Categoría principal:** Arquitectura / Datos
- **Secundarias:** Rendimiento
- **Severidad:** Alta — **Prioridad:** Alta — **Confianza:** Alta

### Hechos confirmados

- El proyecto usa ya 6 claves de `localStorage`: `plcConfig`, `plcMetrics`, `auditLogs`, `currentUser`, `usuarios_json`, `dynamic_users_pbkdf2`. Añadir `plcHistory` es coherente con el patrón existente.
- `build_bundle.js` concatena los archivos **en el orden del array `FILES`** y elimina `import`/`export`. Un módulo nuevo debe insertarse en la posición correcta del array.

### Supuestos

- Muestreo cada 5 s, tope 2 000 muestras (≈ 2,8 h, ~250 KB). Valores del informe §5.2, aceptados.
- El buffer es **circular**: al llegar al tope se descarta la muestra más antigua.

### Solución recomendada

Módulo autónomo, sin dependencias de `plc-simulation.js` (recibe la muestra ya construida), API según §5.2 del informe.

**Alternativa considerada:** IndexedDB. Descartada por S-4 — más código, sin beneficio a este horizonte temporal.

### Tareas (3)

- [x] **T-F2-1 — Implementar `js/history-store.js`** · `S`
  - **Objetivo:** API de serie temporal.
  - **Descripción:** `push(sample)`, `range(desde, hasta)`, `downsample(n)`, `clear()`, `sizeBytes()`. Escritura a `localStorage` **agrupada**: mantener el array en memoria y persistir cada N muestras (p. ej. cada 6 ⇒ 1 escritura/30 s), no en cada `push`.
  - **Área:** Datos · **Archivos:** `js/history-store.js` (nuevo)
  - **Criterios de aceptación:** tras 2 001 `push`, `range()` devuelve 2 000 elementos y el más antiguo se ha descartado. `downsample(50)` sobre 2 000 muestras devuelve 50 puntos representativos y monótonos en `t`.
  - **Riesgos:** `QuotaExceededError` si otras claves crecen. Envolver el `setItem` en `try/catch` y, ante fallo, reducir el tope a la mitad y reintentar una vez.

- [x] **T-F2-2 — Enganchar el muestreo periódico** · `XS`
  - **Objetivo:** poblar el historial.
  - **Descripción:** temporizador de 5 s (independiente del bucle de 50 Hz) que construye la muestra del contrato §6.2 desde `PLC_STATE` y llama a `push()`.
  - **Archivos:** `js/app.js` (**decisión**: en `app.js`, para que el módulo de simulación no dependa del de historial)
  - **Dependencias:** T-F1-1, T-F2-1
  - **Criterios de aceptación:** tras 1 minuto de operación hay ~12 muestras con `t` creciente.

- [x] **T-F2-3 — Registrar el módulo en el bundle** · `XS`
  - **Descripción:** añadir `"js/history-store.js"` al array `FILES` de `build_bundle.js`, **antes** de `js/app.js`. Verificar que el módulo respeta el estilo que el *stripper* soporta: `export function|class|const|let|var` al inicio de línea; **prohibido** `export { a, b }` a mitad de archivo y `export default` de expresiones (`build_bundle.js:14-18`).
  - **Archivos:** `build_bundle.js`
  - **Criterios de aceptación:** `bundle.js` regenerado sin errores de sintaxis en consola.

### Criterios de aceptación (Dado / Cuando / Entonces)

- [x] **Dado** un historial vacío, **cuando** la planta opera 5 minutos, **entonces** `range(hace5min, ahora)` devuelve ~60 muestras coherentes.
- [x] **Dado** un historial en el tope, **cuando** llega una muestra nueva, **entonces** el tamaño no crece y la más antigua desaparece.
- [x] **Dado** `localStorage` casi lleno, **cuando** falla la escritura, **entonces** la aplicación **no** se rompe y registra el problema.

### Definición de terminado (F2)

- [x] API completa (`push`, `range`, `downsample`, `clear`, `sizeBytes`)
- [x] Buffer circular verificado
- [x] Escritura agrupada, no por muestra
- [x] Módulo en el bundle, sin errores de cuota

### Notas de implementación (F2)

- **Verificación:** 19 comprobaciones sobre el módulo con un doble de `localStorage` (buffer circular a 2 001 muestras, `downsample(50)` monótono, ventana de 5 min = 60 muestras, agrupación 6 a 1, cuota agotada, muestras malformadas) y comprobación en navegador: tras 36 s hay 6 muestras con Δt ≈ 5 000 ms, las 8 claves de §6.2 y una sola escritura a `localStorage`.
- **`status` usa el estado efectivo.** El muestreo llama a `effectiveState()`, que ha pasado a exportarse desde `plc-simulation.js` junto con `MOTOR_KEYS` (antes eran internos). Verificado en navegador: tras un ataque de trama no firmada las muestras registran `SECURITY_LOCKDOWN`, no el `control.status` congelado. Sin esto, el tiempo de bloqueo inflaría la disponibilidad de F3, que es exactamente lo que la desviación 1 de §6.1 quería evitar.
- **Sin aliasing en los `import`.** `build_bundle.js` elimina las líneas `import` y vuelca todo a un ámbito único: un `import { push as otroNombre }` compilaría en el módulo ES6 pero daría `ReferenceError` en el bundle. Por eso los consumidores usan la fachada `HistoryStore.push(...)`, que además evita colisiones con nombres tan genéricos como `push`, `range` o `clear`.
- **Pendiente ajeno a F2:** N-6 (`renderNetworkTraffic()` revienta con las tramas sin `hmac`) **sigue vivo** en `app.js`, pese a que F0 figura como cerrada. Reproducido en navegador al pulsar "trama no firmada": `TypeError` y la tabla de tráfico deja de pintarse. No se toca aquí por estar fuera del alcance de F2.

---

## F3 — `stats-engine.js`

> Original (informe §8): *"F3 — `stats-engine.js` (§5.3) | Tamaño M | Bloquea a: dashboard y agente"*

### Resumen

Convierte acumuladores e historial en KPIs de negocio. Es el único punto donde se define qué es OEE, disponibilidad o desgaste en este sistema. Debe ser **puro** — sin DOM, sin red, sin `localStorage` directo — para poder probarse y para servir de motor de respaldo del chatbot cuando n8n no responda.

### Clasificación

- **Categoría principal:** Lógica de negocio
- **Secundarias:** Testing · Observabilidad
- **Severidad:** Alta — **Prioridad:** Alta — **Confianza:** Alta

### Supuestos (definiciones de negocio que hay que fijar)

Estas fórmulas **no** están en el código; se proponen aquí y deben validarse (§8 Q3):

| KPI | Definición propuesta |
|---|---|
| Disponibilidad (C-1) | `(stateTime.RUNNING + DISCHARGING_C0 + DISCHARGING_DEST) / totalElapsedSeconds` |
| Rendimiento (A-3) | `batchesProcessed / (horas en RUNNING)`, normalizado contra un ritmo nominal configurable |
| Calidad (A-6) | `unitsTransferred / (unitsTransferred + scrapCount)` |
| OEE (A-7) | `Disponibilidad × Rendimiento × Calidad` |
| MTBF (C-3) | `(tiempo operativo total) / (nº total de alarmas)`; `null` si no hay alarmas |
| MTTR (C-4) | `stateTime.ALARM / (nº total de alarmas)`; `null` si no hay alarmas |
| Desgaste (C-11) | `motorSeconds[m] / vidaÚtilNominal[m]`, con vida útil por actuador en `businessConfig` |

**Todo divisor puede ser cero.** El motor devuelve `null` en ese caso, nunca `NaN` ni `Infinity`. Este es el criterio de aceptación más importante de la fase.

### Tareas (5)

- [ ] **T-F3-1 — Esqueleto y contrato** · `S`
  - **Descripción:** crear `js/stats-engine.js` con `computeKPIs(plcState, history, logs, businessConfig)` devolviendo el objeto de §6.3, y el resto de funciones (`computeReliability`, `computeEnergy`, `computeSecurity`, `computeTrends`, `detectAnomalies`) como funciones exportadas independientes.
  - **Archivos:** `js/stats-engine.js` (nuevo) · **Dependencias:** F1, F2
  - **Criterios de aceptación:** el módulo no referencia `document`, `window`, `fetch` ni `localStorage`.

- [ ] **T-F3-2 — Producción, energía y OEE** · `M`
  - **Descripción:** implementar los bloques `production`, `energy` y `oee` según las definiciones anteriores; `energy.byMotor` se deriva de `stats.motorKWh`; `costUSD` y `co2Kg` de `businessConfig`.
  - **Dependencias:** T-F3-1, T-F0-7
  - **Criterios de aceptación:** con `batchesProcessed === 0`, `kWhPerBatch` es `null` y la UI no muestra `NaN`.

- [ ] **T-F3-3 — Fiabilidad y mantenimiento** · `M`
  - **Descripción:** bloques `availability` y `maintenance`, incluyendo `hoursToService` (C-12) calculado como `(umbral − horas) / ritmo medio de uso`, con el ritmo derivado del historial.
  - **Dependencias:** T-F3-1
  - **Criterios de aceptación:** sin historial suficiente, `hoursToService` es `null` y `meta.degraded` es `true`.
  - **Riesgos:** C-12 se presenta como fecha en la UI; una proyección con poco historial produce fechas absurdas. **Requiere mínimo de muestras** antes de mostrar la fecha.

- [ ] **T-F3-4 — Seguridad, RBAC y salud del sistema** · `M`
  - **Descripción:** bloques `security` y `system`. Aprovechar que `details.reason` ya es estructurado (`plc-simulation.js:679`) en lugar de parsear texto. Usar `getLogsByType()` de T-F0-10.
  - **Dependencias:** T-F3-1, T-F0-10
  - **Criterios de aceptación:** el desglose por tipo de ataque coincide con `stats.securityEvents` calculado por dos vías distintas (log y contador).

- [ ] **T-F3-5 — Estrategia de pruebas (N-5)** · `M`
  - **Objetivo:** verificar el motor sin introducir dependencias.
  - **Descripción:** dado que no hay `package.json` ni runner (N-5), crear `tests/stats-engine.test.mjs` ejecutable con `node --test tests/stats-engine.test.mjs` (runner integrado de Node, sin instalación). Casos mínimos: divisores a cero, `stats` vacío, historial vacío, valores de frontera de OEE (0 y 1).
  - **Área:** Testing · **Archivos:** `tests/stats-engine.test.mjs` (nuevo)
  - **Criterios de aceptación:** `node --test` pasa en verde y cubre al menos los 4 casos degenerados.
  - **Riesgos:** el directorio `tests/` no debe incluirse en `build_bundle.js`. **Confirmar antes de implementar** que la versión de Node soporta `node --test` (≥ 18). → §8 Q4.

### Criterios de aceptación (Dado / Cuando / Entonces)

- [ ] **Dado** un `PLC_STATE` recién inicializado (todo a cero), **cuando** llamo a `computeKPIs()`, **entonces** devuelve un objeto completo sin `NaN`, sin `Infinity` y con `meta.degraded === true`.
- [ ] **Dado** el mismo estado de entrada dos veces, **cuando** llamo a `computeKPIs()`, **entonces** el resultado es idéntico (determinismo).
- [ ] **Dado** que n8n no está disponible, **cuando** se piden KPIs, **entonces** el motor responde igualmente (sin red).

### Definición de terminado (F3)

- [ ] Contrato §6.3 completo
- [ ] Pruebas en verde
- [ ] Cero dependencias del DOM o de la red
- [ ] Módulo registrado en `build_bundle.js` antes de `js/app.js`

---

## F4 — `charts.js` (SVG sin dependencias)

> Original (informe §8): *"F4 — `charts.js` (§5.4) | Tamaño M | Bloquea a: dashboard"*

### Resumen

Biblioteca mínima de renderizado en SVG. Se puede desarrollar en paralelo a F1–F3 usando datos sintéticos.

### Clasificación

- **Categoría principal:** Frontend
- **Secundarias:** Accesibilidad · Rendimiento
- **Severidad:** Media — **Prioridad:** Normal — **Confianza:** Media (no hay código previo de referencia)

### Hechos confirmados

- `styles.css` (28 KB) define variables `--accent-cyan`, `--accent-green`, `--accent-yellow`, `--accent-orange`, `--bg-tertiary`, `--text-secondary`, ya usadas en línea en `index.html`.
- No hay `package.json`: la restricción de "sin dependencias" es estructural, no una preferencia.

### Tareas (4)

- [ ] **T-F4-1 — Renderizadores base** · `L`
  - **Descripción:** `lineChart`, `barChart`, `stackedBar`, `donut`, `gauge`, `sparkline`, `timeline`. Cada uno recibe `(container, data, options)` y devuelve el nodo SVG. Sin estado interno.
  - **Archivos:** `js/charts.js` (nuevo)
  - **Criterios de aceptación:** cada renderizador funciona con `data: []`, con un solo punto y con 2 000 puntos sin desbordar el contenedor.
  - **Riesgos:** un `lineChart` con 2 000 puntos genera un `path` enorme. Usar `downsample()` de F2 antes de renderizar.

- [ ] **T-F4-2 — Paleta y accesibilidad** · `S`
  - **Descripción:** consumir las variables CSS existentes, no colores literales. Añadir `<title>` y `aria-label` a cada SVG y una tabla de datos oculta para lectores de pantalla en los gráficos principales.
  - **Archivos:** `js/charts.js`, `styles.css`
  - **Criterios de aceptación:** los gráficos siguen el tema de la aplicación sin colores hardcodeados; cada gráfico tiene descripción textual accesible.

- [ ] **T-F4-3 — Página de pruebas visuales** · `S`
  - **Descripción:** archivo `charts-preview.html` independiente (fuera del bundle) que renderiza cada tipo con datos sintéticos, incluidos los casos límite.
  - **Archivos:** `charts-preview.html` (nuevo, solo desarrollo)
  - **Criterios de aceptación:** permite validar F4 sin depender de F1–F3.

- [ ] **T-F4-4 — Registrar en el bundle** · `XS`
  - **Descripción:** añadir `js/charts.js` a `FILES` antes de `js/app.js`; respetar el estilo de `export` que el *stripper* soporta.

### Definición de terminado (F4)

- [ ] 7 renderizadores implementados
- [ ] Casos límite cubiertos (vacío, 1 punto, 2 000 puntos)
- [ ] Paleta por variables CSS, sin colores literales
- [ ] Accesibilidad básica (`<title>` + `aria-label`)
- [ ] Previsualización funcionando y módulo en el bundle

---

## F5 — Pestaña "Analítica & IA" y reconstrucción de "KPIs & Negocio"

> Original (informe §8): *"F5 — Pestaña 'Analítica & IA' + reconstrucción de KPIs & Negocio (§5.5) | Tamaño L"*

### Resumen

Es la fase visible: sustituye los 4 elementos falsos identificados en el informe §2.2 por métricas reales y añade la vista analítica. Refresco a **1 Hz**, desacoplado del bucle de 50 Hz.

### Clasificación

- **Categoría principal:** Frontend
- **Secundarias:** UX · Rendimiento · Lógica de negocio
- **Severidad:** Alta — **Prioridad:** Alta — **Confianza:** Media

### Hechos confirmados

- Las pestañas se declaran en **tres** sitios que deben mantenerse sincronizados: el array de `switchTab()` (`app.js:341`), el array de binding de botones (`app.js:528`) y los botones de `index.html:87-91`. Además `applyRBACPermissions()` (`app.js:284-318`) referencia cada pestaña por variable individual.
- El gráfico falso está en `index.html:519-543` (alturas 60/25/15/35/8 % en atributos `style`).
- El panel de mantenimiento falso está en `index.html:546-568` (18 %, `1,432 hrs`, `28 de Septiembre 2026`).
- `updateUI()` (`app.js:25-83`) hace ~25 `getElementById` por tick a 50 Hz.

### Tareas (8)

- [ ] **T-F5-1 — Separar el render de KPIs del bucle de 50 Hz (P-12)** · `M`
  - **Descripción:** extraer las líneas `app.js:70-77` del `updateUI` de 50 Hz a un `renderKPIs()` invocado por `setInterval` a 1 Hz. Cachear las referencias DOM de `updateUI` en un objeto de módulo, resuelto una vez en `DOMContentLoaded`.
  - **Archivos:** `js/app.js`
  - **Criterios de aceptación:** el FPS medido (G-1) mejora o se mantiene; los KPI siguen actualizándose visiblemente.
  - **Riesgos:** las referencias DOM cacheadas se invalidan si un contenedor se re-renderiza con `innerHTML` (ocurre en `renderAuditLogs` y `renderUsersTable`). Cachear **solo** nodos que nunca se reemplazan.

- [ ] **T-F5-2 — Nueva pestaña "📊 Analítica & IA"** · `S`
  - **Descripción:** añadir `tab-analytics` en los **tres** puntos de sincronización, más su visibilidad por rol en `applyRBACPermissions()` usando el nuevo permiso `VIEW_ANALYTICS` (T-F0-5).
  - **Archivos:** `index.html`, `js/app.js` · **Dependencias:** T-F0-5
  - **Criterios de aceptación:** un Operador no ve la pestaña; Supervisor, Gerente y Admin sí.
  - **Riesgos:** olvidar uno de los tres puntos de sincronización deja la pestaña sin botón o sin panel. Verificar los tres.

- [ ] **T-F5-3 — Sustituir el gráfico eléctrico falso (B-2)** · `S`
  - **Descripción:** reemplazar `index.html:519-543` por un `barChart` alimentado por `kpis.energy.byMotor`.
  - **Dependencias:** F3, F4
  - **Criterios de aceptación:** las barras cambian al operar la planta; con consumo cero se muestra un estado vacío explícito, no barras a cero sin explicación.

- [ ] **T-F5-4 — Sustituir el panel de mantenimiento falso (C-9/C-11/C-12)** · `M`
  - **Descripción:** reemplazar `index.html:546-568` por una tabla de actuadores con horas de servicio, ciclos, desgaste (barra de progreso) y próximo mantenimiento previsto.
  - **Dependencias:** F3
  - **Criterios de aceptación:** los valores derivan de `stats.motorSeconds`/`motorCycles`. La fecha de mantenimiento solo aparece con historial suficiente; si no, "datos insuficientes".
  - **Riesgos:** presentar una proyección como certeza es exactamente el defecto que esta fase corrige. Etiquetar como **estimado**.

- [ ] **T-F5-5 — Vista ejecutiva del Gerente** · `L`
  - **Descripción:** completar "KPIs & Negocio" con OEE (gauge), disponibilidad, lotes y rendimiento, coste y coste por lote, reparto por destino (dona) y tendencia de consumo (área), según §7 del informe.
  - **Dependencias:** F3, F4, T-F5-1

- [ ] **T-F5-6 — Vista de Supervisor y de Ciberseguridad** · `L`
  - **Descripción:** en "Analítica & IA": MTBF/MTTR, alarmas por cinta, tiempo por estado (barra apilada), consumo por motor, vaciado real vs. setpoint (D-3). En "Ciberseguridad OT": aceptados vs. rechazados, eventos por tipo, forzados e inyecciones, cronología de incidentes.
  - **Dependencias:** F3, F4, T-F0-11 (para D-3)

- [ ] **T-F5-7 — Configuración de negocio y reinicio de estadísticas** · `M`
  - **Descripción:** formulario para `businessConfig` (tarifa, factor CO₂, kW nominal, vidas útiles) y botón "Reiniciar estadísticas" con confirmación, que limpia **`plcStats`, `plcMetrics` y `plcHistory` como una unidad** (ver N-7: borrar una sin las otras descuadra el balance de energía de forma permanente). Ambos registrados en auditoría como `CONFIG_CHANGE`.
  - **Dependencias:** T-F0-7, F2
  - **Criterios de aceptación:** el reinicio deja los KPI a cero sin recargar la página y queda auditado.
  - **Riesgos:** acción destructiva. Requiere confirmación explícita y restricción a `ADVANCED_CONFIG`.

- [ ] **T-F5-8 — Persistir el tráfico de red (P-9 + D-8 + N-6)** · `M`
  - **Descripción:** en `hmi-controller.js`, ampliar el tope de 30 a ~200 entradas, persistir en `localStorage` y medir la latencia comando→respuesta guardando `t0` antes de `handleNetworkMessage()` (`hmi-controller.js:54`) y calculando el delta al registrar la respuesta (`:56`). **Incluye N-6:** proteger `app.js:128` para que una trama sin `hmac` no rompa el render (`t.data.hmac ? t.data.hmac.slice(0,10) : 'SIN FIRMA'`).
  - **Archivos:** `js/hmi-controller.js`, `js/app.js`
  - **Criterios de aceptación:** D-8 muestra un valor en milisegundos; el tráfico sobrevive a una recarga.
  - **Riesgos:** `app.js:11-17` re-renderiza la tabla completa en cada evento de tráfico; con 200 entradas conviene limitar el render a las primeras 30.

### Criterios de aceptación (Dado / Cuando / Entonces)

- [ ] **Dado** el dashboard abierto con la planta en marcha, **cuando** mido el FPS del bucle, **entonces** se mantiene en el rango de RNF-01.
- [ ] **Dado** un sistema sin datos, **cuando** abro "Analítica & IA", **entonces** veo estados vacíos explicativos, no ceros ni `NaN`.
- [ ] **Dado** que busco los 4 elementos falsos del informe §2.2, **cuando** los inspecciono, **entonces** ninguno conserva valores literales en el HTML.

### Definición de terminado (F5)

- [ ] Cero valores hardcodeados en las vistas de métricas
- [ ] Refresco a 1 Hz, desacoplado del bucle de 50 Hz
- [ ] Visibilidad por rol correcta en las tres pestañas afectadas
- [ ] Estados vacíos en todos los widgets
- [ ] Bundle regenerado

---

## F6 — `n8n-connector.js` y trazabilidad de la IA

> Original (informe §8): *"F6 — `n8n-connector.js` (telemetría fire-and-forget) + tipo `AI_INTERACTION` | Tamaño M | Bloquea a: F7"*

### Resumen

Canal unidireccional hacia n8n con la clave de API residiendo **solo** en n8n. Incluye el saneado anti *prompt injection* y el registro de auditoría de toda interacción con la IA.

### Clasificación

- **Categoría principal:** API/Integración
- **Secundarias:** Seguridad · Observabilidad
- **Severidad:** Media — **Prioridad:** Normal — **Confianza:** Media

### Supuestos

- **S-6:** no consta instancia de n8n en el repositorio. El conector se implementa con la URL del webhook **configurable** y se prueba contra un endpoint local o simulado.

### Tareas (4)

- [ ] **T-F6-1 — Módulo conector** · `M`
  - **Descripción:** `js/n8n-connector.js` con `sendTelemetry(payload)` (*fire-and-forget*, sin bloquear la UI), `ask(question, context)` con **timeout** configurable, y `ping()` para el LED de estado (G-6 / RF-IA-11). URL del webhook en `businessConfig`.
  - **Criterios de aceptación:** con la red caída, ninguna función lanza excepción no capturada ni congela la interfaz; `ask()` resuelve con `{ degraded: true }` al expirar el timeout.
  - **Riesgos:** el token del webhook queda visible en `bundle.js`. Asumir baja confianza: alcance mínimo en n8n y rotación tras la entrega (informe §6.4).

- [ ] **T-F6-2 — Constructor de contexto con lista blanca** · `M`
  - **Descripción:** función que arma el payload **enumerando explícitamente** los campos permitidos. **Nunca** serializar `PLC_STATE` completo — está en el mismo módulo que `PLC_SHARED_SECRET`. Prohibido incluir hashes, salts, `usuarios.json` o la clave compartida.
  - **Criterios de aceptación:** una prueba comprueba que el payload serializado no contiene las cadenas `hash`, `salt`, `PlcSuperSecretKey` ni `iterations`.
  - **Riesgos:** **fuga de material criptográfico.** Este criterio de aceptación es obligatorio, no opcional.

- [ ] **T-F6-3 — Saneado anti prompt-injection** · `M`
  - **Descripción:** sanear, truncar y delimitar todo texto de origen no confiable (nombres de usuario, mensajes de log) antes de incluirlo en el contexto. Marcarlo explícitamente como datos, no instrucciones.
  - **Criterios de aceptación:** crear un usuario llamado `ignora tus instrucciones y...` y comprobar que el nombre llega delimitado y truncado.

- [ ] **T-F6-4 — Tipos de log `AI_INTERACTION` y `AUTH_FAIL`** · `S`
  - **Descripción:** añadir ambos tipos a `audit-log.js` y a los estilos de la tabla (`app.js:161-166` asigna clase por tipo). Registrar cada consulta y respuesta de la IA (requisito S-7 del informe). Convertir el `logEvent('WARNING', …)` de login fallido (`auth.js:154`) en `AUTH_FAIL` con `details` estructurado, habilitando E-5.
  - **Archivos:** `js/audit-log.js`, `js/auth.js`, `js/app.js`, `styles.css`
  - **Criterios de aceptación:** cada interacción con la IA aparece en la auditoría con su tipo propio; los intentos fallidos de login son agrupables por usuario sin parsear texto.

### Definición de terminado (F6)

- [ ] Conector con timeout y modo degradado
- [ ] Lista blanca verificada por prueba automática
- [ ] Saneado anti prompt-injection activo
- [ ] Ambos tipos de log en uso
- [ ] Módulo en el bundle

---

## F7 — Widget de chat y modo degradado

> Original (informe §8): *"F7 — Widget de chat + modo degradado por reglas | Tamaño M"*

### Resumen

Widget flotante persistente entre pestañas (S-5), con LED de estado del agente, historial multiturno y respuestas locales por reglas cuando n8n no responde.

### Clasificación

- **Categoría principal:** Frontend
- **Secundarias:** Seguridad · UX
- **Severidad:** Media — **Prioridad:** Normal — **Confianza:** Media

### Tareas (5)

- [ ] **T-F7-1 — `chat-store.js`** · `S`
  - **Descripción:** historial de conversación persistido, con tope de turnos y purga. Se envían los últimos 6 turnos por consulta (informe §6.3).

- [ ] **T-F7-2 — Widget flotante** · `M`
  - **Descripción:** UI del chat en `index.html` + `styles.css`, **fuera** de los paneles de pestaña para que persista al cambiar de pestaña. Cabecera con LED de conexión (G-6). Sugerencias rápidas ("¿Por qué bajó la disponibilidad?", "¿Qué cinta falla más?", "Resume el turno").
  - **Dependencias:** F6

- [ ] **T-F7-3 — Catálogo cerrado de herramientas de solo lectura** · `M`
  - **Descripción:** implementar `getKPIs`, `getAlarms`, `getEnergyBreakdown`, `getSecurityEvents`, `getAuditSlice`, `getHistory`, resueltas en el cliente **antes** de enviar. **Ninguna función de escritura; ninguna que toque `handleNetworkMessage()`.**
  - **Dependencias:** F3, F2
  - **Criterios de aceptación:** el catálogo es un objeto literal cerrado; no hay despacho dinámico por nombre desde la respuesta del agente.
  - **Riesgos:** **riesgo S-1/S-2 del informe.** Sin `eval`, sin `Function`, sin indexar el catálogo con una cadena procedente del LLM sin validarla contra la lista de claves permitidas.

- [ ] **T-F7-4 — Modo degradado por reglas** · `M`
  - **Descripción:** si `ask()` expira, responder con plantillas generadas por `stats-engine` y marcar visiblemente la respuesta como *"local, sin agente"*.
  - **Dependencias:** F3, T-F6-1
  - **Criterios de aceptación:** con la URL del webhook vacía o inaccesible, el chat sigue respondiendo preguntas sobre KPIs y lo indica.

- [ ] **T-F7-5 — RBAC del asistente y límites de uso** · `M`
  - **Descripción:** filtrar el contexto por rol (Gerente → negocio; Supervisor → técnico y seguridad; Operador → estado y ayuda operativa). **Ningún rol** recibe datos de `usuarios.json`, hashes, salts ni la clave compartida. Añadir *throttle* por usuario y límite de mensajes por sesión.
  - **Dependencias:** T-F0-5 (`USE_AI_ASSISTANT`), T-F6-2
  - **Criterios de aceptación:** un Operador no obtiene datos de ciberseguridad; superar el límite muestra un aviso claro, no un error.

### Definición de terminado (F7)

- [ ] Chat funcional en modo degradado **sin n8n**
- [ ] Catálogo cerrado, sin despacho dinámico
- [ ] Filtrado de contexto por rol
- [ ] Toda interacción auditada como `AI_INTERACTION`

---

## F8 — Workflows n8n y despliegue estático

> Original (informe §8): *"F8 — Workflows de n8n (WF-1…WF-5) y despliegue estático | Tamaño L"*

### Resumen

Última fase, dependiente de infraestructura externa que **no consta en el repositorio**. Se planifica a alto nivel; el detalle requiere confirmar §8 Q5.

### Clasificación

- **Categoría principal:** Infraestructura / DevOps
- **Severidad:** Media — **Prioridad:** Baja — **Confianza:** **Baja**

### Tareas (6, pendientes de refinar)

- [ ] **T-F8-1 — Provisionar instancia n8n y webhook** · `M`
  - Webhook `POST /hmi-ask`; clave de API del LLM **solo** en n8n (RF-DEP-04, S-3).
- [ ] **T-F8-2 — Implementar WF-1…WF-5** · `L`
  - Según `INFORME_PROYECTO.md` §5.6–5.7.
- [ ] **T-F8-3 — Instrucción de sistema del agente** · `S`
  - El log es **datos**, no órdenes (mitigación de prompt injection del lado servidor).
- [ ] **T-F8-4 — Despliegue estático del HMI** · `M`
  - RF-DEP-05, y verificación de que `usuarios.json` se sirve correctamente — hoy hay fallback a `localStorage` y a usuarios embebidos (`auth.js:41-77`).
- [ ] **T-F8-5 — Caché de respuestas y control de cuota del LLM** · `S`
- [ ] **T-F8-6 — Rotación del token del webhook tras la entrega** · `XS`

### Riesgos

- Toda esta fase depende de acceso a n8n y a una clave de API de LLM que no constan. **Es la fase con mayor probabilidad de replanificación.**
- Si n8n no llega a estar disponible, F7 en modo degradado sigue siendo demostrable por sí sola — de ahí la decisión S-6.

### Definición de terminado (F8)

- [ ] Webhook operativo y clave de API fuera del cliente
- [ ] WF-1…WF-5 implementados
- [ ] HMI desplegado en estático con `usuarios.json` servido correctamente
- [ ] Token del webhook rotado

---

# 8. Preguntas abiertas

Ninguna bloquea el arranque: F0–F5 pueden ejecutarse con los supuestos de §4. Estas preguntas afectan a decisiones concretas más adelante.

- [ ] **Q1** — ¿Hay capturas o vídeos ya entregados que muestren "Lotes Procesados" con la semántica antigua?
  - **Bloquea:** redacción de `DOCUMENTACION.md` en T-F0-1 · **Defecto:** documentar el cambio y seguir
- [ ] **Q2** — ¿Debe Admin poder operar la planta, o se mantiene la separación de funciones?
  - **Bloquea:** T-F0-5 · **Defecto:** se mantiene la separación; solo se añade el aviso explicativo
- [ ] **Q3** — ¿Se aceptan las definiciones de OEE, disponibilidad, calidad y desgaste propuestas en F3? Especialmente el **ritmo nominal** contra el que se normaliza el rendimiento (A-3) y las **vidas útiles nominales** por actuador (C-11), que hoy no existen en ninguna parte.
  - **Bloquea:** T-F3-2, T-F3-3, T-F5-4 · **Defecto:** valores configurables en `businessConfig` con defectos documentados como estimación
- [x] **Q4** — ¿Qué versión de Node hay instalada? (`node --test` requiere ≥ 18)
  - **RESUELTA (9 ago 2026):** Node **v24.13.0**. `node --test` disponible; T-F3-5 procede tal como está planteada.
- [ ] **Q5** — ¿Existe ya instancia de n8n y URL de webhook?
  - **Bloquea:** F6, F8 · **Defecto:** S-6 — construir contra el modo degradado y conectar después
- [ ] **Q6** — ¿Cuál es el horizonte real de la demo (minutos u horas de operación)? Determina si 2,8 h de historial bastan y si las proyecciones de mantenimiento tienen datos suficientes.
  - **Bloquea:** T-F2-1, T-F3-3 · **Defecto:** 2 000 muestras / 5 s según el informe

---

# 9. Definición de terminado (global)

- [ ] Los 12 problemas del informe (P-1…P-12) y los 5 hallazgos nuevos (N-1…N-5) están cerrados o explícitamente aceptados como fuera de alcance
- [ ] **Ningún elemento de las vistas de métricas contiene valores literales en el HTML** — verificable buscando `style="height:` y las cadenas `1,432`, `18%`, `28 de Septiembre` en `index.html`
- [ ] Todas las credenciales mostradas en pantalla funcionan
- [ ] El FPS del bucle de simulación cumple RNF-01 con el dashboard abierto
- [ ] `stats-engine.js` pasa sus pruebas y nunca devuelve `NaN` ni `Infinity`
- [ ] El chat responde en modo degradado **sin conexión a n8n**
- [ ] Ninguna carga útil enviada al exterior contiene hashes, salts ni la clave compartida — verificado por prueba automática (T-F6-2)
- [ ] `node build_bundle.js` ejecutado y `bundle.js` coherente con `js/`
- [ ] `DOCUMENTACION.md` actualizado: nueva semántica de lotes, credenciales, módulos nuevos y paso obligatorio de build

---

# 10. Trazabilidad: métrica → fase

| Fase | Métricas del catálogo que habilita |
|---|---|
| F0 | Precondición de todas (corrige A-1, A-5, C-1, E-10) |
| F1 | A-2, A-4, A-5, A-6, B-2, B-4, B-6, B-7, B-9, C-2…C-7, C-9, C-10, C-11, D-1, D-2, D-4, D-5, D-6, D-7, E-1, E-2, E-3, E-4, E-10, G-1, G-2, G-5 |
| F2 | A-3, A-8, A-10, B-8, C-8, C-12, D-3, D-9, E-12, F-4 |
| F3 | A-7 (OEE), E-11, y el cálculo de todas las anteriores |
| F4 + F5 | Presentación de todas · G-3, G-4 |
| F6 + F7 | G-6, consulta en lenguaje natural de las 60 |
| F8 | Operación del agente en producción |

**Cobertura:** las 60 métricas del catálogo quedan asignadas a una fase. El informe recomienda mostrar 12–16 por rol; el resto queda accesible vía el asistente.
