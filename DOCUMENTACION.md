# Documentación Técnica — Sistema de Control Industrial HMI Ciberfísico
**Parcial 3 — Automatización Industrial**

---

## 1. Descripción General del Proyecto

El proyecto consiste en una **aplicación web de monitoreo y control industrial (HMI - Human Machine Interface)** que simula un sistema automatizado de control de planta basado en la **Pirámide de Automatización**. Integra seguridad OT (Operational Technology), control de acceso basado en roles (RBAC), simulación física de una planta de cintas transportadoras y tolva de alimentación, y un sistema de ciberseguridad industrial con detección de ataques de red.

---

## 2. Arquitectura del Sistema

### Archivos Principales

| Archivo | Tipo | Descripción |
|---|---|---|
| `index.html` | Frontend | Interfaz única que integra todas las pantallas del sistema |
| `styles.css` | Estilos | Diseño premium (Glassmorphism, modo oscuro, animaciones) |
| `js/app.js` | Lógica principal | Orquestación del HMI, manejo de eventos y renderizado de UI |
| `js/auth.js` | Autenticación | RBAC, login/logout, creación de usuarios con PBKDF2-SHA256 |
| `js/crypto-helper.js` | Criptografía | Hashing PBKDF2-SHA256 con salt, generación y verificación de HMAC |
| `js/hmi-controller.js` | Renderizado | Simulación visual 2D del proceso industrial (Canvas API) |
| `js/plc-simulation.js` | Simulación PLC | Motor de simulación física del PLC (cintas, tolva, sensores) |
| `js/audit-log.js` | Auditoría | Registro de eventos del sistema |
| `server.js` | Backend | Servidor HTTP de archivos estáticos en Node.js |
| `usuarios.json` | Base de datos | Usuarios del sistema con hashes PBKDF2-SHA256 |

---

## 3. Modelo de Roles — Pirámide de Automatización

El sistema implementa una jerarquía estricta de 4 niveles basada en la Pirámide de Automatización ISA-95:

```
        +----------------------------------+
        |         ADMIN (Nivel 4)          |  Super Usuario / Nivel ERP
        |     Super Usuario del Sistema    |
        +------------------+---------------+
                           | Crea
        +------------------v---------------+
        |      GERENTE (Nivel 3)           |  Nivel MES / Gestión
        |  Métricas, KPIs, Finanzas, Lotes |
        +------------------+---------------+
                           | Crea
        +------------------v---------------+
        |    SUPERVISOR (Nivel 2)          |  Nivel SCADA / Supervisión
        |  Setpoints, Forzado, Auditoría   |
        +------------------+---------------+
                           | Crea
        +------------------v---------------+
        |      OPERADOR (Nivel 1)          |  Nivel HMI / Control
        |    Panel HMI + permisos propios  |
        +----------------------------------+
```

### Reglas de Jerarquía Estricta

- Cada rol **solo puede crear el nivel inmediatamente inferior**.
- Admin → Gerente (solo puede crear Gerentes)
- Gerente → Supervisor (solo puede crear Supervisores)
- Supervisor → Operador (solo puede crear Operadores con checklist)
- Operador → No tiene acceso a gestión de usuarios.

### Permisos por Rol

| Permiso | Admin | Gerente | Supervisor | Operador |
|---|:---:|:---:|:---:|:---:|
| Ver Dashboard HMI | SI | NO | SI | SI |
| Control Básico (Marcha/Paro) | SI | NO | SI | Configurable |
| Cambiar Setpoints | SI | NO | SI | Configurable |
| Forzar Actuadores | SI | NO | SI | NO |
| Ver Auditoría | SI | NO | SI | NO |
| Ver Métricas/KPIs | SI | SI | NO | NO |
| Gestión de Usuarios | SI | SI | SI | NO |
| Simulación Ciberseguridad | SI | NO | SI | NO |

### Checklist Dinámico para Operadores

Al crear un Operador, el Supervisor puede asignarle permisos granulares:

- [X] Solo Ver — Siempre activo (visualización básica del proceso)
- [ ] Control Manual — Permite encender/apagar motores y actuadores
- [ ] Cambiar Setpoints — Permite ajustar temporizadores y umbrales de alerta

---

## 4. Seguridad y Criptografía

### Autenticación de Usuarios: PBKDF2-SHA256

Las contraseñas **nunca se almacenan en texto plano**. Se utiliza el algoritmo PBKDF2 con la siguiente configuración:

- Algoritmo de hash: SHA-256
- Iteraciones: 100,000
- Longitud del hash: 32 bytes (256 bits)
- Salt: 16 bytes aleatorios únicos por usuario (generados con crypto.getRandomValues)
- API: Web Cryptography API nativa del navegador (SubtleCrypto)

Flujo de creación:
Contraseña → [Salt aleatorio] → PBKDF2-SHA256 (100k iter) → Hash almacenado

Flujo de verificación:
Contraseña ingresada + Salt del usuario → PBKDF2-SHA256 → Comparar con Hash guardado

### Comunicación PLC: HMAC-SHA256 + Nonce Anti-Replay

Todos los comandos enviados al PLC simulado son protegidos con:

- HMAC-SHA256 firmado con una clave secreta compartida.
- Nonce único por paquete (generado con crypto.randomUUID) para prevenir ataques de repetición.
- Timestamp incluido en el payload para detectar comandos obsoletos.

Estructura de un paquete de comando:
```json
{
  "payload": {
    "command": "PMARCHA",
    "user": "Supervisor (Supervisor)",
    "timestamp": 1722175200000,
    "nonce": "a3f9c2d1-..."
  },
  "hmac": "e3b0c44298fc1c149afbf4c8..."
}
```

### Simulación de Ataques Cibernéticos

El módulo de Ciberseguridad permite demostrar 3 vectores de ataque contra sistemas ICS/SCADA:

1. **Trama No Firmada:** Inyección de comando sin HMAC → El PLC rechaza el paquete.
2. **Manipulación de Datos (Tampering):** Se genera un HMAC válido pero se modifica el payload → El PLC detecta la manipulación.
3. **Ataque de Repetición (Replay):** Se reenvía una trama válida previamente capturada → El PLC detecta el nonce duplicado.

---

## 5. Simulación Física de la Planta

El módulo `plc-simulation.js` implementa un motor de simulación en tiempo real:

### Componentes Simulados

| Componente | ID | Descripción |
|---|---|---|
| Cinta Principal (Plataforma) | MC0 | Cinta central sobre la plataforma giratoria |
| Cinta de Destino 1 (Izquierda) | MC1 | Destino lateral izquierdo |
| Cinta de Destino 2 (Abajo) | MC2 | Destino vertical hacia abajo |
| Cinta de Destino 3 (Derecha) | MC3 | Destino lateral derecho |
| Motor de Giro de Plataforma | MG | Plataforma giratoria de clasificación |
| Tolva de Alimentación | TOLVA | Depósito de material con compuerta deslizante |

### Sensores y Finales de Carrera

| Sensor | Función |
|---|---|
| FC1, FC2, FC3 | Detectan alineamiento de la plataforma con cada cinta de destino |
| FCTolCe / FCTolAb | Estado de la compuerta de la tolva (Cerrada / Abierta) |
| VigC0 – VigC3 | Sensores de velocidad que detectan fallos de marcha en cada cinta |

### Renderizado Canvas 2D (HMI Visual)

El módulo `hmi-controller.js` renderiza la planta en tiempo real (~50 FPS) usando la API Canvas 2D con:

- Fondo con gradiente radial oscuro y rejilla de puntos.
- Plataforma giratoria con gradientes metálicos, tornillos decorativos, LED de estado y anillo dentado animado.
- Cintas transportadoras con rodillos 3D, bandas animadas y resplandor de estado activo.
- Tolva de alimentación con gradiente metálico, remaches decorativos y partículas animadas.
- Finales de carrera y sensores con LEDs de resplandor y carcasas metálicas redondeadas.
- Barra de estado integrada en el canvas inferior.

---

## 6. Prompts de Diseño Utilizados

A continuación se documentan los requerimientos (prompts) utilizados para implementar cada módulo:

---

### Prompt 1 — Consolidación en Aplicación Única

Requerimiento:
"No son aplicaciones distintas, es una sola aplicación donde estén implementados todo en una sola."

Implementación: Se unificó toda la lógica y vistas en un único `index.html` con secciones dinámicas
que se muestran/ocultan según el rol del usuario activo. Se eliminó el archivo `admin.html` separado.

---

### Prompt 2 — Sistema de Roles RBAC

Requerimiento:
"Necesito que también se pueda crear cualquier tipo de usuario en esta pantalla. Quiero que se cumplan
las limitantes de cada usuario:
- Rol Operador (Nivel Control): Visualización en tiempo real y mandos básicos (Start/Stop).
- Rol Ingeniero/Supervisor (Nivel Planta): Ajustar temporizadores, forzar actuadores e inspeccionar auditoría.
- Rol Gerente (Nivel ERP): Acceso exclusivo a métricas globales sin control de motores."

Implementación: Se implementó `applyRBACPermissions()` en app.js y `checkPermission()` en auth.js
que controlan dinámicamente pestañas, botones y controles según el rol activo.

---

### Prompt 3 — Pirámide de Automatización y Checklist

Requerimiento:
"Pues usen la pirámide de automatización, iniciamos un super usuario que crea al Gerente (nivel más alto),
el Gerente al Supervisor (nivel medio) y este los operadores de planta. Pueden incluir un checklist para
darles a los operarios funcionalidades como: solo ver, cambiar setpoints, encendido/apagado manual."

Implementación:
- Se introdujo el rol Admin como Super Usuario inicial (usuario: admin, contraseña: admin123).
- Se estableció la jerarquía de creación estricta con validación en createUser() de auth.js.
- Se añadió un array capabilities[] por usuario Operador para permisos granulares.
- Se agregó el Checklist Dinámico en el formulario de creación, visible únicamente al seleccionar "Operador".

---

### Prompt 4 — Seguridad PBKDF2-SHA256

Requerimiento implícito derivado de los requerimientos de seguridad OT del parcial.

Implementación: El módulo `crypto-helper.js` implementa las funciones `createCredential()` y
`verifyPassword()` usando la Web Cryptography API con el estándar PBKDF2-SHA256 (100,000 iteraciones,
salt único de 16 bytes por usuario generado con crypto.getRandomValues).

---

### Prompt 5 — Diseño Premium

Requerimiento:
"Haz la aplicación más bonita y con más diseño."

Implementación en `styles.css`:
- Sistema de colores Obsidian (#09090b) con acentos de neón Cyan (#06b6d4) y Azul (#3b82f6).
- Efecto Glassmorphism en todas las tarjetas con backdrop-filter: blur(16px).
- Animaciones CSS: fade-in-up (entrada de paneles), pulse-glow (LEDs activos), float.
- Botones con gradiente lineal Cyan→Azul, elevación y resplandor al hover (box-shadow glow).
- Inputs con anillo de enfoque luminoso en Cyan al hacer clic.
- Título de la pantalla de login con texto degradado animado (gradient text).

---

### Prompt 6 — Renderizado Premium del Canvas HMI

Requerimiento:
"Esta parte la puedes hacer más detallada para que quede mejor."
(El usuario señaló la simulación visual de la planta industrial en el canvas)

Implementación en `hmi-controller.js`:
- Fondo: Gradiente radial oscuro + rejilla de puntos (reemplazó la rejilla de líneas).
- Plataforma giratoria: Gradiente radial metálico, 12 tornillos decorativos, LED central con resplandor.
- Cintas transportadoras: Sombras proyectadas, rodillos con ejes 3D metálicos, bandas animadas con offset.
- Tolva de alimentación: Gradiente metálico horizontal, remaches con brillos, partículas deterministas.
- Sensores FC/Vig: Carcasas con bordes redondeados, LEDs con resplandor, etiquetas coloreadas por estado.
- Barra de estado: Integrada en el canvas con LED de estado del sistema (RUNNING/ALARM/IDLE).

---

## 7. Instrucciones de Despliegue

### Requisitos

- Node.js v14 o superior instalado.

### Inicio del Servidor

```bash
cd "Parcial 3 Automatización"
node server.js
```

La aplicación estará disponible en: http://localhost:3000

IMPORTANTE: La aplicación NO funciona abriéndose con doble clic en el archivo HTML.
Requiere el servidor local para cargar los módulos JavaScript ES6 y el archivo usuarios.json.

### Credenciales Iniciales

| Rol | Usuario | Contraseña |
|---|---|---|
| Admin (Super Usuario) | admin | admin123 |

El Admin debe crear el resto de la jerarquía desde el panel de Gestión de Usuarios.

---

## 8. Flujo de Uso del Sistema

```
1. Iniciar servidor → node server.js
2. Abrir navegador → http://localhost:3000
3. Iniciar sesión como Admin (admin / admin123)
4. Gestión de Usuarios → Crear cuenta de Gerente
5. Cerrar sesión → Iniciar como Gerente
6. Gestión de Usuarios → Crear cuenta de Supervisor
7. Cerrar sesión → Iniciar como Supervisor
8. Gestión de Usuarios → Crear cuenta de Operador (con checklist de permisos)
9. Cerrar sesión → Iniciar como Operador
10. Operar el HMI con los permisos asignados
```

---

## 9. Notas de Implementación (Fase 0 — Fiabilidad de Métricas)

### 9.1 Paso obligatorio de compilación

`index.html` carga **`bundle.js`**, no los módulos de `js/`. Los archivos de `js/` son la
fuente, pero el navegador no los ejecuta directamente. Por tanto:

> **Toda modificación en `js/` exige ejecutar `node build_bundle.js` antes de probar.**

Los módulos nuevos deben añadirse al array `FILES` de `build_bundle.js` en el orden correcto
de dependencias, y respetar el estilo que soporta su *stripper*: `export function|class|const|let|var`
al inicio de línea. No se admite `export { a, b }` a mitad de archivo ni `export default` de expresiones.

### 9.2 Cambio de semántica: "Lotes Procesados"

Hasta la Fase 0, `batchesProcessed` se incrementaba **una vez por partícula** transferida de la
Cinta 0 al destino (unas 7,5 por segundo), de modo que el KPI mostraba cifras de tres o cuatro
dígitos en pocos minutos. Cualquier métrica derivada (lotes/hora, kWh por lote, OEE) quedaba inflada.

A partir de la Fase 0:

| Contador | Significado | Dónde |
|---|---|---|
| `physical.batchesProcessed` | **Ciclos productivos completados**: un ciclo que llegó a entregar material y volvió a `IDLE` | KPI "Lotes Procesados" |
| `stats.unitsTransferred` | Partículas entregadas al destino — equivale al valor que mostraba el KPI antiguo | `PLC_STATE.stats` |
| `stats.scrapCount` | Partículas perdidas por tener la cinta de destino parada | `PLC_STATE.stats` |
| `stats.batchesByDest` | Lotes por posición de destino (1/2/3) | `PLC_STATE.stats` |

Un ciclo interrumpido por alarma o por retorno a Condiciones Iniciales **no** se contabiliza como lote.
Las capturas o vídeos anteriores a este cambio muestran el valor de `unitsTransferred`, no el de lotes.

### 9.3 Persistencia de métricas

Los acumulados ya no se escriben en `localStorage` en cada ciclo del PLC (50 veces por segundo),
sino mediante `flushMetrics()`: un temporizador de 5 s más los eventos de cierre de ciclo, alarma,
bloqueo de seguridad y cierre de sesión. Claves usadas: `plcMetrics` (compatibilidad) y `plcStats` (nuevo).

Ante un cierre abrupto de la pestaña pueden perderse hasta 5 s de acumulados.

### 9.4 Configuración de negocio

La tarifa eléctrica, el factor de emisión y la potencia nominal por motor dejan de estar
*hardcoded* en la interfaz. Viven en `BUSINESS_CONFIG` (`js/plc-simulation.js`) y se persisten
en `localStorage['businessConfig']`:

```json
{ "tariffUSDPerKWh": 0.15, "co2KgPerKWh": 0.4, "motorRatedKW": 1.5 }
```

El factor de CO₂ es un valor de referencia genérico, no una medida del proceso.

### 9.5 Separación de funciones en los mandos

Los roles **Admin** y **Gerente** no superan `checkPermission('BASIC_CONTROL')` y por diseño no
operan la planta. Antes los botones aparecían deshabilitados sin explicación; ahora la consola de
mando muestra el motivo y a qué rol hay que cambiar. Para operar el HMI hay que iniciar sesión
como **Supervisor**, o como **Operador** con la capacidad *Control Manual* marcada en su creación.

---

## 10. Instrumentación del PLC (Fase 1)

`PLC_STATE.stats` acumula la materia prima de todo el catálogo de métricas. Se actualiza
desde `updateStats(dt)` — invocada **antes** que `updatePhysics()` y `updatePLCLogic()` y
envuelta en `try/catch`, de modo que ni una salida temprana de la lógica de control le hace
perder tiempo, ni un fallo suyo puede detener la planta.

### 10.1 Qué acumula

| Grupo | Campos | Métricas que habilita |
|---|---|---|
| Tiempo | `totalElapsedSeconds`, `stateTime`, `stateEntries` | Disponibilidad, tiempo por estado, MTTR |
| Alarmas | `alarmCount` (por cinta), `firstAlarmAt`, `lastAlarmAt` | MTBF, alarmas por cinta, tiempo hasta el primer fallo |
| Actuadores | `motorSeconds`, `motorKWh`, `motorCycles` (8 salidas) | Consumo por motor, horas de servicio, ciclos, desgaste |
| Producción | `unitsTransferred`, `batchesByDest`, `scrapCount` | Reparto por destino, scrap, tasa de calidad |
| Seguridad | `commandCounts`, `rejectedCommands`, `securityEvents`, `lockdownCount` | Aceptados vs. rechazados, eventos por tipo de ataque |
| Proceso | `hopperCycles`, `totalDegreesRotated` | Ciclos de tolva, desgaste del reductor |
| Sistema | `loop` (`ticks`, `avgDtMs`, `maxDtMs`, `jitterMs`) | FPS reales y deriva del ciclo |

### 10.2 Dos invariantes que deben cumplirse siempre

- **`Σ stateTime` = `totalElapsedSeconds`.** Todo instante se atribuye a exactamente un estado.
- **`Σ motorKWh` = `powerConsumptionKWh`.** Ambos se derivan del mismo recorrido por los 8
  actuadores, así que cuadran por construcción y no por coincidencia.

Medidos tras un ciclo completo: desviación **0,000000 %** en ambos.

### 10.3 El estado `SECURITY_LOCKDOWN`

No pertenece a la máquina de estados del PLC. Mientras el firewall OT mantiene el bloqueo,
`control.status` conserva el valor que tuviera al producirse la intrusión (por ejemplo `RUNNING`),
pero la planta está parada. El estado que se contabiliza es el **efectivo**:

```
securityLockdown ? 'SECURITY_LOCKDOWN' : control.status
```

Sin esta distinción, el tiempo de bloqueo inflaría la disponibilidad.

### 10.4 Eventos de dominio

El PLC emite tres `CustomEvent` en `window` para que los consumidores no tengan que sondear:

| Evento | `detail` | Cuándo |
|---|---|---|
| `plc-state-change` | `{ from, to, at }` | Cada transición de estado efectivo |
| `plc-alarm` | `{ belt, message, at }` | Flanco de alarma (no se repite mientras siga activa) |
| `plc-lockdown` | `{ reason, message, command, at }` | Cada rechazo del firewall OT |

### 10.5 Persistencia y reinicio

Los acumulados se guardan en `plcStats`; el total de planta sigue en `plcMetrics` por
compatibilidad con la interfaz existente. La carga aplica un **merge defensivo**: toda clave
ausente, no numérica o corrupta queda en su valor inicial, de modo que ampliar la estructura
más adelante no rompe los datos guardados.

> ⚠️ **`plcStats` y `plcMetrics` deben reiniciarse juntas.** Borrar una sin la otra descuadra
> el balance de energía de forma permanente. `loop` y `sessionStartedAt` describen la sesión
> en curso y nunca se restauran.

---

*Documentación técnica — Parcial 3 — Sistemas de Automatización Industrial.*
