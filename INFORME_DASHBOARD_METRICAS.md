# Informe previo a implementación — Dashboard de Métricas e IA Agéntica

**Proyecto:** HMI Ciberfísico / Celda de Distribución (Problema 2)
**Fecha:** 8 de agosto de 2026
**Alcance de este informe:** análisis del código actual, catálogo completo de métricas implementables, cambios necesarios y preparación para el chatbot agéntico. **No incluye código todavía.**

---

## 1. Resumen ejecutivo

El proyecto ya tiene todo lo necesario para *generar* datos (un PLC simulado a 50 Hz, un log de auditoría persistente y un canal de comandos firmados), pero **casi nada para acumularlos**. Hoy solo existen 3 contadores acumulados (`runTimeSeconds`, `batchesProcessed`, `powerConsumptionKWh`) y **cero historial temporal**, por lo que ninguna métrica de tendencia, disponibilidad, MTBF/MTTR o consumo por componente es calculable con el estado actual.

Tres conclusiones que condicionan todo lo demás:

1. **La pestaña "KPIs & Negocio" es en un 60 % decorativa.** El gráfico de "Distribución de Carga Eléctrica" tiene alturas fijas en el HTML (60 %, 25 %, 15 %, 35 %, 8 %) y el panel de "Mantenimiento Preventivo" es texto estático (`1,432 hrs`, `28 de Septiembre 2026`, desgaste 18 %). No están conectados a la simulación.
2. **Falta una capa de instrumentación.** El 70 % de las métricas del catálogo (§4) no requiere lógica nueva de negocio, sino **contadores y marcas de tiempo dentro de `plc-simulation.js`** más un buffer histórico. Esa es la pieza central del trabajo.
3. **El chatbot agéntico depende de esa misma capa.** Un agente que "charle" sobre la planta necesita hechos numéricos que citar. Si se implementa primero el motor de estadística (`stats-engine.js`) y un contrato de datos limpio, el chatbot es después una capa fina (UI + conector + saneado). Si se hace al revés, el agente alucinará porque no tendrá de dónde leer.

**Recomendación:** implementar en el orden `instrumentación → stats-engine → dashboard visual → conector n8n → chatbot`.

---

## 2. Estado actual: qué hay y qué es real

### 2.1 Lo que sí funciona y es fuente de datos válida

| Fuente | Ubicación | Contenido | Persistencia |
|---|---|---|---|
| `PLC_STATE.inputs` | `plc-simulation.js:7` | 11 señales digitales (FC1-3, FCTol*, VigC0-3, pulsadores) | No (volátil) |
| `PLC_STATE.outputs` | `plc-simulation.js:23` | 22 salidas (8 motores + 14 lámparas) | No (volátil) |
| `PLC_STATE.physical` | `plc-simulation.js:49` | Ángulo, % tolva, material en cintas, 3 acumulados | Parcial (`plcMetrics`) |
| `PLC_STATE.control` | `plc-simulation.js:69` | Estado de la máquina, alarmas, lockdown de seguridad | No |
| `PLC_STATE.config` | `plc-simulation.js:61` | 4 setpoints de temporización | Sí (`plcConfig`) |
| Log de auditoría | `audit-log.js` | 500 eventos con `timestamp` ISO, `type`, `user`, `message`, `details` | Sí (`auditLogs`) |
| Tráfico de red | `hmi-controller.js:9` | Últimos 30 paquetes con HMAC/nonce y respuesta del PLC | **No** (se pierde al recargar) |
| Base de usuarios | `auth.js` + `usuarios.json` | Roles, `createdAt`, `createdBy`, capacidades | Sí (`dynamic_users_pbkdf2`) |

### 2.2 Lo que está simulado visualmente pero no calculado

| Elemento | Ubicación | Problema |
|---|---|---|
| Gráfico de carga eléctrica por componente | `index.html:522-543` | Alturas fijas en el atributo `style`. No hay acumulador de energía por motor. |
| Desgaste Cinta 0 (18 %) | `index.html:554` | Valor literal. No existe modelo de desgaste. |
| Horas para lubricación de MG (1 432 h) | `index.html:560` | Valor literal. No se cuenta el tiempo de MG. |
| Próxima revisión de sensores | `index.html:564` | Fecha fija. |
| Tarifa eléctrica 0,15 USD/kWh | `app.js:76` | *Hardcoded* en la capa de UI; debería ser configuración de negocio. |

> Estos 4 elementos son los que un evaluador señalaría primero. Todos son convertibles a métricas reales con la instrumentación de §5.

---

## 3. Problemas detectados que afectan la fiabilidad de las métricas

Estos hallazgos son previos a cualquier dashboard: si no se corrigen, las gráficas mostrarán números sin sentido.

| # | Hallazgo | Ubicación | Impacto en métricas |
|---|---|---|---|
| P-1 | **`batchesProcessed` no cuenta lotes, cuenta partículas.** Se genera una partícula con probabilidad 0,15 por tick de 20 ms (≈ 7,5/s) y cada una que llega al final de la Cinta 0 incrementa el contador. | `plc-simulation.js:182` y `:204` | "Lotes Procesados" crece ~7 por segundo. Cualquier métrica derivada (lotes/hora, kWh por lote, OEE) queda inflada. **Es el problema más grave del catálogo.** |
| P-2 | **`runTimeSeconds` no es tiempo de calendario**, solo suma cuando hay ≥ 1 motor activo. | `plc-simulation.js:233` | No sirve como denominador de disponibilidad. Falta el tiempo total transcurrido. |
| P-3 | **No hay historial temporal.** Solo se guardan 3 escalares acumulados, sin fecha. | `plc-simulation.js:239` | Imposible: tendencias, sparklines, comparación por turno, detección de anomalías, "¿qué pasó hace 10 minutos?" del chatbot. |
| P-4 | **No hay contadores de alarmas.** `control.alarms` es un booleano por cinta que se limpia al acusar. | `plc-simulation.js:78` | MTBF, MTTR y "alarmas por cinta" no son calculables sin parsear texto del log. |
| P-5 | **No se mide el tiempo en cada estado** de la máquina (IDLE/ROTATING/RUNNING/ALARM/…). | `plc-simulation.js:286` | Sin esto no hay disponibilidad ni MTTR reales. |
| P-6 | **Escritura en `localStorage` a 50 Hz** mientras hay motores activos. | `plc-simulation.js:239` | Serialización JSON 50 veces por segundo; al añadir historial esto degradará la UI. Debe pasar a escritura periódica (cada 5–10 s). |
| P-7 | **Material perdido silenciosamente.** Si la cinta de destino está parada, la partícula se elimina igual (`return false`) pero no se contabiliza. | `plc-simulation.js:194-209` | Es exactamente la métrica de *calidad/scrap* que falta para completar un OEE. Hoy se descarta información valiosa. |
| P-8 | **`getCurrentUser()` no devuelve `capabilities`**: `login()` guarda solo `username`, `role`, `name`, `isSystem`. | `auth.js:158` vs `auth.js:305` | `checkPermission('BASIC_CONTROL')` siempre es falso para Operador → el checklist de permisos no tiene efecto real. Afecta a cualquier panel del dashboard que se filtre por capacidad. |
| P-9 | **El tráfico de red no persiste** (array en memoria, tope 30). | `hmi-controller.js:9,20` | Las métricas de ciberseguridad (rechazos, replays, latencia) se pierden al recargar y no pueden alimentar al agente. |
| P-10 | **`receivedNonces` crece sin límite** y nunca purga por antigüedad, pese a existir `maxNonceAgeMs`. | `plc-simulation.js:94` | Fuga de memoria lenta en sesiones largas; distorsiona una métrica de "nonces en ventana". |
| P-11 | **Credenciales incorrectas en la pantalla de login**: se anuncia `admin / manager123`, `operador / operator123`, `ingeniero / engineer123`, pero el único usuario real es `admin / admin123`. | `index.html:57-59` | No es una métrica, pero un evaluador probará esas credenciales y fallarán. |
| P-12 | **`updateUI()` hace ~25 `getElementById` a 50 Hz.** | `app.js:25` | Añadir un dashboard con gráficos a ese bucle causará caída de FPS (RNF-01). El dashboard debe refrescar a 1 Hz, no a 50 Hz. |

---

## 4. Catálogo de métricas implementables

Leyenda de **Estado**: 🟢 calculable ya · 🟡 requiere contador nuevo (esfuerzo bajo) · 🔴 requiere historial temporal o modelo nuevo.

### A. Producción y rendimiento

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| A-1 | Lotes procesados (corregido) | Contador por *ciclo de descarga* completo, no por partícula (ver P-1) | 🟡 | Tarjeta KPI |
| A-2 | Unidades transferidas | Partículas que pasan de C0 a destino | 🟢 | Tarjeta secundaria |
| A-3 | Rendimiento (lotes/hora) | `lotes / horas en RUNNING` | 🔴 | Línea temporal |
| A-4 | Reparto por destino (Pos 1/2/3) | Conteo de transferencias por `targetPosition` | 🟡 | Gráfico de dona |
| A-5 | Material perdido / scrap | Partículas descartadas con la cinta destino parada (P-7) | 🟡 | Tarjeta + barra |
| A-6 | Tasa de calidad | `1 − scrap / total` | 🟡 | Gauge |
| A-7 | **OEE** | `Disponibilidad × Rendimiento × Calidad` | 🔴 | Gauge principal |
| A-8 | Throughput instantáneo | Partículas/min en ventana móvil de 60 s | 🔴 | Sparkline |
| A-9 | Ocupación de cintas | `materialOnCinta0.length`, `materialOnDest.length` | 🟢 | Barra en vivo |
| A-10 | Producción por turno / por sesión | Delta de contadores entre marcas de inicio | 🔴 | Tabla comparativa |

### B. Energía y coste

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| B-1 | Consumo total (kWh) | Ya existe | 🟢 | Tarjeta KPI |
| B-2 | **Consumo por motor** (MC0-3, MG, Tolva) | Acumulador `kWh` por salida activa | 🟡 | Barras — *sustituye al gráfico falso* |
| B-3 | Potencia instantánea (kW) | `nº motores activos × 1,5 kW` | 🟢 | Medidor en vivo + sparkline |
| B-4 | Consumo por lote (kWh/lote) | `kWh / lotes` | 🟡 | Tarjeta + tendencia |
| B-5 | Coste acumulado (USD) | `kWh × tarifa` (tarifa configurable) | 🟢 | Tarjeta KPI |
| B-6 | Coste por lote | `coste / lotes` | 🟡 | Tarjeta |
| B-7 | Energía desperdiciada en vacío | kWh consumidos con la tolva cerrada y sin material | 🟡 | Tarjeta + recomendación IA |
| B-8 | Perfil de consumo por hora | Serie temporal agregada | 🔴 | Gráfico de área |
| B-9 | Huella de CO₂ estimada | `kWh × factor de emisión` | 🟡 | Tarjeta (buen efecto en la presentación) |

### C. Disponibilidad y fiabilidad (RAMS)

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| C-1 | Disponibilidad | `t(RUNNING) / t(total)` | 🔴 | Gauge |
| C-2 | Tiempo en cada estado | Acumulador por estado de la máquina | 🟡 | Barra apilada horizontal |
| C-3 | **MTBF** | `t operativo / nº alarmas` | 🟡 | Tarjeta + tendencia |
| C-4 | **MTTR** | `t total en ALARM / nº alarmas` | 🟡 | Tarjeta |
| C-5 | Alarmas por cinta (C0-C3) | Contador por flanco en `triggerAlarm()` | 🟡 | Barras |
| C-6 | Nº de paradas de emergencia | Contador de comandos `EMERGENCY` | 🟡 | Tarjeta |
| C-7 | Tiempo hasta el primer fallo | Marca temporal de la primera alarma | 🟡 | Tarjeta |
| C-8 | Disponibilidad por cinta | Tiempo de motor activo vs. tiempo requerido | 🔴 | Barras comparadas |
| C-9 | Horas de servicio por actuador | Acumulado de horas de MC0-3, MG, Tolva | 🟡 | Tabla — *base del panel de mantenimiento real* |
| C-10 | Ciclos de operación por actuador | Conteo de flancos de subida por salida | 🟡 | Tabla |
| C-11 | Desgaste estimado | `horas / vida útil nominal` por componente | 🟡 | Barras de progreso — *sustituye al 18 % falso* |
| C-12 | Próximo mantenimiento previsto | `(umbral − horas acumuladas) / ritmo de uso` | 🔴 | Tarjeta con fecha calculada |

### D. Proceso y tiempos de ciclo

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| D-1 | Tiempo de posicionamiento (ROTATING) | Duración medida por transición de estado | 🟡 | Tarjeta + histograma |
| D-2 | Tiempo de ciclo completo | De `PMARCHA` a vuelta a `IDLE` | 🟡 | Línea temporal |
| D-3 | Tiempo real de vaciado vs. setpoint | Momento en que las cintas quedan vacías vs. `cinta0DischargeTime` | 🔴 | Barras comparadas — *base de la recomendación de setpoints de §5.4 del informe de proyecto* |
| D-4 | Nº de ciclos de la tolva | Flancos de `FCTolAb` | 🟡 | Tarjeta |
| D-5 | Apertura media de la tolva | Media móvil de `hopperOpenPercent` | 🟡 | Sparkline |
| D-6 | Grados totales girados por MG | Integral de `currentAngle` | 🟡 | Tarjeta (desgaste del reductor) |
| D-7 | Cambios de destino (PSELEC) | Contador de comandos | 🟡 | Tarjeta |
| D-8 | Latencia comando → reacción | `t(respuesta) − payload.timestamp` | 🟢 | Tarjeta (verifica RNF-02) |
| D-9 | Histograma de duración por estado | Serie de duraciones | 🔴 | Histograma |

### E. Ciberseguridad OT

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| E-1 | Comandos aceptados vs. rechazados | Respuestas de `handleNetworkMessage()` | 🟡 | Dona |
| E-2 | Eventos por tipo de ataque | `SECURITY_ALERT` agrupado por `details.reason` (5 tipos ya codificados) | 🟡 | Barras apiladas |
| E-3 | Nº de *lockdowns* del firewall OT | Contador en `triggerSecurityLockdown()` | 🟡 | Tarjeta |
| E-4 | MTTR de seguridad | Tiempo entre lockdown y `SECURITY_RESET` | 🟡 | Tarjeta |
| E-5 | Intentos de login fallidos | `WARNING` de `AUTH_SYSTEM` (requiere tipo estructurado) | 🟡 | Barras por usuario |
| E-6 | Comandos por usuario y rol | Eventos `OPERATION` del log | 🟢 | Barras |
| E-7 | Forzados de actuador (bypass de lógica) | Comandos `FORCE_ACTUATOR` | 🟢 | Tabla + tarjeta de riesgo |
| E-8 | Inyecciones de falla | Comandos `INJECT_FAULT` | 🟢 | Tarjeta |
| E-9 | Cambios de configuración (setpoints) | `CONFIG_CHANGE` | 🟢 | Línea temporal de cambios |
| E-10 | Nonces en ventana / tasa de replay | Tamaño de `receivedNonces` y duplicados | 🟡 | Tarjeta |
| E-11 | Índice de exposición OT | Compuesto: forzados + fallas + rechazos ponderados | 🔴 | Gauge de riesgo |
| E-12 | Cronología de incidentes | Serie de eventos de seguridad | 🔴 | Línea de tiempo |

### F. RBAC, usuarios y trazabilidad

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| F-1 | Usuarios por rol | `getAllUsers()` | 🟢 | Dona |
| F-2 | Árbol de creación (quién creó a quién) | `createdBy` | 🟢 | Lista jerárquica / pirámide |
| F-3 | Sesiones iniciadas y cerradas | Eventos `INFO` de login/logout | 🟡 | Tarjeta |
| F-4 | Duración media de sesión | Diferencia entre login y logout | 🔴 | Tarjeta |
| F-5 | Acciones por rol | `OPERATION` + `CONFIG_CHANGE` agrupados | 🟢 | Barras apiladas |
| F-6 | Cobertura de auditoría | `% comandos con nonce registrado` (verifica RNF-09) | 🟢 | Tarjeta |
| F-7 | Distribución de tipos de evento | Conteo por `type` del log | 🟢 | Dona |

### G. Salud del HMI y del sistema

| # | Métrica | Fórmula / origen | Estado | Visual sugerido |
|---|---|---|---|---|
| G-1 | FPS reales del bucle de simulación | Media de `dt` | 🟢 | Sparkline (verifica RNF-01) |
| G-2 | Deriva del ciclo (jitter) | Desviación de `dt` respecto a 20 ms | 🟢 | Tarjeta |
| G-3 | Uso de `localStorage` | Bytes de las claves del proyecto | 🟢 | Barra de capacidad |
| G-4 | Tamaño del log de auditoría | `getLogs().length` / 500 | 🟢 | Barra |
| G-5 | Tiempo desde el último reinicio | Marca de inicio de sesión | 🟡 | Tarjeta |
| G-6 | Estado del conector n8n / agente | Ping al webhook | 🔴 | LED de conexión (RF-IA-11) |

**Total: 60 métricas.** Un dashboard usable no debe mostrarlas todas: la propuesta es **12–16 visibles por rol** (§7) y el resto disponible para el agente vía consulta en lenguaje natural.

---

## 5. Cambios necesarios en el código

### 5.1 Instrumentación (base de todo) — `plc-simulation.js`

Es el cambio de mayor impacto y el de mayor riesgo de regresión, porque toca el bucle del PLC.

1. **Nuevo bloque `PLC_STATE.stats`** con acumuladores:
   - `stateTime: { IDLE, ROTATING, RUNNING, DISCHARGING_C0, DISCHARGING_DEST, ALARM, EMERGENCY_LOCK }` en segundos.
   - `alarmCount: { C0..C3 }` incrementado **por flanco** dentro de `triggerAlarm()`.
   - `motorSeconds` y `motorKWh` por salida (`MC0..MC3`, `MGIzq`, `MGDer`, `MTolAb`, `MTolCe`).
   - `motorCycles`: flancos de subida por salida.
   - `batchesByDest: { 1, 2, 3 }` y `scrapCount`.
   - `commandCounts` por tipo de comando y `rejectedCommands` por motivo.
   - `securityEvents: { COMANDO_NO_FIRMADO, INTEGRIDAD_COMPROMETIDA, ATAQUE_REPLAY_DETECTADO, TRAMA_EXPIRADA, FORMATO_CORRUPTO }`.
   - `totalElapsedSeconds` (tiempo de calendario, denominador de disponibilidad → resuelve P-2).
   - `firstAlarmAt`, `lastAlarmAt`, `lockdownCount`.
2. **Corregir el contador de lotes (P-1):** mantener `unitsTransferred` (partículas) y definir `batchesProcessed` como ciclo productivo completo (`RUNNING → IDLE` con material entregado). Preservar el nombre en la UI para no romper `app.js:72`.
3. **Contabilizar el scrap (P-7)** en la rama donde el motor de destino está parado.
4. **Sustituir el guardado a 50 Hz (P-6)** por un `flush` cada 5 s y en eventos clave (parada, alarma, logout).
5. **Purgar `receivedNonces` (P-10)** por antigüedad usando `maxNonceAgeMs`.
6. **Emitir eventos de dominio** (`CustomEvent`) en transiciones de estado, alarma y lockdown, para que el motor de estadística no tenga que sondear.

### 5.2 Nuevo módulo `js/history-store.js`

- Buffer circular en `localStorage` (clave `plcHistory`) con **una muestra cada 5 s**: `{ t, status, batches, units, scrap, kWh, activeMotors, alarmCount }`.
- Tope 2 000 muestras ≈ 2,8 h de historia continua (~250 KB, holgado frente al límite de 5 MB).
- API: `push(sample)`, `range(desde, hasta)`, `downsample(n)`, `clear()`, `sizeBytes()`.
- Es el requisito bloqueante para las 14 métricas 🔴 y para que el chatbot responda "¿qué pasó hace media hora?".

### 5.3 Nuevo módulo `js/stats-engine.js`

- Funciones **puras y deterministas** que reciben `PLC_STATE`, el historial y el log de auditoría, y devuelven un objeto de KPIs.
- `computeKPIs()`, `computeReliability()`, `computeEnergy()`, `computeSecurity()`, `computeTrends(ventana)`, `detectAnomalies(baseline)`.
- Debe funcionar **sin red**: es lo que garantiza que el dashboard tenga contenido aunque n8n falle (RF-IA-09).
- Además es el "motor de reglas" de respaldo del chatbot cuando no hay conexión.

### 5.4 Nuevo módulo `js/charts.js`

- Sin dependencias externas (RNF-10 prohíbe `npm install`, y el hosting estático de la Fase 2 desaconseja CDNs).
- Renderizadores en **SVG** (no Canvas: más fácil de estilar con las variables CSS existentes y accesible): `lineChart`, `barChart`, `stackedBar`, `donut`, `gauge`, `sparkline`, `timeline`.
- Paleta reutilizando las variables ya definidas en `styles.css` (`--accent-cyan`, `--accent-green`, `--accent-yellow`, `--accent-orange`).

### 5.5 Nuevo módulo `js/dashboard.js` + pestaña en `index.html`

- Nueva pestaña **"📊 Analítica & IA"** (`tab-analytics`), añadida al array de pestañas de `app.js:341` y `app.js:528`.
- Refresco **a 1 Hz** con `setInterval` propio, desacoplado del bucle de 50 Hz (resuelve P-12).
- Reconstruir la pestaña "KPIs & Negocio" existente: sustituir el gráfico falso (B-2 real) y el panel de mantenimiento falso (C-9/C-11/C-12 reales).

### 5.6 Cambios en módulos existentes

| Archivo | Cambio |
|---|---|
| `app.js` | Cachear referencias DOM; separar el render de KPIs del bucle de 50 Hz; registrar la nueva pestaña; extraer la tarifa eléctrica a configuración. |
| `audit-log.js` | Añadir tipos `AI_INTERACTION` y `AUTH_FAIL`; añadir `code` estructurado en `details` para no depender del texto; añadir `getLogsSince(ts)` y `getLogsByType()` para el agente. |
| `auth.js` | **Corregir P-8**: incluir `capabilities` en el objeto de sesión; añadir `VIEW_ANALYTICS` y `USE_AI_ASSISTANT` a `checkPermission()`. |
| `hmi-controller.js` | Persistir el tráfico de red (P-9) y ampliar el tope de 30 a ~200 entradas; medir la latencia comando→respuesta (D-8). |
| `index.html` | Nueva pestaña, nuevos contenedores, widget del chat; **corregir las credenciales anunciadas (P-11)**. |
| `styles.css` | Estilos de gráficos SVG, rejilla de tarjetas, burbujas del chat, indicador de conexión del agente. |
| `build_bundle.js` | **Añadir los nuevos módulos al array `FILES` en el orden correcto de dependencias.** |

### 5.7 Restricción operativa crítica del proyecto

`index.html:649` carga **`bundle.js`**, no los módulos ES6. Los archivos de `js/` son la fuente, pero **el navegador no los ejecuta**. Por tanto:

> **Toda modificación en `js/` exige ejecutar `node build_bundle.js` antes de probar.** Sin ese paso, los cambios no se ven y se pierde tiempo depurando código que no está corriendo.

Además, el *stripper* de `build_bundle.js` es un conjunto de expresiones regulares que solo maneja `import` al inicio de línea y `export function|class|const|let|var`. Los nuevos módulos deben respetar ese estilo (nada de `export { a, b }` a mitad de archivo ni `export default` de expresiones).

---

## 6. Preparación para la IA agéntica (chatbot)

El `INFORME_PROYECTO.md` ya especifica la arquitectura (§5.2, §5.6, §5.7): agente en n8n, canal unidireccional, clave de API solo en n8n. Este informe la complementa con lo que hace falta **del lado del HMI** para que un chat conversacional funcione.

### 6.1 Qué necesita el chatbot que hoy no existe

| Necesidad | Por qué | Depende de |
|---|---|---|
| Hechos numéricos que citar | Sin KPIs reales el agente inventa cifras | §5.3 `stats-engine.js` |
| Memoria temporal ("hace 10 min…") | Hoy no hay historia | §5.2 `history-store.js` |
| Historial de conversación | Un chat necesita contexto multiturno | Nuevo `chat-store.js` |
| Contexto acotado en tokens | 500 eventos de log no caben ni conviene enviarlos | Resumen + top-N eventos |
| Saneado anti *prompt injection* | Nombres de usuario y mensajes del log son texto controlable por el usuario | Sanitizador en el conector |
| Trazabilidad de la IA | Requisito S-7 del informe | Tipo `AI_INTERACTION` |
| Modo degradado | La demo no puede depender de la red | Respuestas por reglas desde `stats-engine` |

### 6.2 Decisión de arquitectura: dónde vive el LLM

| Opción | Ventaja | Inconveniente | Veredicto |
|---|---|---|---|
| **A. n8n como proxy** (webhook `POST /hmi-ask`) | La clave de API nunca sale de n8n (RF-DEP-04, S-3); permite WF-5 tal como está especificado | Latencia extra; sin *streaming* sencillo; requiere n8n disponible | **Recomendada** — es lo que ya exige el informe de proyecto |
| B. Llamada directa a la API del LLM desde el navegador | Menor latencia, *streaming* nativo | **Expondría la clave en el bundle**; incumple RF-DEP-04 y S-3 | Descartada |
| C. Backend propio mínimo | Control total | Incumple RF-DEP-05 (hosting estático) y añade despliegue | Descartada para esta fase |

### 6.3 Diseño funcional del chat

- **Ubicación:** widget flotante persistente entre pestañas (mejor que una pestaña propia: permite preguntar mientras se mira el proceso). Cabecera con LED de estado del agente (RF-IA-11).
- **Contexto enviado por mensaje:** el contrato de §5.6 del informe de proyecto + `derived` de `stats-engine` + últimos N eventos saneados + los últimos 6 turnos de conversación.
- **Herramientas de solo lectura:** en lugar de dar acceso libre, definir un catálogo cerrado que n8n puede pedir de vuelta y que el cliente resuelve *antes* de enviar (`getKPIs`, `getAlarms`, `getEnergyBreakdown`, `getSecurityEvents`, `getAuditSlice`, `getHistory`). Ninguna función de escritura, ninguna que toque `handleNetworkMessage()`.
- **RBAC del asistente:** Gerente → lenguaje de negocio (coste, OEE, turno); Supervisor → diagnóstico técnico y seguridad; Operador → estado y ayuda operativa; **ningún rol** obtiene datos de `usuarios.json`, hashes, salts ni `PLC_SHARED_SECRET`.
- **Sugerencias rápidas** ("¿Por qué bajó la disponibilidad?", "¿Qué cinta falla más?", "Resume el turno") — mejoran la demo y acotan el espacio de preguntas.
- **Modo degradado:** si el webhook no responde en *N* segundos, responder con plantillas generadas por `stats-engine` y marcar la respuesta como "local, sin agente".

### 6.4 Riesgos de seguridad que introduce el chat

| Riesgo | Mitigación propuesta |
|---|---|
| *Prompt injection* vía nombre de usuario o mensaje del log (ej.: crear un usuario llamado "ignora tus instrucciones") | Sanear, truncar y delimitar el contenido no confiable; instrucción de sistema explícita de que el log es *datos*, no órdenes |
| Fuga de material criptográfico | Lista blanca de campos en el constructor del *payload*; nunca serializar `PLC_STATE` completo |
| El agente sugiere un comando y alguien lo automatiza | S-1/S-2: respuesta tratada como texto; sin `eval`, sin despacho dinámico; revisión de código explícita |
| Coste/cuota del LLM durante la demo | *Throttle* por usuario, límite de mensajes por sesión, caché de respuestas idénticas |
| Token del webhook visible en el bundle | Asumir que es un token de baja confianza; alcance mínimo en n8n y rotación tras la entrega |

---

## 7. Propuesta de dashboard por rol

| Rol | Pestaña | Contenido propuesto |
|---|---|---|
| **Gerente** | KPIs & Negocio | OEE (A-7), disponibilidad (C-1), lotes y rendimiento (A-1/A-3), coste y coste por lote (B-5/B-6), reparto por destino (A-4), tendencia de consumo (B-8), informe de turno del agente |
| **Supervisor** | Analítica & IA | MTBF/MTTR (C-3/C-4), alarmas por cinta (C-5), tiempo por estado (C-2), consumo por motor (B-2), vaciado real vs. setpoint (D-3), recomendaciones del agente |
| **Supervisor / Admin** | Ciberseguridad | Aceptados vs. rechazados (E-1), eventos por tipo (E-2), forzados e inyecciones (E-7/E-8), cronología de incidentes (E-12), índice de exposición (E-11) |
| **Operador** | HMI Principal | Potencia instantánea (B-3), unidades del turno (A-2), estado y ocupación (A-9), tiempo desde la última alarma |
| **Todos** | Widget de chat | Preguntas acotadas por rol |

---

## 8. Plan de implementación propuesto

| Fase | Contenido | Tamaño | Bloquea a |
|---|---|:---:|---|
| **F0** | Correcciones previas: P-1, P-2, P-6, P-8, P-10, P-11 | S | Todo el catálogo |
| **F1** | Instrumentación `PLC_STATE.stats` (§5.1) | M | F2, F3 |
| **F2** | `history-store.js` (§5.2) | S | Métricas 🔴 y memoria del chat |
| **F3** | `stats-engine.js` (§5.3) | M | Dashboard y agente |
| **F4** | `charts.js` (§5.4) | M | Dashboard |
| **F5** | Pestaña "Analítica & IA" + reconstrucción de KPIs & Negocio (§5.5) | L | — |
| **F6** | `n8n-connector.js` (telemetría *fire-and-forget*) + tipo `AI_INTERACTION` | M | F7 |
| **F7** | Widget de chat + modo degradado por reglas | M | — |
| **F8** | Workflows de n8n (WF-1…WF-5) y despliegue estático | L | — |

**Ruta crítica:** F0 → F1 → F3 → F5. Las fases F4 y F6 pueden paralelizarse.

---

## 9. Decisiones que necesito confirmar antes de programar

1. **¿Corregimos `batchesProcessed` (P-1) o mantenemos la semántica actual?** Corregirlo cambia los números que ya se han mostrado en capturas o vídeos previos, pero sin corregirlo el OEE y el kWh/lote carecen de sentido. *Recomendación: corregir y conservar `unitsTransferred` como métrica secundaria.*
2. **Alcance del dashboard:** ¿pestaña nueva "Analítica & IA" separada, o se absorbe todo dentro de "KPIs & Negocio"? *Recomendación: pestaña nueva; la de KPIs se queda como vista ejecutiva del Gerente.*
3. **Gráficos:** ¿SVG propio sin dependencias (mi recomendación, compatible con RNF-10 y con hosting estático) o se acepta una librería vendorizada en el repositorio?
4. **Persistencia:** `localStorage` con buffer circular (simple, suficiente para ~3 h) o IndexedDB (más capacidad, más código). *Recomendación: `localStorage`.*
5. **Chat:** ¿widget flotante global o pestaña dedicada?
6. **n8n:** ¿ya hay instancia y URL de webhook disponibles, o el chat debe construirse primero contra el modo degradado local y conectarse después?

---

*Informe elaborado a partir de la lectura completa de `plc-simulation.js`, `app.js`, `auth.js`, `audit-log.js`, `hmi-controller.js`, `index.html`, `server.js`, `build_bundle.js`, `DOCUMENTACION.md` e `INFORME_PROYECTO.md` (§2.5–2.9 y §5).*
