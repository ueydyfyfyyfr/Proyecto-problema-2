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

*Documentación técnica — Parcial 3 — Sistemas de Automatización Industrial.*
