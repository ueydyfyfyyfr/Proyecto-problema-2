# INFORME DEL LÍDER DE PROYECTO
## Dashboard Web Ciberfísico, Ciberseguridad Industrial e IA Agéntica con n8n

**Asignatura:** Automatización Industrial (Ingeniería Informática)
**Problema asignado:** **Problema 2 — Nodo de distribución con tolva y 4 cintas sobre plataforma giratoria**
**Equipo:** Miguel Urbina y Moisés Becerra
**Rol que emite este documento:** **Líder de Proyecto — 20 pts**
**Entregable:** Requisitos · Riesgos · Alcance · Informe
**Fecha límite de este documento:** **viernes 07/08/2026, antes de las 12:00 AM**
**Fecha de entrega completa del proyecto:** **20/08/2026** (con envío del enlace de hosting por correo)

---

## CONTROL DE CAMBIOS

| Versión | Fecha | Cambio | Motivo |
|---|---|---|---|
| 1.0 | 06/08/2026 | Emisión inicial: alcance, requisitos y riesgos de la Fase 1 (HMI + ciberseguridad) | Especificación original del III Parcial |
| **2.0** | **06/08/2026** | **Incorporación de la Fase 2 como alcance obligatorio: IA agéntica, automatización con n8n, despliegue en hosting y estructura de 4 roles con informes independientes** | **Ampliación del enunciado comunicada por la cátedra** |

> **Nota de reversión explícita:** la versión 1.0 de este informe concluía que la IA agéntica y n8n quedaban **fuera de alcance** por no figurar en el PDF original. Dicha conclusión **queda anulada**. A partir de la v2.0, la **IA agéntica integrada con n8n es un requisito obligatorio y de alta ponderación en la evaluación**.

---

# ÍNDICE

1. Alcance del Proyecto (incluye organización de roles y cronograma)
2. Requisitos
3. Análisis de Riesgos
4. Informe de Desarrollo y Resultados
5. Fase 2 — IA Agéntica, Automatización y n8n (especificación)
6. Trazabilidad Requisito → Implementación
7. Plan de Pruebas y Evidencias
8. Conclusiones

---

# 1. ALCANCE DEL PROYECTO

## 1.1 Enunciado asignado (Problema 2)

El sistema representa un **nodo de distribución** para el transporte de material procedente de una **tolva** por medio de **4 cintas transportadoras**. La **cinta 0** está situada sobre una **plataforma giratoria** accionada por el motor **MG**, lo que permite situarla enfrente de cualquiera de las otras tres cintas para evacuar el material en el sentido deseado.

## 1.2 Alcance Incluido (In-Scope)

### A. Proceso físico simulado

| Elemento | Alcance comprometido |
|---|---|
| Plataforma giratoria | Giro continuo a 45 °/s, posiciones 0°, 90°, 180° |
| Selección de destino | Pulsador `PSelec` cíclico (1→2→3→1), inhabilitado con sistema activo |
| Finales de carrera | `FC1`, `FC2`, `FC3` derivados del ángulo físico real (tolerancia ±1°) |
| Cinta 0 + Cintas 1/2/3 | Motores `MC0`..`MC3` con arranque simultáneo C0 + destino |
| Tolva | Apertura/cierre por `MTolAb`/`MTolCe`, finales `FCTolAb`/`FCTolCe`, 50 %/s |
| Retardo de tolva | Apertura **5 s** después de activar `MC0` (configurable) |
| Secuencia de paro | Cierre tolva → **20 s** descarga C0 → **+20 s** descarga cinta destino |
| Vigilancia de velocidad | `VigC0`..`VigC3`, umbral 4 rad/s, **ventana ciega de arranque** |
| Alarmas | Parada de la cinta averiada + parpadeo **2 Hz** de `LDes` correspondiente |
| Acuse de recibo | Mediante pulsador `PParo` |
| Emergencia / Reset CI | Estado `EMERGENCY_LOCK` y retorno a Condiciones Iniciales |
| Flujo de material | Partículas discretas generadas en tolva, transferidas C0 → destino |

### B. Interfaz Ciberfísica (Módulo A — 30/70)

- Render **Canvas 2D a ~50 FPS** (`setInterval` de 20 ms) con la planta completa animada.
- Consola de operación manual: **Marcha, Paro, Selección, Emergencia, Reset CI**.
- **Forzado de actuadores** individual e **inyección de fallos** en sensores de vigilancia.
- Indicadores digitales (ángulo, % tolva, estado) y LEDs `LS1-3`, `LConC0-3`, `LDesC0-3`, `LDescgC1-3`.

### C. Ciberseguridad y Pirámide de Automatización (Módulo B — 30/70)

- Autenticación con **PBKDF2-SHA256, 100 000 iteraciones, salt único de 16 bytes** por usuario.
- **RBAC de 4 niveles** con jerarquía estricta de creación de usuarios.
- Firma **HMAC-SHA256** + **nonce** + **timestamp** en cada comando HMI→PLC.
- **Lockdown de seguridad OT**: parada de todos los motores ante intrusión detectada.
- Panel de simulación de 3 vectores de ataque y visor de tráfico de red virtual.
- Registro de auditoría con niveles `INFO`, `WARNING`, `OPERATION`, `CONFIG_CHANGE`, `SECURITY_ALERT`.

### D. IA y Trazabilidad (Módulo C — 10/70)

- Documento de prompts utilizados (`DOCUMENTACION.md`, sección 6).
- Video de prueba de vulnerabilidad (`2026-07-28 11-48-57.mp4`).

### E. IA Agéntica y Dashboard Analítico *(Fase 2 — NUEVO, alto peso en evaluación)*

- **Dashboard de recomendaciones y análisis estadístico** alimentado por un agente de IA.
- Cálculo y visualización de **KPIs analíticos**: disponibilidad, MTBF, MTTR, distribución de alarmas por cinta, consumo energético por lote, utilización por posición de destino.
- **Recomendaciones accionables** generadas por el agente (mantenimiento preventivo, ajuste de setpoints, eficiencia energética).
- **Visualización gráfica** de las series y agregados (el criterio de evaluación prioriza explícitamente el impacto visual).

### F. Automatización con n8n *(Fase 2 — NUEVO, alto peso en evaluación)*

- **Integración bidireccional** entre la aplicación HMI y una instancia de **n8n**.
- **Workflows de automatización** para ingesta de telemetría, análisis programado, alertas de ciberseguridad e informe de turno.
- **Presentación visual de los propios workflows** en n8n como parte de la evaluación.

### G. Despliegue y Operación *(Fase 2 — NUEVO)*

- **Despliegue de la aplicación en un hosting público accesible por URL**.
- Instancia de **n8n accesible** para la demostración.
- **Envío del enlace de hosting por correo** como parte de la entrega del 20/08.

### H. Documentación por Rol *(Fase 2 — NUEVO)*

- **Cuatro informes independientes y detallados**, uno por cada rol del equipo (ver §1.5).
- **Auditoría de ciberseguridad asistida por IA** con casos prácticos documentados.

## 1.3 Alcance Excluido (Out-of-Scope)

Se declara explícitamente **fuera de alcance** lo siguiente, por no ser exigido por la especificación:

| Excluido | Justificación |
|---|---|
| PLC físico real (Siemens/Allen-Bradley) | La especificación pide una **APPWEB**, no despliegue en hardware |
| Protocolos industriales reales (Modbus/TCP, OPC-UA, PROFINET) | El transporte se emula en memoria mediante `handleNetworkMessage()` |
| Backend con base de datos e infraestructura de servidor | La persistencia se resuelve con `localStorage` + `usuarios.json` |
| TLS/HTTPS y gestión de certificados | Servidor de desarrollo local (`http://localhost:3000`) |
| Multiusuario concurrente en red | Aplicación monopuesto de escritorio/navegador |
| Los Problemas 1, 3 y 4 | Asignados a otros equipos |
| **Entrenamiento o *fine-tuning* de modelos de IA propios** | Se consumen modelos existentes vía API; el valor está en la orquestación agéntica |
| **Control de motores por parte del agente de IA** | **Prohibido por diseño**: el agente es estrictamente de solo lectura (ver §5.7) |
| Infraestructura de pago o de nivel productivo (SLA, alta disponibilidad) | Se emplean niveles gratuitos de hosting suficientes para la demostración |

## 1.4 Entregables

| # | Entregable | Archivo |
|---|---|---|
| 1 | Aplicación web funcional | `index.html`, `styles.css`, `js/*.js`, `server.js` |
| 2 | Base de usuarios con hashes | `usuarios.json` |
| 3 | Documentación técnica y prompts de IA | `DOCUMENTACION.md` |
| 4 | **Informe del Líder de Proyecto** (requisitos, riesgos, alcance) | `INFORME_PROYECTO.md` (este documento) |
| 5 | Video de prueba de vulnerabilidad | `2026-07-28 11-48-57.mp4` |
| 6 | Módulo conector de IA agéntica y n8n | `js/n8n-connector.js`, `js/ai-dashboard.js` *(pendiente)* |
| 7 | Exportación de los workflows de n8n | `n8n/workflows/*.json` *(pendiente)* |
| 8 | Informe del Líder de Planta (optimización y despliegue) | `INFORME_PLANTA.md` *(pendiente)* |
| 9 | Informe del Líder de Ciberseguridad (auditoría con IA) | `INFORME_CIBERSEGURIDAD.md` *(pendiente)* |
| 10 | Informe del Líder de Presentación (evaluación) | `INFORME_PRESENTACION.md` *(pendiente)* |
| 11 | **URL pública del hosting** enviada por correo | *(pendiente — 20/08)* |

---

## 1.5 Organización del Equipo, Roles y Ponderación

La evaluación se reparte en **cuatro roles con entregables e informes independientes**, sumando **100 puntos**:

| Rol | Pts | Responsabilidades | Entregable | Fecha |
|---|:--:|---|---|---|
| **Líder de Proyecto** | **20** | Definir requisitos, analizar riesgos, delimitar alcance, coordinar al equipo | Este informe | **Vie 07/08, 23:59** |
| **Líder de Planta** | **60** | Optimizar el proyecto, implementar la IA agéntica y n8n, desplegar en hosting | `INFORME_PLANTA.md` + app desplegada | 20/08 |
| **Líder de Ciberseguridad** | **10** | Auditoría de seguridad **asistida por IA** con casos prácticos | `INFORME_CIBERSEGURIDAD.md` | 20/08 |
| **Líder de Presentación** | **10** | Evaluación y exposición del proyecto | `INFORME_PRESENTACION.md` + defensa | **19/08** |

### Asignación nominal

| Rol | Responsable | Apoyo |
|---|---|---|
| Líder de Proyecto | *(por confirmar)* | — |
| Líder de Planta | *(por confirmar)* | — |
| Líder de Ciberseguridad | *(por confirmar)* | — |
| Líder de Presentación | *(por confirmar)* | — |

> **Observación de gestión:** el equipo está formado por **2 integrantes** y existen **4 roles**, por lo que cada integrante debe asumir **dos roles**. Se recomienda el siguiente reparto para equilibrar la carga, dado que el Líder de Planta concentra **60 de los 100 puntos**:
>
> - **Integrante A:** Líder de Planta (60 pts) — la carga técnica más pesada.
> - **Integrante B:** Líder de Proyecto (20) + Ciberseguridad (10) + Presentación (10) = 40 pts — carga fundamentalmente documental.
>
> Esta observación es una **recomendación**, no una decisión cerrada; debe confirmarse antes del viernes.

### Matriz RACI

| Actividad | Proyecto | Planta | Ciberseg. | Present. |
|---|:--:|:--:|:--:|:--:|
| Requisitos, riesgos y alcance | **R/A** | C | C | I |
| Optimización del código base | I | **R/A** | C | I |
| Implementación IA agéntica + n8n | C | **R/A** | C | I |
| Despliegue en hosting | I | **R/A** | C | I |
| Auditoría de seguridad con IA | I | C | **R/A** | I |
| Casos prácticos de ataque con IA | I | C | **R/A** | C |
| Material y defensa de la presentación | C | C | C | **R/A** |
| Consolidación y envío final | **R/A** | C | C | C |

*R = Responsable · A = Aprobador · C = Consultado · I = Informado*

---

## 1.6 Cronograma e Hitos

| Hito | Fecha | Responsable | Criterio de cierre |
|---|---|---|---|
| **H1 — Entrega del informe de gestión** | **Vie 07/08, antes de 12:00 AM** | Líder de Proyecto | Requisitos, riesgos y alcance aprobados por el equipo |
| H2 — Arquitectura de IA agéntica + n8n congelada | 09/08 | Planta + Proyecto | Contrato de datos y catálogo de workflows definidos (§5.5, §5.6) |
| H3 — Instancia de n8n operativa y workflows funcionando | 12/08 | Líder de Planta | Los 5 workflows ejecutan de extremo a extremo |
| H4 — Dashboard de IA agéntica integrado en el HMI | 14/08 | Líder de Planta | Estadísticas y recomendaciones visibles en pantalla |
| H5 — Auditoría de seguridad con IA completada | 16/08 | Líder de Ciberseguridad | Informe con hallazgos y casos prácticos |
| H6 — Despliegue en hosting público verificado | 17/08 | Líder de Planta | URL accesible desde una red externa |
| H7 — Congelación de código (*code freeze*) | 18/08 | Todos | Sin cambios funcionales; solo corrección de defectos |
| **H8 — Presentación y evaluación** | **19/08** | Líder de Presentación | Defensa realizada |
| **H9 — Entrega completa + envío del enlace por correo** | **20/08** | Líder de Proyecto | Correo enviado con la URL y todos los informes |

### Ruta crítica

```
H2 (arquitectura) → H3 (n8n) → H4 (dashboard) → H6 (despliegue) → H8 (presentación)
```

Cualquier retraso en **H3** compromete directamente H4, H6 y H8. Es el punto de control más sensible del cronograma (ver riesgo **RP-08**).

---

## 1.7 Criterios de Evaluación Priorizados

La cátedra ha indicado explícitamente que **"lo más importante es la parte visual, tanto en n8n como en la IA agéntica y el proceso web"**. Esto reordena las prioridades de ingeniería:

| Prioridad | Foco | Implicación de diseño |
|:--:|---|---|
| **1** | **Impacto visual del dashboard de IA agéntica** | Gráficos, tarjetas de recomendación y animaciones; nunca volcados de JSON en crudo |
| **2** | **Legibilidad visual de los workflows en n8n** | Nodos ordenados, nombrados en español, agrupados y anotados con notas explicativas |
| **3** | **Calidad visual del proceso web (HMI)** | Ya cubierto por el render Canvas premium de la Fase 1 |
| 4 | Auditoría con IA y casos prácticos | Hallazgos presentados con evidencia visual (capturas, tablas de severidad) |
| 5 | Corrección funcional y robustez | Base necesaria, pero no es el diferenciador evaluado |

> **Decisión de diseño derivada:** ante un conflicto entre sofisticación técnica interna e impacto visual demostrable, **se prioriza el impacto visual**, por ser el criterio declarado de evaluación.

---

# 2. REQUISITOS

## 2.1 Requisitos Funcionales — Proceso (RF-P)

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|:---:|
| RF-P-01 | Selección de posición de la cinta 0 mediante pulsador `PSelec` | Cada pulsación avanza la posición 1→2→3→1 y enciende `LS1`/`LS2`/`LS3` | Cumplido |
| RF-P-02 | La selección debe quedar **inhabilitada** mientras el sistema esté activo | `PSELEC` solo se procesa en estado `IDLE` o `ALARM` | Cumplido |
| RF-P-03 | La posición queda definida por los finales de carrera `FC1`, `FC2`, `FC3` | El ángulo físico activa el FC correspondiente con tolerancia ±1° | Cumplido |
| RF-P-04 | Al accionar `PMarcha`, la cinta 0 gira hasta la posición seleccionada | Estado `ROTATING`; `MGIzq`/`MGDer` según el sentido más corto | Cumplido |
| RF-P-05 | Al alcanzar la posición, arrancan **simultáneamente** `MC0` y la cinta destino | En la misma transición se activan `MC0` y `MC{n}` | Cumplido |
| RF-P-06 | La tolva se abre **5 s después** de la activación de `MC0` | Temporizador `hopperOpenDelay = 5 s`; luego `MTolAb = true` | Cumplido |
| RF-P-07 | El motor de la tolva se detiene al alcanzar `FCTolAb` | `MTolAb = false` cuando la apertura ≥ 99 % | Cumplido |
| RF-P-08 | Al accionar `PParo` se cierra la tolva de inmediato | `MTolCe = true`, `MTolAb = false` | Cumplido |
| RF-P-09 | Tras `PParo`, la cinta 0 sigue **20 s** en descarga | Estado `DISCHARGING_C0`, `cinta0DischargeTime = 20 s` | Cumplido |
| RF-P-10 | La cinta destino sigue **20 s más** que la cinta 0 | Estado `DISCHARGING_DEST`, `destDischargeTime = 20 s` | Cumplido |
| RF-P-11 | Cada cinta dispone de lámpara de conexión y de desconexión | `LConC0-3` y `LDesC0-3` con lógica excluyente | Cumplido |
| RF-P-12 | Vigilancia de velocidad por cinta (umbral 4 rad/s) | Entradas `VigC0`..`VigC3` evaluadas en cada ciclo | Cumplido |
| RF-P-13 | La alarma detiene automáticamente **solo** la cinta averiada | `triggerAlarm()` apaga el motor afectado; la otra sigue descargando | Cumplido |
| RF-P-14 | Parpadeo a **2 Hz** de la lámpara de desconexión de la cinta averiada | `alarmBlinkState` conmuta cada 250 ms (ciclo 500 ms = 2 Hz) | Cumplido |
| RF-P-15 | Las lámparas de conexión de las cintas que trabajaban permanecen activas | Se preserva `LConC{n}` durante el estado `ALARM` | Cumplido |
| RF-P-16 | El **acuse de recibo** de la avería se hace con `PParo` | `PPARO` en estado `ALARM` invoca `clearAlarms()` | Cumplido |
| RF-P-17 | La vigilancia **se ignora durante los 5 s** de arranque | Ventana `startupTimers` por cinta | **Parcial: 3 s** |
| RF-P-18 | La tolva abre/cierra con `MTol` y finales `FCTolAb`/`FCTolCe` | Simulación a 50 %/s con ambos finales derivados | Cumplido |

> **Nota de desviación (RF-P-17):** El enunciado del Problema 2 fija la ventana ciega de arranque en **5 segundos**; la implementación actual usa **3000 ms** (`startupTimers.C0 = 3000`), valor heredado del Problema 1. **Acción correctiva:** cambiar los dos literales `3000` a `5000` en `js/plc-simulation.js` (estado `ROTATING`).

## 2.2 Requisitos Funcionales — Módulo A: Interfaz Ciberfísica (RF-A)

| ID | Requisito | Estado |
|---|---|:---:|
| RF-A-01 | Representación visual dinámica en tiempo real (Canvas 2D, ~50 FPS) | Cumplido |
| RF-A-02 | Animación de bandas, rodillos, plataforma giratoria y partículas de material | Cumplido |
| RF-A-03 | Consola de operación manual: Marcha, Paro, Selección, Emergencia, Reset CI | Cumplido |
| RF-A-04 | Forzado individual de actuadores desde el panel de Supervisor | Cumplido |
| RF-A-05 | Inyección de fallos de velocidad (`INJECT_FAULT`) para probar la vigilancia | Cumplido |
| RF-A-06 | Indicadores analógicos/digitales: ángulo, % apertura de tolva, estado | Cumplido |
| RF-A-07 | Lógica JS que emula tiempos y transiciones de sensores/actuadores | Cumplido |
| RF-A-08 | Bloqueos de seguridad (interlocks) entre mandos manuales | Cumplido |

## 2.3 Requisitos Funcionales — Módulo B: Ciberseguridad y RBAC (RF-B)

| ID | Requisito | Implementación | Estado |
|---|---|---|:---:|
| RF-B-01 | Las credenciales **no** se guardan en texto plano | PBKDF2-SHA256, 100 000 iteraciones | Cumplido |
| RF-B-02 | Salt único por usuario | 16 bytes vía `crypto.getRandomValues()` | Cumplido |
| RF-B-03 | Rol **Operador** (Nivel Control): visualización + mandos básicos | `BASIC_CONTROL` condicionado a capacidades | Cumplido |
| RF-B-04 | Rol **Supervisor/Ingeniero** (Nivel Planta): temporizadores, forzado, auditoría | `ADVANCED_CONFIG`, `FORCE_ACTUATOR`, `VIEW_AUDIT_LOG` | Cumplido |
| RF-B-05 | Rol **Gerente** (Nivel ERP): métricas globales **sin** control de motores | `VIEW_METRICS` exclusivo; sin permisos de control | Cumplido |
| RF-B-06 | Jerarquía de la pirámide: Admin → Gerente → Supervisor → Operador | Validación estricta en `createUser()` | Cumplido |
| RF-B-07 | Checklist de capacidades granulares para Operadores | `CONTROL_MANUAL`, `CHANGE_SETPOINTS`, solo-ver | Cumplido |
| RF-B-08 | Firma de integridad **HMAC-SHA256** en los comandos transmitidos | `generateHMAC()` / `verifyHMAC()` con clave compartida | Cumplido |
| RF-B-09 | Defensa contra **Tampering** | Payload alterado → HMAC no coincide → comando rechazado | Cumplido |
| RF-B-10 | Defensa contra **Replay Attack** | Registro `receivedNonces` (Set); nonce repetido → bloqueo | Cumplido |
| RF-B-11 | Defensa contra tramas expiradas | Ventana temporal de 60 000 ms sobre `timestamp` | Cumplido |
| RF-B-12 | Rechazo de comandos sin firma | Paquete sin `hmac` → `COMANDO_NO_FIRMADO` | Cumplido |
| RF-B-13 | Respuesta activa ante intrusión (no solo detección) | `triggerSecurityLockdown()` apaga todos los motores | Cumplido |
| RF-B-14 | Registro de auditoría de eventos y alertas de seguridad | `audit-log.js` con niveles y actor | Cumplido |
| RF-B-15 | Visor de tráfico de red virtual (últimos 30 paquetes) | `getNetworkTraffic()` con dirección SENT/RECEIVED | Cumplido |

### 2.3.1 Matriz de permisos RBAC

| Permiso | Admin | Gerente | Supervisor | Operador |
|---|:---:|:---:|:---:|:---:|
| `BASIC_CONTROL` (Marcha/Paro) | – | – | Sí | Si tiene `CONTROL_MANUAL` |
| `ADVANCED_CONFIG` (Setpoints) | – | – | Sí | Si tiene `CHANGE_SETPOINTS` |
| `FORCE_ACTUATOR` | – | – | Sí | No |
| `VIEW_AUDIT_LOG` | Sí | – | Sí | No |
| `VIEW_METRICS` | Sí | Sí | – | No |
| `MANAGE_USERS` | Sí | Sí | Sí | No |
| Puede crear el rol… | Gerente | Supervisor | Operador | – |

## 2.4 Requisitos Funcionales — Módulo C: IA y Trazabilidad (RF-C)

| ID | Requisito | Estado |
|---|---|:---:|
| RF-C-01 | Documentar los prompts usados en Antigravity u otras IAs generativas | Cumplido (`DOCUMENTACION.md` §6, 6 prompts) |
| RF-C-02 | Video de prueba de vulnerabilidad manipulando variables | Cumplido (`2026-07-28 11-48-57.mp4`) |
| RF-C-03 | Código limpio y modular (no copia directa sin comprensión) | Cumplido (6 módulos ES6 desacoplados) |

## 2.5 Requisitos Funcionales — IA Agéntica y Dashboard Analítico (RF-IA) *(Fase 2)*

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|:---:|
| RF-IA-01 | El HMI debe incorporar una **pestaña/dashboard de Analítica e IA** | Sección accesible desde la navegación principal | Pendiente |
| RF-IA-02 | Calcular y mostrar **indicadores estadísticos** del proceso | Disponibilidad, MTBF, MTTR, nº de alarmas por cinta, kWh por lote | Pendiente |
| RF-IA-03 | Visualizar los indicadores mediante **gráficos**, no solo texto | Al menos 3 tipos: barras, líneas y anillo/dona | Pendiente |
| RF-IA-04 | Mostrar **recomendaciones accionables** generadas por el agente de IA | Tarjetas con severidad, hallazgo, causa probable y acción sugerida | Pendiente |
| RF-IA-05 | Cada recomendación debe estar **justificada con datos** | Incluye la métrica y el valor que la disparó | Pendiente |
| RF-IA-06 | El agente debe **priorizar** las recomendaciones por impacto | Orden: Crítica → Alta → Media → Informativa | Pendiente |
| RF-IA-07 | Detección de **tendencias y anomalías** en la serie histórica | Señala desviaciones respecto a la línea base | Pendiente |
| RF-IA-08 | **Consulta en lenguaje natural** sobre el histórico del proceso | Campo de texto libre; el agente responde citando eventos del log | Pendiente |
| RF-IA-09 | **Degradación elegante** si el agente no está disponible | El dashboard muestra las estadísticas locales y un aviso de "agente sin conexión" | Pendiente |
| RF-IA-10 | El agente **nunca** puede emitir comandos de control al PLC | Canal estrictamente de solo lectura (ver §5.7) | Pendiente |
| RF-IA-11 | Indicar visualmente el **estado de conexión** con el agente | Indicador LED: conectado / procesando / sin conexión | Pendiente |
| RF-IA-12 | El dashboard debe ser el elemento **visualmente más destacado** de la Fase 2 | Criterio de evaluación declarado (§1.7) | Pendiente |

## 2.6 Requisitos Funcionales — Automatización con n8n (RF-N8N) *(Fase 2)*

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|:---:|
| RF-N8N-01 | Instancia de **n8n operativa** y accesible durante la demostración | Editor de n8n abierto y funcional | Pendiente |
| RF-N8N-02 | **WF-1 Ingesta de telemetría**: el HMI publica eventos y métricas vía webhook | n8n recibe y almacena los eventos | Pendiente |
| RF-N8N-03 | **WF-2 Análisis estadístico programado**: agrega datos e invoca al LLM | Ejecución periódica que devuelve recomendaciones | Pendiente |
| RF-N8N-04 | **WF-3 Triaje de alertas de seguridad**: clasifica los `SECURITY_ALERT` con IA | Notificación con severidad y acción recomendada | Pendiente |
| RF-N8N-05 | **WF-4 Informe de turno**: consolida KPIs y genera un resumen con IA | Informe en lenguaje natural para el rol Gerente | Pendiente |
| RF-N8N-06 | **WF-5 Consulta en lenguaje natural**: endpoint de pregunta/respuesta | Responde con datos del histórico | Pendiente |
| RF-N8N-07 | Los workflows deben estar **visualmente ordenados y anotados** | Nodos nombrados en español, agrupados y con notas | Pendiente |
| RF-N8N-08 | La comunicación HMI → n8n debe ser ***fire-and-forget*** | Un fallo de n8n **jamás** bloquea la lógica del PLC | Pendiente |
| RF-N8N-09 | Los workflows deben poder **exportarse** en JSON y versionarse | Archivos en `n8n/workflows/` | Pendiente |
| RF-N8N-10 | Autenticación del webhook mediante cabecera o token | Rechazo de peticiones sin credencial | Pendiente |

## 2.7 Requisitos de Despliegue y Operación (RF-DEP) *(Fase 2)*

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|:---:|
| RF-DEP-01 | Aplicación desplegada en un **hosting público con URL accesible** | Carga correctamente desde una red externa | Pendiente |
| RF-DEP-02 | Servicio bajo **HTTPS** | El proveedor emite certificado válido | Pendiente |
| RF-DEP-03 | La instancia de n8n debe ser **alcanzable** desde la app desplegada | CORS configurado correctamente | Pendiente |
| RF-DEP-04 | **Sin credenciales ni claves de API** en el código desplegado | Las claves de LLM residen exclusivamente en n8n | Pendiente |
| RF-DEP-05 | La aplicación debe funcionar **sin necesidad de `node server.js`** | Compatible con hosting estático | Pendiente |
| RF-DEP-06 | **Enlace enviado por correo** dentro del plazo | Correo enviado el 20/08 | Pendiente |
| RF-DEP-07 | Usuario de demostración disponible para el evaluador | Credenciales indicadas en el correo | Pendiente |

## 2.8 Requisitos de Auditoría con IA (RF-AUD) *(Fase 2 — Líder de Ciberseguridad)*

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|:---:|
| RF-AUD-01 | Auditoría del código base **asistida por IA** | Hallazgos con severidad, ubicación y remediación | Pendiente |
| RF-AUD-02 | Documentar los **prompts de auditoría** empleados | Reproducibles por un tercero | Pendiente |
| RF-AUD-03 | **Casos prácticos** de ataque ejecutados y evidenciados | Mínimo los 5 vectores de §4.4 más los nuevos de la Fase 2 | Pendiente |
| RF-AUD-04 | Auditar la **nueva superficie de ataque** introducida por n8n y el agente | Webhook, CORS, *prompt injection*, fuga de datos | Pendiente |
| RF-AUD-05 | Verificar que el agente **no puede escalar a control del proceso** | Prueba de intento de comando desde el agente | Pendiente |
| RF-AUD-06 | Emitir un **informe de auditoría** independiente | `INFORME_CIBERSEGURIDAD.md` | Pendiente |

## 2.9 Requisitos No Funcionales (RNF)

| ID | Categoría | Requisito | Métrica objetivo |
|---|---|---|---|
| RNF-01 | Rendimiento | Animación fluida sin bloqueo de la UI | ≥ 50 FPS (ciclo de 20 ms) |
| RNF-02 | Rendimiento | Latencia percibida mando → reacción visual | < 100 ms |
| RNF-03 | Usabilidad | Estado del proceso comprensible sin formación previa | Códigos de color estándar ISA |
| RNF-04 | Mantenibilidad | Arquitectura modular con responsabilidad única | 6 módulos ES6, sin dependencias circulares |
| RNF-05 | Portabilidad | Funciona en navegadores modernos sin plugins | Chrome/Edge/Firefox actuales |
| RNF-06 | Seguridad | Coste computacional de derivación de clave | PBKDF2 ≥ 100 000 iteraciones |
| RNF-07 | Seguridad | Cero credenciales en texto plano en cualquier artefacto | Verificado en `usuarios.json` |
| RNF-08 | Robustez | El sistema no debe quedar en estado inconsistente ante fallo | Máquina de estados con transiciones cerradas |
| RNF-09 | Trazabilidad | Todo comando ejecutado queda registrado con actor y nonce | 100 % de comandos auditados |
| RNF-10 | Instalación | Cero dependencias externas (`npm install` no requerido) | Solo Node.js ≥ 14 |

## 2.6 Requisitos de Interfaz — Mapa E/S del Problema 2

**ENTRADAS (12)**

`PSelec` · `PMarcha` · `PParo` · `FC1` · `FC2` · `FC3` · `FCTolAb` · `FCTolCe` · `VigC0` · `VigC1` · `VigC2` · `VigC3`

**SALIDAS (20)**

`LS1` · `LS2` · `LS3` · `LConC0` · `LConC1` · `LConC2` · `LConC3` · `LDesC0` · `LDesC1` · `LDesC2` · `LDesC3` · `MC0` · `MC1` · `MC2` · `MC3` · `MTolAb` · `MTolCe` · `MGIzq` · `MGDer`

> Cobertura: **100 % de las E/S del enunciado están declaradas** en `PLC_STATE.inputs` / `PLC_STATE.outputs` de `js/plc-simulation.js`. Adicionalmente se implementaron `LDescgC1-3` (lámparas de descarga) como extensión para señalizar visualmente la fase de vaciado.

---

# 3. ANÁLISIS DE RIESGOS

## 3.1 Metodología

Se emplea una matriz **Probabilidad × Impacto** en escala 1–5. El **Nivel de Riesgo (NR)** es el producto de ambos:

| NR | Clasificación | Acción requerida |
|---|---|---|
| 1 – 5 | Bajo | Aceptar y monitorear |
| 6 – 12 | Medio | Mitigar con plan definido |
| 13 – 25 | Alto / Crítico | Mitigación obligatoria antes de la entrega |

## 3.2 Riesgos Técnicos del Producto

| ID | Riesgo | P | I | NR | Nivel | Mitigación implementada |
|---|---|:-:|:-:|:-:|---|---|
| RT-01 | Clave HMAC compartida **hardcodeada** en el cliente (`PLC_SHARED_SECRET`) y visible desde DevTools | 5 | 5 | **25** | Crítico | **Riesgo aceptado y documentado**: la especificación exige una app 100 % cliente y una demo de ataque desde la consola del navegador. La clave es intencionalmente accesible para permitir la demostración. En producción residiría en el PLC/HSM y nunca en el navegador. |
| RT-02 | Bypass del RBAC llamando directamente al módulo desde consola | 4 | 4 | **16** | Alto | Aunque se invoque `sendSecureCommand`, el PLC valida HMAC + nonce + timestamp antes de ejecutar. Todo comando queda auditado con el actor. |
| RT-03 | Crecimiento indefinido del `Set` de nonces (fuga de memoria en sesión larga) | 3 | 2 | 6 | Medio | Sesiones de demostración cortas. **Pendiente:** purgar nonces con antigüedad > 60 s, coherente con `maxNonceAgeMs`. |
| RT-04 | Ventana ciega de arranque en 3 s en lugar de los **5 s** del enunciado | 4 | 3 | **12** | Medio | Desviación detectada y documentada (RF-P-17). Corrección de una línea pendiente. |
| RT-05 | `localStorage` manipulable: un atacante puede reescribir su rol en `currentUser` | 4 | 4 | **16** | Alto | Limitación inherente a una arquitectura sin backend. La ejecución real sigue exigiendo firma HMAC válida, y toda acción se registra en auditoría. |
| RT-06 | Deriva temporal del `setInterval` bajo carga de CPU o pestaña en segundo plano | 3 | 3 | 9 | Medio | La lógica usa **delta-time real** (`dt` calculado con `Date.now()`), no el número de ticks; los tiempos físicos se mantienen correctos. |
| RT-07 | Estado inconsistente al recargar la página a mitad de una secuencia | 3 | 2 | 6 | Medio | La máquina de estados reinicia en `IDLE`; solo se persisten métricas y configuración. |
| RT-08 | Web Crypto API no disponible bajo `file://` en algunos navegadores | 3 | 4 | **12** | Medio | Servidor local obligatorio (`node server.js`), documentado explícitamente. Fallback embebido en `auth.js`. |
| RT-09 | Divergencia del secreto entre `hmi-controller.js` y `plc-simulation.js` (está duplicado) | 2 | 4 | 8 | Medio | Ambos literales verificados como idénticos. **Recomendación:** centralizar en `crypto-helper.js`. |
| RT-10 | Ausencia de bloqueo tras N intentos fallidos de login (fuerza bruta) | 3 | 3 | 9 | Medio | Las 100 000 iteraciones de PBKDF2 encarecen cada intento. El fallo se registra en auditoría. |
| RT-11 | Comunicación sin cifrar (HTTP, sin TLS) | 2 | 3 | 6 | Medio | Fuera de alcance: entorno de desarrollo local en `localhost`. |
| RT-12 | Fallo del render Canvas en equipos sin aceleración por hardware | 2 | 3 | 6 | Medio | Canvas 2D estándar, sin WebGL ni shaders. |

## 3.3 Riesgos de Proceso Industrial Modelados (Riesgos OT)

Estos son los riesgos **del proceso simulado** que el diseño de control debe cubrir:

| ID | Escenario de riesgo OT | Consecuencia | Salvaguarda implementada |
|---|---|---|---|
| RO-01 | Apertura de la tolva antes de que la cinta 0 esté en marcha | Acumulación y desbordamiento de material | Interlock temporizado de 5 s tras `MC0` |
| RO-02 | Giro de la plataforma con material en circulación | Vertido de material fuera de las cintas | `PSELEC` bloqueado fuera de `IDLE`/`ALARM` |
| RO-03 | Parada brusca dejando material en las cintas | Bloqueo mecánico al reanudar | Secuencia de vaciado 20 s + 20 s |
| RO-04 | Patinaje / pérdida de velocidad de una banda | Atasco y sobrecarga del motor | Vigilancia `VigC{n}` con parada automática selectiva |
| RO-05 | Falsa alarma durante el arranque (aún sin velocidad de régimen) | Paradas espurias del proceso | Ventana ciega de arranque (debe ser 5 s) |
| RO-06 | Avería no reconocida por el operador | Reanudación en condición insegura | Acuse de recibo **obligatorio** vía `PParo` |
| RO-07 | Emergencia con la tolva abierta | Vertido incontrolado | `EMERGENCY_LOCK` + cierre preventivo de tolva |
| RO-08 | Cinta 0 desalineada respecto al destino | Material vertido al vacío | Arranque condicionado al `FC{n}` correspondiente |
| RO-09 | Comando malicioso de arranque desde la red | Puesta en marcha no autorizada | HMAC + nonce + timestamp + lockdown |
| RO-10 | Operador sin formación ejecutando forzados | Anulación de enclavamientos de seguridad | `FORCE_ACTUATOR` restringido al rol Supervisor |

## 3.4 Riesgos de Proyecto

| ID | Riesgo | P | I | NR | Mitigación |
|---|---|:-:|:-:|:-:|---|
| RP-01 | Interpretación errónea del enunciado (tiempos, secuencias) | 3 | 4 | **12** | Trazabilidad requisito→código en la Sección 6 |
| RP-02 | Dependencia excesiva de IA generativa sin comprensión del código | 3 | 5 | **15** | Prompts documentados + revisión y refactorización manual de cada módulo |
| RP-03 | Similitud con la entrega de otro equipo del mismo Problema 2 | 3 | 4 | **12** | Diseño visual y arquitectura propios (glassmorphism, render premium, 4º rol Admin) |
| RP-04 | Video de vulnerabilidad poco convincente o incompleto | 2 | 4 | 8 | Se demuestran los 3 vectores de ataque con evidencia del lockdown |
| RP-05 | La app no arranca en el equipo del evaluador | 2 | 5 | **10** | Cero dependencias; solo Node.js. Instrucciones explícitas de despliegue |
| RP-06 | Pérdida de trabajo por ausencia de control de versiones | 2 | 4 | 8 | **Pendiente:** inicializar repositorio Git |
| RP-07 | **Sobrecarga del Líder de Planta**: concentra 60 de 100 pts con solo 2 integrantes | 4 | 5 | **20** | Reparto de roles propuesto en §1.5; el Líder de Proyecto asume el resto de la documentación |
| RP-08 | **Retraso en H3 (n8n operativo)** arrastra toda la ruta crítica | 4 | 5 | **20** | Congelar la arquitectura en H2 (09/08); dejar margen de 3 días antes del *code freeze* |
| RP-09 | Plazo del informe de gestión a **menos de 24 h** de su definición | 4 | 3 | **12** | Este documento se emite el 06/08, un día antes del vencimiento |
| RP-10 | Ambición excesiva en la Fase 2 y ninguna función terminada | 4 | 5 | **20** | Priorización estricta según §1.7: primero el impacto visual, después la sofisticación |
| RP-11 | Los cuatro informes resultan inconsistentes entre sí | 3 | 3 | 9 | Este documento es la **fuente única de verdad** de requisitos y alcance |
| RP-12 | Fallo de la demostración en vivo el 19/08 por dependencia de la nube | 3 | 5 | **15** | Grabar un video de respaldo y preparar capturas de los workflows |

## 3.5 Riesgos de la Fase 2 — IA Agéntica, n8n y Despliegue

| ID | Riesgo | P | I | NR | Nivel | Mitigación planificada |
|---|---|:-:|:-:|:-:|---|---|
| RF2-01 | **El agente de IA obtiene capacidad de escritura sobre el PLC** | 2 | 5 | **10** | Alto | **Prohibición arquitectónica**: el conector n8n es unidireccional (HMI → n8n). No existe ninguna ruta de retorno hacia `handleNetworkMessage()`. Las recomendaciones son solo texto; la acción siempre la ejecuta un humano autorizado. |
| RF2-02 | **Prompt injection** a través del log de auditoría: un atacante inserta instrucciones en un campo que el agente leerá | 3 | 4 | **12** | Medio | Sanear y escapar el contenido del log antes de enviarlo al LLM; delimitadores explícitos y prompt de sistema restrictivo. |
| RF2-03 | El webhook de n8n queda **expuesto públicamente sin autenticación** | 4 | 4 | **16** | Alto | Token en cabecera (RF-N8N-10); no publicar la URL en el código fuente del cliente. |
| RF2-04 | **Fuga de datos operativos** hacia un LLM de terceros | 3 | 3 | 9 | Medio | Enviar solo agregados y métricas; sin credenciales, hashes ni datos personales. |
| RF2-05 | **Clave de API del LLM filtrada** en el cliente desplegado | 3 | 5 | **15** | Alto | La clave reside **exclusivamente en n8n** (RF-DEP-04). El navegador nunca la conoce. |
| RF2-06 | Un fallo o latencia de n8n **bloquea el HMI** | 3 | 5 | **15** | Alto | Patrón *fire-and-forget* con `try/catch` y *timeout* (RF-N8N-08). El PLC nunca espera al agente. |
| RF2-07 | **Bloqueo por CORS** entre el hosting estático y n8n | 4 | 3 | **12** | Medio | Configurar los encabezados CORS en n8n y validarlo en H6, no el día de la entrega. |
| RF2-08 | **Agotamiento de la cuota gratuita** del LLM durante la demostración | 3 | 4 | **12** | Medio | Cachear la última respuesta válida y disponer de un modo de demostración con datos precalculados. |
| RF2-09 | **Alucinaciones** del agente: recomendaciones inventadas sin base en los datos | 4 | 3 | **12** | Medio | Exigir que toda recomendación cite la métrica y el valor que la originó (RF-IA-05); temperatura baja. |
| RF2-10 | Datos insuficientes para que la analítica resulte significativa | 4 | 3 | **12** | Medio | Precargar un histórico sintético que permita mostrar tendencias reales en la demostración. |
| RF2-11 | La instancia gratuita de n8n **se suspende por inactividad** | 4 | 4 | **16** | Alto | Verificar la instancia el mismo día de la presentación; tener capturas y un video de respaldo. |
| RF2-12 | El hosting no soporta módulos ES6 o el enrutado de la app | 2 | 4 | 8 | Medio | Elegir un proveedor de estáticos compatible y desplegar en H6 (17/08), no el 20/08. |
| RF2-13 | La nueva superficie de ataque **contradice** el discurso de aislamiento OT de la Fase 1 | 3 | 3 | 9 | Medio | Documentar la separación de planos: el canal del agente es de **telemetría de solo lectura**, jamás de control. |
| RF2-14 | Workflows de n8n visualmente desordenados (penaliza el criterio principal) | 3 | 4 | **12** | Medio | RF-N8N-07: nodos nombrados en español, agrupados y anotados. Revisión visual en H3. |

## 3.6 Riesgos Residuales Aceptados

Se aceptan formalmente, por ser consecuencia directa de la arquitectura exigida (aplicación web 100 % cliente sin backend):

1. **RT-01** — Secreto HMAC visible en el cliente.
2. **RT-05** — `localStorage` manipulable por el usuario.
3. **RT-11** — Ausencia de TLS en entorno local.

En una implantación industrial real, estos tres riesgos se eliminarían situando la lógica de control y el material criptográfico en el PLC, con comunicación por OPC-UA sobre TLS y autenticación centralizada.

---

# 4. INFORME DE DESARROLLO Y RESULTADOS

## 4.1 Arquitectura de la solución

```
Navegador (Cliente)
│
├── index.html ............ Vista única con secciones conmutadas por rol
├── styles.css ............ Diseño Obsidian + Glassmorphism
│
└── js/  (módulos ES6)
    ├── app.js .............. Orquestador: eventos UI, render, RBAC visual
    ├── auth.js ............. Login, RBAC, jerarquía de creación de usuarios
    ├── crypto-helper.js .... PBKDF2-SHA256, HMAC-SHA256, nonces
    ├── hmi-controller.js ... Firma de comandos + render Canvas 2D
    ├── plc-simulation.js ... "PLC virtual": física + lógica secuencial + firewall
    └── audit-log.js ........ Registro de eventos

server.js ................ Servidor estático Node.js (sin dependencias)
usuarios.json ............ Base de credenciales con hash PBKDF2
```

### Separación HMI ↔ PLC

El diseño imita deliberadamente una **frontera de red real**: `hmi-controller.js` **no** modifica el estado del proceso. Construye un paquete, lo firma y lo entrega a `handleNetworkMessage()`, que actúa como **frontera de confianza del PLC**. Solo tras validar firma, nonce y timestamp se invoca `executeCommand()`. Esto reproduce fielmente la separación IT/OT de la pirámide de automatización.

## 4.2 Máquina de estados del PLC

```
                    ┌──────────────────────┐
                    │        IDLE          │◄──────────────┐
                    └──────────┬───────────┘               │
                     PMarcha   │                           │
                    ┌──────────▼───────────┐               │
                    │      ROTATING        │               │
                    │  MG gira hasta FC{n} │               │
                    └──────────┬───────────┘               │
                      FC{n}=1  │  MC0 + MC{n} ON           │
                    ┌──────────▼───────────┐               │
              ┌────►│      RUNNING         │               │
              │     │  +5 s → abrir tolva  │               │
              │     └──────┬─────────┬─────┘               │
              │    PParo   │         │  ¬Vig{n}            │
              │  ┌─────────▼──┐   ┌──▼──────────┐          │
              │  │DISCHARGING │   │   ALARM     │          │
              │  │    _C0     │   │ parpadeo    │          │
              │  │   (20 s)   │   │   2 Hz      │          │
              │  └─────┬──────┘   └──┬──────────┘          │
              │        │             │ PParo (acuse)       │
              │  ┌─────▼──────┐      └─────────────────────┤
              │  │DISCHARGING │                            │
              │  │   _DEST    │────────────────────────────┤
              │  │  (+20 s)   │                            │
              │  └────────────┘                            │
              │                                            │
              │     ┌──────────────────────┐               │
              └─────┤   EMERGENCY_LOCK     │───────────────┘
                    │ todos los motores OFF│   RESET_CI
                    └──────────────────────┘
```

Adicionalmente existe el flag transversal **`securityLockdown`**, que **prevalece sobre cualquier estado**: si se activa, `updatePLCLogic()` fuerza `stopAllMotors()` y retorna inmediatamente. Solo un Supervisor puede liberarlo mediante `SECURITY_RESET`.

## 4.3 Protocolo de comando seguro

**Paquete transmitido:**

```json
{
  "payload": {
    "command": "PMARCHA",
    "args": null,
    "user": "Juan Pérez (Supervisor)",
    "timestamp": 1722175200000,
    "nonce": "a3f9c2d1-4b7e-4c1a-9f3d-2e8b6a0c5d17"
  },
  "hmac": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

**Cadena de validación en el PLC (`handleNetworkMessage`):**

| # | Control | Si falla → |
|---|---|---|
| 1 | Existen `payload` y `hmac` | `COMANDO_NO_FIRMADO` → lockdown |
| 2 | `verifyHMAC(payload, hmac, secret)` | `INTEGRIDAD_COMPROMETIDA` → lockdown |
| 3 | `nonce` no está en `receivedNonces` | `ATAQUE_REPLAY_DETECTADO` → lockdown |
| 4 | `|now − timestamp| ≤ 60 000 ms` | `TRAMA_EXPIRADA` → lockdown |
| 5 | JSON deserializable | `FORMATO_CORRUPTO` → lockdown |

**En todos los casos el lockdown implica parada física de todos los motores**, no una simple advertencia en pantalla. Esto satisface el criterio de rúbrica *"defensa activa contra manipulación de variables"*.

## 4.4 Resultados de las pruebas de ciberseguridad

| Vector de ataque | Método | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| **1. Trama sin firma** | Inyectar `{payload:{command:"PMARCHA"}}` sin campo `hmac` | Rechazo + lockdown | Bloqueado — `COMANDO_NO_FIRMADO` |
| **2. Tampering** | Capturar trama válida y alterar `command` conservando el HMAC original | Rechazo por firma inválida | Bloqueado — `INTEGRIDAD_COMPROMETIDA` |
| **3. Replay** | Reenviar íntegramente una trama legítima ya procesada | Rechazo por nonce duplicado | Bloqueado — `ATAQUE_REPLAY_DETECTADO` |
| **4. Trama expirada** | Enviar paquete con `timestamp` desfasado > 60 s | Rechazo temporal | Bloqueado — `TRAMA_EXPIRADA` |
| **5. Paquete corrupto** | Enviar JSON malformado | Rechazo de protocolo | Bloqueado — `FORMATO_CORRUPTO` |

**Tasa de detección: 5/5 (100 %).** Todos los eventos quedan registrados como `SECURITY_ALERT` con actor `PLC_FIREWALL`.

## 4.5 Métricas y KPIs (Nivel ERP — rol Gerente)

| KPI | Fuente de cálculo |
|---|---|
| Tiempo de operación acumulado | `runTimeSeconds`, incrementado solo con motores activos |
| Lotes procesados | `batchesProcessed`, +1 por cada transferencia C0 → destino |
| Consumo energético | 1,5 kW por motor activo, integrado en el tiempo → kWh |
| Coste estimado | `kWh × 0,15 USD/kWh` |

Persistencia en `localStorage` bajo la clave `plcMetrics`. El rol Gerente accede a estas métricas **sin ningún control sobre los motores**, tal como exige el enunciado.

## 4.6 Uso de IA generativa (Módulo C)

Se documentan **6 prompts estructurados** en `DOCUMENTACION.md` §6:

| # | Objetivo del prompt | Módulo resultante |
|---|---|---|
| 1 | Consolidación en aplicación única | `index.html` con secciones dinámicas |
| 2 | Sistema de roles RBAC | `applyRBACPermissions()`, `checkPermission()` |
| 3 | Pirámide de automatización + checklist granular | Jerarquía en `createUser()`, `capabilities[]` |
| 4 | Seguridad PBKDF2-SHA256 | `crypto-helper.js` |
| 5 | Diseño visual premium | `styles.css` (Obsidian + Glassmorphism) |
| 6 | Render premium del Canvas HMI | `hmi-controller.js` |

**Aporte propio del equipo (no delegado a la IA):** modelado de la máquina de estados del proceso, definición del mapa de E/S, diseño del protocolo de comandos firmados, calibración de temporizadores y análisis de riesgos.

## 4.7 Estado de cumplimiento por módulo

| Módulo | Peso | Cumplimiento | Observación |
|---|:---:|:---:|---|
| A — Animación e Interfaz Ciberfísica | 30/70 | **Completo** | Canvas 50 FPS, consola manual completa, interlocks |
| B — Ciberseguridad y RBAC | 30/70 | **Completo** | PBKDF2 + HMAC + nonce + 4 roles + defensa activa |
| C — IA y Trazabilidad | 10/70 | **Completo** | 6 prompts documentados + video de vulnerabilidad |
| **Fase 2 — IA agéntica + dashboard analítico** | Alto | **Pendiente** | Especificado en §5; implementa el Líder de Planta |
| **Fase 2 — Automatización con n8n** | Alto | **Pendiente** | 5 workflows definidos en §5.5 |
| **Fase 2 — Despliegue en hosting** | Requisito | **Pendiente** | Hito H6 (17/08) |
| **Fase 2 — Auditoría con IA** | 10 pts | **Pendiente** | Líder de Ciberseguridad |

## 4.8 Acciones correctivas pendientes

| Prioridad | Acción | Archivo | Esfuerzo |
|---|---|---|---|
| **Alta** | Cambiar la ventana ciega de arranque de 3000 a **5000 ms** (RF-P-17) | `js/plc-simulation.js` | 2 líneas |
| Media | Purgar nonces con antigüedad > `maxNonceAgeMs` (RT-03) | `js/plc-simulation.js` | ~5 líneas |
| Media | Centralizar `PLC_SHARED_SECRET` en un único módulo (RT-09) | `js/crypto-helper.js` | ~3 líneas |
| Baja | Bloqueo temporal tras 5 intentos fallidos de login (RT-10) | `js/auth.js` | ~15 líneas |
| Baja | Inicializar repositorio Git (RP-06) | — | 1 comando |

---

# 5. FASE 2 — IA AGÉNTICA, AUTOMATIZACIÓN Y n8n (ESPECIFICACIÓN)

> Esta sección es la **especificación de referencia** que el Líder de Planta debe implementar (60 pts) y sobre la que el Líder de Ciberseguridad debe auditar (10 pts). Es la **fuente única de verdad** de la Fase 2.

## 5.1 Objetivo

Dotar al HMI de un **dashboard de recomendaciones y análisis estadístico**, gobernado por un **agente de IA** cuya lógica de orquestación reside en **n8n**.

El sistema pasa de ser **reactivo** (muestra lo que ocurre) a ser **prescriptivo** (explica por qué ocurre y qué conviene hacer). Esto completa la pirámide de automatización añadiendo una capa de **inteligencia de negocio sobre el nivel ERP**.

### Principio rector de la Fase 2

> **El agente observa, analiza y recomienda. El agente NUNCA actúa sobre el proceso.**

Esta restricción no es una limitación técnica sino una **decisión de seguridad industrial deliberada**, y constituye en sí misma un argumento defendible en la presentación: en un entorno OT real, jamás se concede a un modelo probabilístico autoridad sobre actuadores físicos.

## 5.2 Arquitectura objetivo

```
NAVEGADOR (Cliente)

  plc-simulation.js  ....  PLC virtual (fuente de datos)
        |
        +--> audit-log.js  ....  eventos
        +--> PLC_STATE     ....  metricas
                 |
                 v
  stats-engine.js
     Estadistica local determinista:
     MTBF, MTTR, disponibilidad, kWh/lote,
     alarmas por cinta, tendencias
                 |
        +--------+--------+
        |                 |
        v                 v
  ai-dashboard.js    n8n-connector.js
  graficos +         fire-and-forget
  recomendaciones          |
                           |  HTTPS POST + token
                           v
---------------------------------------------------
n8n  (orquestacion)

  WF-1  Ingesta de telemetria
  WF-2  Analisis estadistico programado
  WF-3  Triaje de alertas de seguridad
  WF-4  Informe de turno
  WF-5  Consulta en lenguaje natural
                 |
                 v
        Nodo Agente IA (LLM)
        clave de API unicamente aqui
---------------------------------------------------

El flujo de datos es UNIDIRECCIONAL: HMI --> n8n.
No existe ninguna ruta de retorno hacia el control del PLC.
```

### Decisión arquitectónica clave: doble capa de analítica

| Capa | Dónde | Qué hace | Si falla… |
|---|---|---|---|
| **Determinista** | `stats-engine.js` (navegador) | Calcula todos los KPIs con fórmulas exactas | No falla; no depende de la red |
| **Agéntica** | Nodo LLM en n8n | Interpreta, prioriza y redacta recomendaciones | El dashboard sigue mostrando las estadísticas (RF-IA-09) |

> **Por qué importa:** garantiza que **el dashboard siempre tenga contenido visual que mostrar** el día de la presentación, aunque n8n o la cuota del LLM fallen. Mitiga los riesgos RF2-06, RF2-08 y RF2-11 de una sola vez.

## 5.3 Catálogo de indicadores estadísticos

Todos se calculan localmente en `stats-engine.js` a partir de `PLC_STATE` y del log de auditoría:

| Indicador | Fórmula / origen | Visualización |
|---|---|---|
| **Disponibilidad** | `tiempo en RUNNING / tiempo total` | Indicador tipo *gauge* |
| **MTBF** (tiempo medio entre fallos) | `tiempo operativo / número de alarmas` | Tarjeta numérica + tendencia |
| **MTTR** (tiempo medio de reparación) | `tiempo total en ALARM / número de alarmas` | Tarjeta numérica |
| **Alarmas por cinta** | Conteo de `triggerAlarm` por `C0..C3` | Gráfico de barras |
| **Consumo por lote** | `powerConsumptionKWh / batchesProcessed` | Tarjeta + línea temporal |
| **Utilización por destino** | Reparto de lotes entre posiciones 1/2/3 | Gráfico de anillo |
| **Rendimiento** (lotes/hora) | `batchesProcessed / horas de operación` | Línea temporal |
| **Coste operativo** | `kWh × 0,15 USD` | Tarjeta numérica |
| **Eventos de seguridad** | Conteo de `SECURITY_ALERT` por tipo | Gráfico de barras apiladas |
| **Tiempo en cada estado** | Acumulado por estado de la máquina | Barra apilada horizontal |

## 5.4 Catálogo de recomendaciones del agente

Cada recomendación debe emitirse con la estructura: **severidad · hallazgo · evidencia · acción sugerida**.

| Tipo | Disparador de ejemplo | Recomendación esperada |
|---|---|---|
| Mantenimiento predictivo | Una cinta concentra > 50 % de las alarmas | *"La cinta 2 acumula el 63 % de las alarmas de vigilancia. Programar inspección del reductor."* |
| Eficiencia energética | Consumo por lote por encima de la línea base | *"El consumo por lote subió un 18 % respecto al promedio. Revisar tensión de las bandas."* |
| Optimización de setpoints | Tiempo de descarga sobredimensionado | *"Las cintas quedan vacías a los 14 s de los 20 s configurados. Reducir el setpoint ahorraría un 8 % de energía."* |
| Alerta de seguridad | Intentos de intrusión repetidos | *"3 intentos de replay en 10 minutos desde la misma sesión. Revisar el control de acceso."* |
| Disponibilidad | Disponibilidad por debajo del umbral | *"Disponibilidad del 71 %, por debajo del objetivo del 85 %. El principal causante es el MTTR elevado."* |
| Operativa | Desequilibrio en el uso de destinos | *"El 80 % de los lotes va a la posición 1. Verificar si responde a la planificación prevista."* |

## 5.5 Catálogo de workflows de n8n

| ID | Workflow | Disparador | Nodos principales | Salida |
|---|---|---|---|---|
| **WF-1** | Ingesta de telemetría | Webhook `POST /hmi-telemetry` | Webhook → Validar token → Normalizar → Almacenar | Confirmación 200 |
| **WF-2** | Análisis estadístico | Cron (cada N minutos) o manual | Leer datos → Agregar → **Agente IA** → Formatear | Lista de recomendaciones en JSON |
| **WF-3** | Triaje de seguridad | Webhook `POST /hmi-security` | Webhook → Filtrar `SECURITY_ALERT` → **Agente IA** → Notificar | Alerta clasificada por severidad |
| **WF-4** | Informe de turno | Cron (fin de turno) | Consolidar KPIs → **Agente IA** → Redactar informe | Informe en lenguaje natural |
| **WF-5** | Consulta en lenguaje natural | Webhook `POST /hmi-ask` | Webhook → Recuperar contexto → **Agente IA** → Responder | Respuesta citando eventos |

### Requisitos de presentación visual de los workflows (RF-N8N-07)

Dado que **la evaluación valora explícitamente el aspecto visual de n8n**:

- Nodos renombrados en **español y en modo descriptivo** (“Validar token de seguridad”, no “IF”).
- Uso de **Sticky Notes** para rotular cada bloque funcional del lienzo.
- Nodos **alineados en una cuadrícula**, con flujo de izquierda a derecha.
- **Colores diferenciados** por naturaleza: ingesta, análisis, IA, notificación.
- Cada workflow debe **caber en una captura de pantalla** legible.

## 5.6 Contrato de datos HMI → n8n

```json
{
  "schemaVersion": "1.0",
  "source": "HMI-Problema2",
  "sentAt": "2026-08-14T18:32:10.482Z",
  "session": { "user": "Supervisor", "role": "Supervisor" },
  "snapshot": {
    "status": "RUNNING",
    "targetPosition": 2,
    "hopperOpenPercent": 100,
    "activeMotors": ["MC0", "MC2"]
  },
  "metrics": {
    "runTimeSeconds": 4820.5,
    "batchesProcessed": 137,
    "powerConsumptionKWh": 6.0256,
    "alarmsByBelt": { "C0": 1, "C1": 0, "C2": 5, "C3": 2 },
    "securityEvents": { "REPLAY": 1, "TAMPERING": 2, "UNSIGNED": 1 }
  },
  "derived": {
    "availability": 0.71,
    "mtbfSeconds": 602.5,
    "mttrSeconds": 48.2,
    "kwhPerBatch": 0.044
  },
  "recentEvents": [
    { "ts": "...", "level": "WARNING", "actor": "PLC", "message": "..." }
  ]
}
```

**Reglas del contrato:**

1. **Nunca** se transmiten `hash`, `salt`, contraseñas ni `PLC_SHARED_SECRET`.
2. El campo `message` de los eventos se **sanea** antes del envío (mitigación de RF2-02).
3. El envío es **asíncrono con timeout**; su fallo no interrumpe el ciclo del PLC.
4. `schemaVersion` permite evolucionar el contrato sin romper los workflows.

## 5.7 Restricciones de seguridad del agente (no negociables)

| # | Restricción | Verificación |
|---|---|---|
| S-1 | El conector es **unidireccional**: HMI → n8n. No existe ninguna ruta de retorno hacia `handleNetworkMessage()` | Revisión de código + prueba CP-20 |
| S-2 | La respuesta del agente se trata como **texto para mostrar**, jamás como comando ejecutable | Sin `eval`, sin despacho dinámico |
| S-3 | La **clave de API del LLM** reside exclusivamente en las credenciales de n8n | Inspección del *bundle* desplegado |
| S-4 | El webhook exige **token de autenticación** en cabecera | Petición sin token → 401 |
| S-5 | El contenido del log se **sanea** contra *prompt injection* | Caso práctico de la auditoría (RF-AUD-04) |
| S-6 | El agente **no accede** a la base de usuarios ni a material criptográfico | Contrato de datos de §5.6 |
| S-7 | Toda interacción con el agente queda **registrada en auditoría** | Nuevo nivel de evento `AI_INTERACTION` |

> **Argumento de defensa para la presentación:** la Fase 1 construye un perímetro OT (HMAC + nonce + lockdown). La Fase 2 **no lo perfora**: añade un canal de **telemetría de solo salida**, análogo a un *data diode* industrial. La inteligencia se sitúa fuera del perímetro de control y devuelve únicamente información para el ser humano.

## 5.8 Despliegue

| Componente | Opción recomendada | Notas |
|---|---|---|
| Aplicación HMI | Hosting estático con HTTPS (Netlify, Vercel, GitHub Pages) | Requiere eliminar la dependencia de `server.js` (RF-DEP-05) |
| n8n | Instancia alojada (n8n Cloud, Railway, Render) | Configurar CORS para el dominio del HMI (RF-DEP-03) |
| Modelo LLM | Proveedor con nivel gratuito | La clave se guarda solo en las credenciales de n8n |

### Ajustes necesarios para el hosting estático

1. `usuarios.json` debe servirse como archivo estático junto al `index.html`.
2. Verificar que el proveedor entrega los `.js` con `Content-Type: application/javascript` (necesario para los módulos ES6).
3. La URL del webhook y su token deben ser **configurables**, no estar embebidos en el código.
4. Validar el despliegue desde una **red externa** (no solo desde localhost) en el hito H6.

---

# 6. TRAZABILIDAD REQUISITO → IMPLEMENTACIÓN

| Requisito | Ubicación en el código |
|---|---|
| RF-P-01, RF-P-02 | `plc-simulation.js` → `executeCommand()`, caso `PSELEC` |
| RF-P-03 | `plc-simulation.js` → `updatePhysics()`, actualización de `FC1/FC2/FC3` |
| RF-P-04 | `plc-simulation.js` → estado `ROTATING`, control de `MGIzq`/`MGDer` |
| RF-P-05 | `plc-simulation.js` → transición `ROTATING` → `RUNNING` |
| RF-P-06, RF-P-07 | `plc-simulation.js` → estado `RUNNING`, `config.hopperOpenDelay` |
| RF-P-08, RF-P-09 | `plc-simulation.js` → `executeCommand()`, caso `PPARO` |
| RF-P-10 | `plc-simulation.js` → estado `DISCHARGING_DEST` |
| RF-P-11 | `plc-simulation.js` → `updateStatusLamps()` |
| RF-P-12, RF-P-13 | `plc-simulation.js` → `updatePLCLogic()` §1, `triggerAlarm()` |
| RF-P-14, RF-P-15 | `plc-simulation.js` → `updateAlarmBlinkLamps()`, `alarmBlinkState` |
| RF-P-16 | `plc-simulation.js` → `clearAlarms()` |
| RF-P-17 | `plc-simulation.js` → `control.startupTimers` **(requiere ajuste a 5000 ms)** |
| RF-P-18 | `plc-simulation.js` → `updatePhysics()` §2 |
| RF-A-01 … RF-A-02 | `hmi-controller.js` → `drawConveyorSystem()` |
| RF-A-03 … RF-A-06 | `app.js` → manejadores de eventos, `updateUI()`, `updateForcedSwitches()` |
| RF-B-01, RF-B-02 | `crypto-helper.js` → `createCredential()`, `verifyPassword()` |
| RF-B-03 … RF-B-07 | `auth.js` → `checkPermission()`, `createUser()` |
| RF-B-08 | `hmi-controller.js` → `sendSecureCommand()` |
| RF-B-09 … RF-B-12 | `plc-simulation.js` → `handleNetworkMessage()` |
| RF-B-13 | `plc-simulation.js` → `triggerSecurityLockdown()` |
| RF-B-14 | `audit-log.js` → `logEvent()` |
| RF-B-15 | `hmi-controller.js` → `logNetworkTraffic()`, `getNetworkTraffic()` |
| RF-C-01 | `DOCUMENTACION.md` §6 |
| RF-C-02 | `2026-07-28 11-48-57.mp4` |
| RF-IA-01 … RF-IA-12 | `js/ai-dashboard.js`, `js/stats-engine.js` **(por implementar — §5.3, §5.4)** |
| RF-N8N-01 … RF-N8N-10 | `js/n8n-connector.js`, `n8n/workflows/*.json` **(por implementar — §5.5)** |
| RF-DEP-01 … RF-DEP-07 | Configuración de hosting **(por realizar — §5.8)** |
| RF-AUD-01 … RF-AUD-06 | `INFORME_CIBERSEGURIDAD.md` **(por elaborar)** |

---

# 7. PLAN DE PRUEBAS Y EVIDENCIAS

## 7.1 Puesta en marcha

```bash
node server.js
# Abrir http://localhost:3000
# Credenciales iniciales: admin / admin123
```

> La aplicación **no funciona** abriendo `index.html` con doble clic: requiere el servidor para cargar los módulos ES6 y `usuarios.json`.

## 7.2 Casos de prueba

| CP | Descripción | Pasos | Resultado esperado |
|---|---|---|---|
| CP-01 | Secuencia nominal completa | Selec → Pos 2 · Marcha · esperar 5 s · Paro | Giro a 90°, `MC0`+`MC2` ON, tolva abre a los 5 s, vaciado 20 s + 20 s, retorno a `IDLE` |
| CP-02 | Bloqueo de selección en marcha | Marcha → pulsar Selec | La posición no cambia |
| CP-03 | Vigilancia y alarma | En `RUNNING`, inyectar fallo en `VigC0` | `MC0` OFF, `LDesC0` parpadea a 2 Hz, `LConC2` sigue encendida |
| CP-04 | Acuse de recibo | Con alarma activa, pulsar Paro | Alarmas limpiadas, sistema en `IDLE` |
| CP-05 | Ventana ciega de arranque | Inyectar fallo en `VigC0` inmediatamente tras arrancar | No se dispara alarma dentro de la ventana |
| CP-06 | Parada de emergencia | Pulsar Emergencia en `RUNNING` | Todos los motores OFF, `LDescgC1-3` encendidas |
| CP-07 | Retorno a CI | Tras emergencia, pulsar Reset CI | Ángulo 0°, tolva cerrada, `LS1` encendida |
| CP-08 | RBAC — Gerente | Iniciar sesión como Gerente | Ve KPIs; **sin** acceso a controles de motor |
| CP-09 | RBAC — Operador restringido | Crear Operador sin `CONTROL_MANUAL` | Solo visualización; botones de mando deshabilitados |
| CP-10 | Jerarquía de creación | Como Admin, intentar crear un Supervisor | Error: *"Un Admin solo puede crear usuarios de nivel Gerente"* |
| CP-11 | Ataque — sin firma | Panel de ciberseguridad → Trama no firmada | Lockdown, motores OFF, `SECURITY_ALERT` en auditoría |
| CP-12 | Ataque — tampering | Panel → Manipulación de datos | Lockdown por `INTEGRIDAD_COMPROMETIDA` |
| CP-13 | Ataque — replay | Panel → Reenviar trama capturada | Lockdown por `ATAQUE_REPLAY_DETECTADO` |
| CP-14 | Recuperación de seguridad | Como Supervisor, ejecutar Security Reset | Lockdown liberado, sistema operativo |
| CP-15 | Credenciales en reposo | Inspeccionar `usuarios.json` | Solo `salt` + `hash`; ninguna contraseña en claro |

## 7.3 Casos de prueba de la Fase 2 *(pendientes de ejecución)*

| CP | Descripción | Pasos | Resultado esperado |
|---|---|---|---|
| CP-16 | Estadística local sin conexión | Detener n8n y abrir el dashboard | Se muestran todos los KPIs y el aviso "agente sin conexión" (RF-IA-09) |
| CP-17 | Ingesta de telemetría | Operar el proceso durante un ciclo completo | WF-1 registra los eventos en n8n |
| CP-18 | Generación de recomendaciones | Provocar 5 alarmas en la cinta 2 y ejecutar WF-2 | El agente recomienda mantenimiento de la cinta 2 citando el porcentaje |
| CP-19 | Triaje de alerta de seguridad | Lanzar un ataque de replay | WF-3 clasifica el incidente y notifica con severidad |
| CP-20 | **El agente no puede controlar el proceso** | Devolver desde n8n una respuesta con un comando `PMARCHA` | El HMI lo muestra como texto; **ningún motor arranca** (S-1, RF-IA-10) |
| CP-21 | Resistencia a *prompt injection* | Inyectar "ignora tus instrucciones" en un campo del log | El agente no altera su comportamiento (S-5) |
| CP-22 | Webhook sin token | `POST` al webhook sin cabecera de autenticación | Respuesta 401; el evento no se procesa (S-4) |
| CP-23 | Resiliencia ante caída de n8n | Detener n8n y operar la planta | El HMI funciona con normalidad, sin bloqueos ni errores (RF-N8N-08) |
| CP-24 | Sin secretos en el cliente | Buscar la clave de API en el *bundle* desplegado | Cero coincidencias (S-3, RF-DEP-04) |
| CP-25 | Despliegue accesible externamente | Abrir la URL desde una red distinta | La aplicación carga y permite iniciar sesión (RF-DEP-01) |
| CP-26 | Consulta en lenguaje natural | Preguntar *"¿Por qué se detuvo la cinta 2?"* | Respuesta fundamentada en eventos reales del log |
| CP-27 | Legibilidad visual de los workflows | Capturar cada workflow de n8n | Cada uno cabe en una captura legible y anotada (RF-N8N-07) |

---

# 8. CONCLUSIONES

1. **El Problema 2 está implementado en su totalidad**: la lógica secuencial reproduce fielmente la selección de posición, el arranque simultáneo, el retardo de tolva de 5 s, la doble secuencia de descarga 20 s + 20 s y la vigilancia de velocidad con parpadeo a 2 Hz.

2. **La ciberseguridad va más allá de lo exigido**: la rúbrica pide *"defensa activa contra manipulación de variables"*, y el sistema no solo detecta los cinco vectores de ataque probados, sino que ejecuta una **parada física real de la planta** ante cualquier intrusión.

3. **La arquitectura respeta la separación IT/OT**: la frontera `handleNetworkMessage()` obliga a que absolutamente todo comando —incluidos los originados desde la propia UI— atraviese la misma cadena de validación criptográfica.

4. **El RBAC excede el mínimo de 3 roles** con un cuarto nivel (Admin), jerarquía estricta de creación y capacidades granulares por Operador.

5. **Riesgo residual principal:** la clave HMAC reside en el cliente (RT-01). Es una consecuencia inevitable de la arquitectura exigida y se acepta formalmente, dado que la propia rúbrica requiere demostrar ataques desde la consola del navegador.

6. **Desviación pendiente de corregir:** la ventana ciega de arranque debe pasar de 3 s a **5 s** (RF-P-17 / RT-04) para alinearse exactamente con el enunciado del Problema 2. Es un cambio de dos líneas.

7. **La Fase 2 redefine el centro de gravedad del proyecto.** La IA agéntica integrada con n8n pasa de descartada (v1.0) a **requisito obligatorio y criterio principal de evaluación**. La Sección 5 constituye la especificación completa que debe implementar el Líder de Planta.

8. **La decisión de diseño más importante de la Fase 2 es la doble capa de analítica**: estadística determinista en el navegador e interpretación agéntica en n8n. Garantiza que **el dashboard nunca aparezca vacío** ante el evaluador, aunque falle la nube, la cuota del LLM o la conectividad. Mitiga simultáneamente RF2-06, RF2-08 y RF2-11.

9. **La Fase 2 no debilita la seguridad de la Fase 1.** El canal hacia el agente es de **telemetría unidireccional de solo lectura**, análogo a un *data diode* industrial. El principio “el agente observa y recomienda, pero nunca actúa” es defendible técnicamente y demuestra criterio de ingeniería OT.

10. **Los riesgos dominantes ya no son técnicos sino de gestión.** Con 4 roles, 100 puntos y solo 2 integrantes, los riesgos de mayor nivel son **RP-07** (sobrecarga del Líder de Planta, NR 20), **RP-08** (retraso en el hito H3, NR 20) y **RP-10** (ambición excesiva, NR 20). El control más eficaz es respetar la priorización de §1.7: **primero el impacto visual, después la sofisticación técnica**.

11. **Acciones inmediatas requeridas del equipo:**
    - Confirmar la asignación nominal de roles (§1.5) **antes del viernes**.
    - Congelar la arquitectura de IA y n8n en el hito **H2 (09/08)**.
    - Iniciar el repositorio Git y desplegar de forma temprana; **no dejar el despliegue para el 20/08**.

---

*Informe de Requisitos, Riesgos y Alcance — III Parcial — Automatización Industrial*
*Problema 2 — Miguel Urbina y Moisés Becerra*
