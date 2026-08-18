/* HMI CIBER BUNDLE */
(function(){

/* === js/crypto-helper.js === */
/**
 * Helper criptográfico utilizando la Web Crypto API nativa del navegador.
 * - PBKDF2-SHA256 con salt individual por usuario (para contraseñas)
 * - HMAC-SHA256 para firmar/verificar comandos de red OT
 * - AES-GCM para cifrado simétrico
 */

// ============================================================
// PBKDF2 — HASHING SEGURO DE CONTRASEÑAS CON SALT
// ============================================================

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'SHA-256';
const PBKDF2_KEY_BITS = 256; // 32 bytes

/** Genera un salt aleatorio (16 bytes → 32 hex chars) */
function generateSalt() {
  const arr = new Uint8Array(16);
  window.crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

/** Convierte un array de bytes a string hexadecimal */
function uint8ToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convierte un string hexadecimal a Uint8Array */
function hexToUint8(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

/**
 * Deriva el hash PBKDF2-SHA256 de una contraseña usando el salt dado.
 * @param {string} password  Contraseña en texto plano
 * @param {string} saltHex   Salt en formato hexadecimal (16 bytes)
 * @returns {Promise<string>} Hash resultante en hexadecimal (32 bytes / 64 chars)
 */
async function hashPasswordPBKDF2(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const saltBytes = hexToUint8(saltHex);

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    keyMaterial,
    PBKDF2_KEY_BITS
  );

  return uint8ToHex(new Uint8Array(derivedBits));
}

/**
 * Crea un nuevo registro de credencial a partir de una contraseña en texto plano.
 * Genera el salt automáticamente.
 * @returns {{ salt: string, hash: string, iterations: number, algo: string }}
 */
async function createCredential(password) {
  const salt = generateSalt();
  const hash = await hashPasswordPBKDF2(password, salt);
  return { salt, hash, iterations: PBKDF2_ITERATIONS, algo: 'PBKDF2-SHA256' };
}

/**
 * Verifica si una contraseña en texto plano coincide con un hash almacenado.
 * @param {string} password   Contraseña ingresada por el usuario
 * @param {string} storedHash Hash guardado en usuarios.json
 * @param {string} saltHex    Salt guardado en usuarios.json
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash, saltHex) {
  try {
    const computed = await hashPasswordPBKDF2(password, saltHex);
    return computed === storedHash;
  } catch (e) {
    console.error('Error en verificación de contraseña:', e);
    return false;
  }
}

// ============================================================
// SHA-256 — Hash genérico (no para contraseñas)
// ============================================================
async function hashSHA256(text) {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return uint8ToHex(new Uint8Array(hashBuffer));
}

// ============================================================
// HMAC-SHA256 — Firma de tramas OT (comandos PLC)
// ============================================================

async function importHMACKey(secretStr) {
  const enc = new TextEncoder();
  return await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secretStr),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign', 'verify']
  );
}

async function generateHMAC(message, secret) {
  const cryptoKey = await importHMACKey(secret);
  const enc = new TextEncoder();
  const sigBuffer = await window.crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return uint8ToHex(new Uint8Array(sigBuffer));
}

async function verifyHMAC(message, signatureHex, secret) {
  try {
    const cryptoKey = await importHMACKey(secret);
    const enc = new TextEncoder();
    const sigBytes = hexToUint8(signatureHex);
    return await window.crypto.subtle.verify('HMAC', cryptoKey, sigBytes, enc.encode(message));
  } catch (e) {
    console.error('Error al verificar HMAC:', e);
    return false;
  }
}

// ============================================================
// AES-GCM — Cifrado simétrico
// ============================================================

async function importAESKey(secretStr) {
  const enc = new TextEncoder();
  const rawKey = enc.encode(secretStr.padEnd(32, '0').slice(0, 32));
  return await window.crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptAES(text, secret) {
  const key = await importAESKey(secret);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertextBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `${uint8ToHex(iv)}:${uint8ToHex(new Uint8Array(ciphertextBuffer))}`;
}

async function decryptAES(encryptedStr, secret) {
  const [ivHex, ctHex] = encryptedStr.split(':');
  const key = await importAESKey(secret);
  const iv = hexToUint8(ivHex);
  const ct = hexToUint8(ctHex);
  const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(decrypted);
}

// ============================================================
// NONCE — Anti-replay
// ============================================================
function generateNonce() {
  const arr = new Uint8Array(8);
  window.crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}


/* === js/audit-log.js === */
// Registro de auditoría para auditorías OT/IT y de seguridad

let auditLogs = [];

// Cargar logs guardados en localStorage para persistencia
function loadLogs() {
  const saved = localStorage.getItem('auditLogs');
  if (saved) {
    try {
      auditLogs = JSON.parse(saved);
    } catch (e) {
      auditLogs = [];
    }
  }
}

// Guardar logs en localStorage
function saveLogs() {
  localStorage.setItem('auditLogs', JSON.stringify(auditLogs));
}

// Agregar una entrada de auditoría
// type: 'INFO' | 'WARNING' | 'SECURITY_ALERT' | 'CONFIG_CHANGE' | 'OPERATION' | 'AI_INTERACTION' | 'AUTH_FAIL'
function logEvent(type, message, user = 'SYSTEM', details = null) {
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    type,
    user,
    message,
    details
  };
  
  auditLogs.unshift(logEntry); // Insertar al inicio (orden cronológico inverso)
  
  // Limitar a los últimos 500 registros para evitar sobrecarga de memoria
  if (auditLogs.length > 500) {
    auditLogs.pop();
  }
  
  saveLogs();
  
  // Disparar un evento para que la interfaz se actualice si está suscrita
  window.dispatchEvent(new CustomEvent('audit-log-updated', { detail: logEntry }));
}

// Obtener todas las entradas de auditoría
function getLogs() {
  loadLogs();
  return auditLogs;
}

function getLogsSince(timestamp) {
  loadLogs();
  const ts = new Date(timestamp).getTime();
  return auditLogs.filter(log => new Date(log.timestamp).getTime() >= ts);
}

function getLogsByType(type) {
  loadLogs();
  return auditLogs.filter(log => log.type === type);
}

// Limpiar el registro de auditoría (solo accesible por Administrador / Ingeniero en simulación)
function clearLogs() {
  auditLogs = [];
  saveLogs();
  window.dispatchEvent(new CustomEvent('audit-log-updated', { detail: null }));
}

// Cargar logs iniciales
loadLogs();


/* === js/auth.js === */
/**
 * auth.js — Autenticación y gestión de usuarios (RBAC)
 *
 * Arquitectura de dos aplicaciones:
 *   - Aplicación 1 (admin.html): genera usuarios.json con hashes PBKDF2
 *   - Aplicación 2 (index.html, esta app): carga usuarios.json y verifica
 *     contraseñas localmente con PBKDF2 — las contraseñas NUNCA existen en texto plano.
 */


// Cache en memoria de los usuarios cargados
let usersCache = null;
let currentUser = null;

// ============================================================
// CARGA DE usuarios.json (Fuente de verdad)
// ============================================================

const DEFAULT_EMBEDDED_USERS = [
  {
    username: 'admin',
    name: 'Super Usuario HMI',
    role: 'Admin',
    salt: '694b05e883c7e8d58f7c705ae6b4ff65',
    hash: 'fad196e1084c70c3193c3416e133107a1a741af801c0a2d957111014eeb0c753',
    iterations: 100000,
    algo: 'PBKDF2-SHA256',
    isSystem: true,
    createdAt: '2026-07-28T12:54:34.815Z'
  }
];

/**
 * Carga la base de datos de usuarios desde:
 *  1. usuarios.json servido por el servidor HTTP (fetch)
 *  2. Fallback: localStorage['usuarios_json'] (si fue importado manualmente)
 *  3. Fallback final: Base de datos embebida (para modo file:// sin servidor)
 */
async function loadUsersDB() {
  if (usersCache) return usersCache;

  // Intento 1: Cargar desde el servidor
  try {
    const res = await fetch('./usuarios.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      usersCache = buildUserMap(data.users || []);
      const dynamic = getDynamicUsers();
      usersCache = { ...usersCache, ...dynamic };
      return usersCache;
    }
  } catch (e) {
    console.warn('No se pudo cargar usuarios.json desde el servidor (modo file://):', e.message);
  }

  // Intento 2: Leer desde localStorage (usuarios importados manualmente)
  const savedJSON = localStorage.getItem('usuarios_json');
  if (savedJSON) {
    try {
      const data = JSON.parse(savedJSON);
      usersCache = buildUserMap(data.users || []);
      const dynamic = getDynamicUsers();
      usersCache = { ...usersCache, ...dynamic };
      return usersCache;
    } catch (e) {
      console.error('usuarios.json en localStorage está corrupto:', e);
    }
  }

  // Intento 3: Fallback embebido para modo file:// (doble clic directo en index.html)
  usersCache = buildUserMap(DEFAULT_EMBEDDED_USERS);
  const dynamic = getDynamicUsers();
  usersCache = { ...usersCache, ...dynamic };
  return usersCache;
}

/** Convierte el array de usuarios a un mapa username→data */
function buildUserMap(usersArray) {
  const map = {};
  for (const u of usersArray) {
    if (u.username) map[u.username.toLowerCase()] = u;
  }
  return map;
}

/** Invalida la caché (llamar tras crear/eliminar usuarios) */
function invalidateCache() {
  usersCache = null;
}

// ============================================================
// USUARIOS DINÁMICOS (creados desde el HMI, sin editar usuarios.json)
// ============================================================

function getDynamicUsers() {
  try {
    const saved = localStorage.getItem('dynamic_users_pbkdf2');
    return saved ? JSON.parse(saved) : {};
  } catch (e) {
    return {};
  }
}

function saveDynamicUsers(map) {
  localStorage.setItem('dynamic_users_pbkdf2', JSON.stringify(map));
}

// ============================================================
// IMPORTAR usuarios.json manualmente (desde un <input file>)
// ============================================================

/**
 * Importa un usuarios.json cargado por el usuario.
 * Lo guarda en localStorage para que esté disponible en siguiente sesión.
 * @param {string} jsonText  Contenido del archivo usuarios.json
 */
function importUsersJSON(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    if (!data.users || !Array.isArray(data.users)) {
      throw new Error('El archivo no contiene un array "users" válido.');
    }
    localStorage.setItem('usuarios_json', jsonText);
    invalidateCache();
    return data.users.length;
  } catch (e) {
    throw new Error('Archivo inválido: ' + e.message);
  }
}

// ============================================================
// AUTENTICACIÓN — LOGIN / LOGOUT
// ============================================================

/**
 * Intenta iniciar sesión con las credenciales dadas.
 * Verifica la contraseña con PBKDF2 — nunca existe en texto plano.
 */
async function login(username, password) {
  const db = await loadUsersDB();
  const key = username.toLowerCase().trim();
  const user = db[key];

  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  // Verificar contraseña con PBKDF2 + salt individual
  const isValid = await verifyPassword(password, user.hash, user.salt);
  if (!isValid) {
    // Registrar intento fallido (puede extenderse para bloqueo tras N intentos)
    logEvent('WARNING', `Intento de inicio de sesión fallido para usuario: ${key}`, 'AUTH_SYSTEM');
    throw new Error('Contraseña incorrecta');
  }

  currentUser = {
    username: key,
    role: user.role,
    name: user.name,
    isSystem: user.isSystem || false,
    capabilities: user.capabilities || []
  };

  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  logEvent('INFO', `Sesión iniciada correctamente.`, currentUser.name + ' (' + currentUser.role + ')');
  return currentUser;
}

function logout() {
  if (currentUser) {
    logEvent('INFO', `Sesión cerrada.`, currentUser.name + ' (' + currentUser.role + ')');
  }
  currentUser = null;
  localStorage.removeItem('currentUser');
}

function getCurrentUser() {
  if (!currentUser) {
    const saved = localStorage.getItem('currentUser');
    if (saved) {
      try { currentUser = JSON.parse(saved); } catch (e) {}
    }
  }
  return currentUser;
}

// ============================================================
// GESTIÓN DE USUARIOS (CRUD desde el HMI)
// ============================================================

/**
 * Crea un nuevo usuario dinámico desde el HMI.
 * Genera el hash PBKDF2 + salt de la contraseña.
 * Solo disponible para el rol Ingeniero.
 */
async function createUser(username, password, role, fullName, capabilities = []) {
  const key = username.toLowerCase().trim();

  // Validaciones de entrada
  if (!key || key.length < 3) throw new Error('El nombre de usuario debe tener al menos 3 caracteres.');
  if (!/^[a-z0-9_]+$/.test(key)) throw new Error('Solo se permiten letras minúsculas, números y guión bajo (_).');
  if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  if (!['Admin', 'Gerente', 'Supervisor', 'Operador'].includes(role)) throw new Error('Rol no válido.');
  if (!fullName || fullName.trim().length < 3) throw new Error('El nombre completo debe tener al menos 3 caracteres.');

  const creator = getCurrentUser();
  if (!creator) throw new Error('Debes iniciar sesión para crear usuarios.');

  // Validar Jerarquía de la Pirámide de Automatización
  const creatorRole = creator.role;
  if (creatorRole === 'Admin' && role !== 'Gerente') {
    throw new Error('Un Admin solo puede crear usuarios de nivel Gerente.');
  }
  if (creatorRole === 'Gerente' && role !== 'Supervisor') {
    throw new Error('Un Gerente solo puede crear usuarios de nivel Supervisor.');
  }
  if (creatorRole === 'Supervisor' && role !== 'Operador') {
    throw new Error('Un Supervisor solo puede crear usuarios de nivel Operador.');
  }
  if (creatorRole === 'Operador') {
    throw new Error('Un Operador no tiene permisos para crear usuarios.');
  }

  const db = await loadUsersDB();
  if (db[key]) throw new Error(`El usuario "${key}" ya existe.`);

  // Generar credenciales seguras
  const cred = await createCredential(password);

  // Guardar en usuarios dinámicos
  const dynamic = getDynamicUsers();
  dynamic[key] = {
    username: key,
    name: fullName.trim(),
    role,
    capabilities: role === 'Operador' ? capabilities : [],
    salt: cred.salt,
    hash: cred.hash,
    iterations: cred.iterations,
    algo: cred.algo,
    isSystem: false,
    createdAt: new Date().toISOString(),
    createdBy: creator.username
  };
  saveDynamicUsers(dynamic);
  invalidateCache();

  logEvent('CONFIG_CHANGE',
    `Usuario "${key}" (${role}) creado con credenciales PBKDF2-SHA256 + Salt único.`,
    creator?.name || 'SYSTEM'
  );

  return dynamic[key];
}

/**
 * Elimina un usuario dinámico (los del sistema no pueden eliminarse).
 */
async function deleteUser(username) {
  const key = username.toLowerCase();
  const db = await loadUsersDB();
  const user = db[key];

  if (!user) throw new Error('Usuario no encontrado.');
  if (user.isSystem) throw new Error('No se pueden eliminar los usuarios del sistema.');
  if (currentUser && currentUser.username === key) {
    throw new Error('No puedes eliminar tu propia cuenta mientras tienes sesión activa.');
  }

  const dynamic = getDynamicUsers();
  delete dynamic[key];
  saveDynamicUsers(dynamic);
  invalidateCache();

  const actor = getCurrentUser();
  logEvent('CONFIG_CHANGE', `Usuario "${key}" eliminado del sistema.`, actor?.name || 'SYSTEM');
}

/**
 * Retorna la lista completa de usuarios para el panel de administración.
 */
async function getAllUsers() {
  const db = await loadUsersDB();
  return Object.values(db).map(u => ({
    username: u.username,
    name: u.name,
    role: u.role,
    capabilities: u.capabilities || [],
    isSystem: u.isSystem || false,
    algo: u.algo || 'PBKDF2-SHA256',
    createdAt: u.createdAt || null,
    createdBy: u.createdBy || 'Sistema'
  }));
}

// ============================================================
// RBAC — Control de Acceso Basado en Roles
// ============================================================
function checkPermission(action) {
  const user = getCurrentUser();
  if (!user) return false;

  const R = user.role;
  const caps = user.capabilities || [];

  switch (action) {
    case 'BASIC_CONTROL':   
      return R === 'Supervisor' || (R === 'Operador' && caps.includes('CONTROL_MANUAL'));
    case 'ADVANCED_CONFIG': 
      return R === 'Supervisor' || (R === 'Operador' && caps.includes('CHANGE_SETPOINTS'));
    case 'FORCE_ACTUATOR':  
      return R === 'Supervisor';
    case 'VIEW_AUDIT_LOG':  
      return R === 'Supervisor' || R === 'Admin';
    case 'VIEW_METRICS':    
      return R === 'Gerente' || R === 'Admin';
    case 'VIEW_ANALYTICS':    
      return R === 'Gerente' || R === 'Admin' || R === 'Supervisor';
    case 'USE_AI_ASSISTANT':
      return R === 'Admin' || R === 'Gerente' || R === 'Ingeniero' || caps.includes('USE_AI_ASSISTANT');
    case 'MANAGE_USERS':    
      return R === 'Admin' || R === 'Gerente' || R === 'Supervisor';
    default:                
      return false;
  }
}


/* === js/plc-simulation.js === */

// Variables de estado internas del PLC
const PLC_STATE = {
  // Entradas físicas
  inputs: {
    PSelec: false,
    PMarcha: false,
    PParo: false,
    FC1: true,   // Inicialmente en Posición 1
    FC2: false,
    FC3: false,
    FCTolAb: false,
    FCTolCe: true, // Inicialmente cerrada
    VigC0: true,   // Sensores de velocidad OK
    VigC1: true,
    VigC2: true,
    VigC3: true,
  },
  
  // Salidas físicas (motores, luces, etc.)
  outputs: {
    LS1: true,   // Inicialmente seleccionada posición 1
    LS2: false,
    LS3: false,
    LConC0: false,
    LConC1: false,
    LConC2: false,
    LConC3: false,
    LDesC0: true, // Inicialmente desconectadas
    LDesC1: true,
    LDesC2: true,
    LDesC3: true,
    LDescgC1: false,
    LDescgC2: false,
    LDescgC3: false,
    MC0: false,   // Motores apagados
    MC1: false,
    MC2: false,
    MC3: false,
    MTolAb: false,
    MTolCe: false,
    MGIzq: false,
    MGDer: false,
  },
  
  // Variables operativas internas de la planta (física simulada)
  physical: {
    targetPosition: 1,        // Posición deseada (1, 2, 3)
    currentAngle: 0,          // Ángulo físico de Cinta 0 (0° = Pos 1, 90° = Pos 2, 180° = Pos 3)
    hopperOpenPercent: 0,     // 0 = cerrado, 100 = abierto
    materialOnCinta0: [],     // Partículas de material
    materialOnDest: [],
    runTimeSeconds: 0,        // Contador de tiempo de uso acumulado
    batchesProcessed: 0,      // Número de lotes
    unitsTransferred: 0,      // Partículas transferidas de material procesados
    powerConsumptionKWh: 0,   // Consumo estimado
  },
  
  // Configuración de temporizadores (ajustable por Ingeniero)
  config: {
    hopperOpenDelay: 5,       // Tiempo para abrir tolva tras M0 (segundos)
    cinta0DischargeTime: 20,  // Tiempo de vaciado Cinta 0 tras Paro (segundos)
    destDischargeTime: 20,    // Tiempo adicional de vaciado destino (segundos)
    speedSensorPulsePeriod: 100, // ms entre pulsos (10Hz)
  },
  

  // Estadísticas e instrumentación (Fase 2)
  stats: {
    stateTime: { IDLE: 0, ROTATING: 0, RUNNING: 0, DISCHARGING_C0: 0, DISCHARGING_DEST: 0, ALARM: 0, EMERGENCY_LOCK: 0 },
    alarmCount: { C0: 0, C1: 0, C2: 0, C3: 0 },
    motorSeconds: { MC0: 0, MC1: 0, MC2: 0, MC3: 0, MGIzq: 0, MGDer: 0, MTolAb: 0, MTolCe: 0 },
    motorKWh: { MC0: 0, MC1: 0, MC2: 0, MC3: 0, MGIzq: 0, MGDer: 0, MTolAb: 0, MTolCe: 0 },
    motorCycles: { MC0: 0, MC1: 0, MC2: 0, MC3: 0, MGIzq: 0, MGDer: 0, MTolAb: 0, MTolCe: 0 },
    batchesByDest: { 1: 0, 2: 0, 3: 0 },
    scrapCount: 0,
    commandCounts: {},
    rejectedCommands: {},
    securityEvents: { COMANDO_NO_FIRMADO: 0, INTEGRIDAD_COMPROMETIDA: 0, ATAQUE_REPLAY_DETECTADO: 0, TRAMA_EXPIRADA: 0, FORMATO_CORRUPTO: 0 },
    totalElapsedSeconds: 0,
    firstAlarmAt: null,
    lastAlarmAt: null,
    lockdownCount: 0
  },
  // Estado interno del control secuencial del PLC (máquina de estados)
  control: {
    status: 'IDLE',          // 'IDLE', 'ROTATING', 'RUNNING', 'DISCHARGING_C0', 'DISCHARGING_DEST', 'ALARM', 'EMERGENCY_LOCK'
    timer: 0,                // Temporizador de control interno (ms)
    startupTimers: {         // Ventana de 5s sin evaluación de velocidad
      C0: 0,
      C1: 0,
      C2: 0,
      C3: 0
    },
    alarms: {
      C0: false,
      C1: false,
      C2: false,
      C3: false
    },
    alarmBlinkState: false,  // Alternador para el parpadeo
    securityLockdown: false, // Bloqueo por intrusión detectada
    securityLockReason: ''
  }
};

// Clave secreta compartida del PLC (para autenticar comandos HMI)
var PLC_SHARED_SECRET = "PlcSuperSecretKeyOT2026!";

// Registro de Nonces recibidos para prevenir ataques de Replay
const receivedNonces = new Map();
const maxNonceAgeMs = 60000; // Rechazar comandos con timestamps mayores a 60 segundos

// Iniciar simulación física
let simInterval = null;

// Inicializa o reinicia la simulación
function initSimulation(onStateUpdate) {
  if (simInterval) clearInterval(simInterval);
  
  // Cargar configuraciones guardadas
  const savedConfig = localStorage.getItem('plcConfig');
  if (savedConfig) {
    try {
      PLC_STATE.config = { ...PLC_STATE.config, ...JSON.parse(savedConfig) };
    } catch(e) {}
  }
  
  // Cargar métricas acumuladas
  const savedMetrics = localStorage.getItem('plcMetrics');
  if (savedMetrics) {
    try {
      const m = JSON.parse(savedMetrics);
      PLC_STATE.physical.runTimeSeconds = m.runTimeSeconds || 0;
      PLC_STATE.physical.batchesProcessed = m.batchesProcessed || 0;
      PLC_STATE.physical.powerConsumptionKWh = m.powerConsumptionKWh || 0;
      PLC_STATE.physical.unitsTransferred = m.unitsTransferred || 0;
      if (m.stats) PLC_STATE.stats = m.stats;

    } catch(e) {}
  }

  // Bucle de simulación a 50 FPS (cada 20 ms)
  let lastTime = Date.now();
  simInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // Diferencial de tiempo en segundos
    lastTime = now;
    
    updatePhysics(dt);
    updatePLCLogic(dt);
    
    if (onStateUpdate) onStateUpdate(PLC_STATE);
  }, 20);
}

// Simulación de la física del sistema (movimiento real, tolva, material)
function updatePhysics(dt) {
  // 1. Simulación del giro de la plataforma (MG)
  const targetAngle = (PLC_STATE.physical.targetPosition - 1) * 90; // Pos1=0, Pos2=90, Pos3=180
  const rotationSpeed = 45; // 45 grados por segundo
  
  if (PLC_STATE.outputs.MGDer) {
    PLC_STATE.physical.currentAngle += rotationSpeed * dt;
    if (PLC_STATE.physical.currentAngle >= targetAngle) {
      PLC_STATE.physical.currentAngle = targetAngle;
    }
  } else if (PLC_STATE.outputs.MGIzq) {
    PLC_STATE.physical.currentAngle -= rotationSpeed * dt;
    if (PLC_STATE.physical.currentAngle <= targetAngle) {
      PLC_STATE.physical.currentAngle = targetAngle;
    }
  }
  
  // Actualizar los finales de carrera físicos según el ángulo
  PLC_STATE.inputs.FC1 = Math.abs(PLC_STATE.physical.currentAngle - 0) < 1;
  PLC_STATE.inputs.FC2 = Math.abs(PLC_STATE.physical.currentAngle - 90) < 1;
  PLC_STATE.inputs.FC3 = Math.abs(PLC_STATE.physical.currentAngle - 180) < 1;
  
  // 2. Simulación de la compuerta de la Tolva
  const hopperSpeed = 50; // 50% por segundo
  if (PLC_STATE.outputs.MTolAb) {
    PLC_STATE.physical.hopperOpenPercent += hopperSpeed * dt;
    if (PLC_STATE.physical.hopperOpenPercent >= 100) {
      PLC_STATE.physical.hopperOpenPercent = 100;
    }
  } else if (PLC_STATE.outputs.MTolCe) {
    PLC_STATE.physical.hopperOpenPercent -= hopperSpeed * dt;
    if (PLC_STATE.physical.hopperOpenPercent <= 0) {
      PLC_STATE.physical.hopperOpenPercent = 0;
    }
  }
  
  // Finales de carrera de la tolva
  PLC_STATE.inputs.FCTolAb = PLC_STATE.physical.hopperOpenPercent >= 99;
  PLC_STATE.inputs.FCTolCe = PLC_STATE.physical.hopperOpenPercent <= 1;
  
  // 3. Simulación de flujo de material en las cintas
  // Generar material desde la tolva si está abierta y las cintas están activas
  if (PLC_STATE.physical.hopperOpenPercent > 10 && PLC_STATE.outputs.MC0) {
    // Generar partículas aleatorias en la entrada de Cinta 0
    if (Math.random() < 0.15) {
      PLC_STATE.physical.materialOnCinta0.push({ x: 0, y: 15 });
    }
  }
  
  // Mover material en Cinta 0
  if (PLC_STATE.outputs.MC0 && PLC_STATE.control.status !== 'ALARM') {
    PLC_STATE.physical.materialOnCinta0.forEach(m => {
      m.x += 1.5 * dt; // velocidad de avance
    });
    
    
    // Transferencia de Cinta 0 a la cinta de destino correspondiente al ángulo actual
    PLC_STATE.physical.materialOnCinta0 = PLC_STATE.physical.materialOnCinta0.filter(m => {
      if (m.x >= 1.0) { // Fin de Cinta 0
        const activeDest = PLC_STATE.physical.targetPosition;
        const destMotor = PLC_STATE.outputs[`MC${activeDest}`];
        if (destMotor) {
          PLC_STATE.physical.materialOnDest.push({ 
            cinta: activeDest, 
            x: 0,
            y: 10 + Math.random() * 10
          });
          PLC_STATE.physical.unitsTransferred++;
        } else {
          PLC_STATE.stats.scrapCount++;
        }
        return false; // Remover de Cinta 0
      }
      return true;
    });
  } // <-- MISSING CLOSING BRACE

  // Mover material en las Cintas de Destino (1, 2, 3)
  PLC_STATE.physical.materialOnDest.forEach(m => {
    const motorActive = PLC_STATE.outputs[`MC${m.cinta}`];
    if (motorActive) {
      m.x += 1.2 * dt;
    }
  });
  
  // Eliminar material del final de las cintas de salida
  PLC_STATE.physical.materialOnDest = PLC_STATE.physical.materialOnDest.filter(m => m.x < 1.0);
  
  // 4. Acumular métricas operativas
  let activeMotorsCount = 0;
  if (PLC_STATE.outputs.MC0) activeMotorsCount++;
  if (PLC_STATE.outputs.MC1) activeMotorsCount++;
  if (PLC_STATE.outputs.MC2) activeMotorsCount++;
  if (PLC_STATE.outputs.MC3) activeMotorsCount++;
  if (PLC_STATE.outputs.MGIzq || PLC_STATE.outputs.MGDer) activeMotorsCount++;
  if (PLC_STATE.outputs.MTolAb || PLC_STATE.outputs.MTolCe) activeMotorsCount++;
  
  if (activeMotorsCount > 0) {
    PLC_STATE.physical.runTimeSeconds += dt;
    // Consumo eléctrico estimado: 1.5 kW por motor encendido
    const powerKW = activeMotorsCount * 1.5;
    PLC_STATE.physical.powerConsumptionKWh += (powerKW * dt) / 3600;
    
    // Estadísticas
    if (!PLC_STATE.previousOutputs) PLC_STATE.previousOutputs = {};
    ['MC0','MC1','MC2','MC3','MGIzq','MGDer','MTolAb','MTolCe'].forEach(motor => {
      if (PLC_STATE.outputs[motor]) {
        PLC_STATE.stats.motorSeconds[motor] += dt;
        PLC_STATE.stats.motorKWh[motor] += (1.5 * dt) / 3600;
      }
      if (PLC_STATE.outputs[motor] && !PLC_STATE.previousOutputs[motor]) {
        PLC_STATE.stats.motorCycles[motor]++;
      }
      PLC_STATE.previousOutputs[motor] = PLC_STATE.outputs[motor];
    });

    PLC_STATE.stats.totalElapsedSeconds += dt;
    if (PLC_STATE.stats.stateTime[PLC_STATE.control.status] !== undefined) {
      PLC_STATE.stats.stateTime[PLC_STATE.control.status] += dt;
    }

    if (!PLC_STATE.lastSaveTime || (Date.now() - PLC_STATE.lastSaveTime > 5000)) {
      PLC_STATE.lastSaveTime = Date.now();
      
      // Purge nonces
      const cutoff = Date.now() - maxNonceAgeMs;
      for (const [n, ts] of receivedNonces.entries()) {
        if (ts < cutoff) receivedNonces.delete(n);
      }

      localStorage.setItem('plcMetrics', JSON.stringify({
        runTimeSeconds: PLC_STATE.physical.runTimeSeconds,
        batchesProcessed: PLC_STATE.physical.batchesProcessed,
        unitsTransferred: PLC_STATE.physical.unitsTransferred,
        powerConsumptionKWh: PLC_STATE.physical.powerConsumptionKWh,
        stats: PLC_STATE.stats
      }));
    }
  }
}

// Lógica de control secuencial del PLC (Programa de automatización)
function updatePLCLogic(dt) {
  if (PLC_STATE.control.securityLockdown) {
    // Si hay un bloqueo por intrusión cibernética, apagamos todos los motores como medida de seguridad activa
    stopAllMotors();
    return;
  }

  // Manejo de temporizador general
  if (PLC_STATE.control.timer > 0) {
    PLC_STATE.control.timer -= dt * 1000;
  }
  
  // Manejo de parpadeo de alarmas
  const now = Date.now();
  PLC_STATE.control.alarmBlinkState = Math.floor(now / 250) % 2 === 0; // Frecuencia de 2 Hz (ciclo total 500ms)

  // Ventana de 3 segundos sin evaluar velocidad al arrancar motores
  for (let key in PLC_STATE.control.startupTimers) {
    if (PLC_STATE.control.startupTimers[key] > 0) {
      PLC_STATE.control.startupTimers[key] -= dt * 1000;
    }
  }

  // 1. Evaluación de fallas de velocidad (Vigilancia de cintas)
  // Ignoramos durante los primeros 3 segundos de arranque
  if (PLC_STATE.control.status !== 'IDLE' && PLC_STATE.control.status !== 'ROTATING' && PLC_STATE.control.status !== 'EMERGENCY_LOCK') {
    // Verificar Cinta 0
    if (PLC_STATE.outputs.MC0 && PLC_STATE.control.startupTimers.C0 <= 0 && !PLC_STATE.inputs.VigC0) {
      triggerAlarm('C0', 'Pérdida de velocidad en Cinta 0 (VigC0 bajo)');
    }
    // Verificar cinta de destino activa
    const activeDest = PLC_STATE.physical.targetPosition;
    if (PLC_STATE.outputs[`MC${activeDest}`] && PLC_STATE.control.startupTimers[`C${activeDest}`] <= 0 && !PLC_STATE.inputs[`VigC${activeDest}`]) {
      triggerAlarm(`C${activeDest}`, `Pérdida de velocidad en Cinta de Destino ${activeDest}`);
    }
  }

  // 2. Máquina de estados principal del PLC
  switch (PLC_STATE.control.status) {
    case 'IDLE':
      // Asegurar que salidas correspondientes a reposo estén activas
      stopAllMotors();
      updateStatusLamps();
      break;
      
    case 'ROTATING':
      // Se está posicionando la Cinta 0 con MG
      const targetPos = PLC_STATE.physical.targetPosition;
      const currentPosLimit = PLC_STATE.inputs[`FC${targetPos}`];
      
      if (currentPosLimit) {
        // Alcanzó la posición correcta! Detener giro de MG
        PLC_STATE.outputs.MGIzq = false;
        PLC_STATE.outputs.MGDer = false;
        
        // Arrancar Cinta 0 y la cinta de destino activa
        PLC_STATE.outputs.MC0 = true;
        PLC_STATE.outputs[`MC${targetPos}`] = true;
        
        // Activar lámparas de conexión
        PLC_STATE.outputs.LConC0 = true;
        PLC_STATE.outputs[`LConC${targetPos}`] = true;
        PLC_STATE.outputs.LDesC0 = false;
        PLC_STATE.outputs[`LDesC${targetPos}`] = false;
        
        // Iniciar ventanas de 3s para ignorar vigilancia
        PLC_STATE.control.startupTimers.C0 = 3000;
        PLC_STATE.control.startupTimers[`C${targetPos}`] = 3000;
        
        // Iniciar temporizador de 5 segundos para abrir la tolva
        PLC_STATE.control.timer = PLC_STATE.config.hopperOpenDelay * 1000;
        PLC_STATE.control.status = 'RUNNING';
        
        logEvent('INFO', `Cinta 0 alineada en posición ${targetPos}. Motores MC0 y MC${targetPos} iniciados.`, 'PLC');
      } else {
        // Determinar sentido de giro de MG
        const currentAngle = PLC_STATE.physical.currentAngle;
        const targetAngle = (targetPos - 1) * 90;
        if (currentAngle < targetAngle) {
          PLC_STATE.outputs.MGDer = true;
          PLC_STATE.outputs.MGIzq = false;
        } else {
          PLC_STATE.outputs.MGIzq = true;
          PLC_STATE.outputs.MGDer = false;
        }
      }
      break;
      
    case 'RUNNING':
      // Estado normal de funcionamiento
      // Tras 5 segundos, abrir la tolva
      if (PLC_STATE.control.timer <= 0 && !PLC_STATE.outputs.MTolAb && !PLC_STATE.inputs.FCTolAb) {
        PLC_STATE.outputs.MTolAb = true;
        PLC_STATE.outputs.MTolCe = false;
        logEvent('INFO', 'Iniciando apertura de tolva de alimentación.', 'PLC');
      }
      if (PLC_STATE.inputs.FCTolAb) {
        PLC_STATE.outputs.MTolAb = false; // Detener motor tolva al llegar al final
      }
      updateStatusLamps();
      break;
      
    case 'DISCHARGING_C0':
      // Proceso de parada: tolva cerrada, Cinta 0 descargando por 20 segundos
      if (PLC_STATE.inputs.FCTolCe) {
        PLC_STATE.outputs.MTolCe = false;
      }
      
      if (PLC_STATE.control.timer <= 0) {
        // Finalizó descarga de Cinta 0, apagar MC0
        PLC_STATE.outputs.MC0 = false;
        PLC_STATE.outputs.LConC0 = false;
        PLC_STATE.outputs.LDesC0 = true;
        
        // Iniciar temporizador para la cinta de destino activa (20s adicionales)
        PLC_STATE.control.timer = PLC_STATE.config.destDischargeTime * 1000;
        PLC_STATE.control.status = 'DISCHARGING_DEST';
        logEvent('INFO', 'Descarga de Cinta 0 completada. Motor MC0 apagado. Iniciando vaciado de cinta de destino.', 'PLC');
      }
      updateStatusLamps();
      break;
      
    case 'DISCHARGING_DEST':
      // Proceso de parada: cinta de destino activa corriendo por 20s más
      if (PLC_STATE.control.timer <= 0) {
        // Parar el motor de destino y volver a IDLE
        const activeDest = PLC_STATE.physical.targetPosition;
        PLC_STATE.outputs[`MC${activeDest}`] = false;
        PLC_STATE.outputs[`LConC${activeDest}`] = false;
        PLC_STATE.outputs[`LDesC${activeDest}`] = true;
        
        
        PLC_STATE.control.status = 'IDLE';
        PLC_STATE.physical.batchesProcessed++;
        if (PLC_STATE.stats.batchesByDest[activeDest] !== undefined) {
          PLC_STATE.stats.batchesByDest[activeDest]++;
        }
        
        // Disparar evento de estado para el motor estadístico
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('plc-state-change', { detail: { status: 'IDLE' } }));
        }

        logEvent('INFO', `Descarga de Cinta de Destino ${activeDest} completada. Proceso en REPOSO.`, 'PLC');
      }
      updateStatusLamps();
      break;
      
    case 'ALARM':
      // Estado de falla de velocidad (Parada automática de la cinta afectada)
      // El acuse de recibo se realiza pulsando "Paro"
      updateAlarmBlinkLamps();
      break;
      
    case 'EMERGENCY_LOCK':
      // Parada de Emergencia: todas las cintas paradas, luces de descarga encendidas
      stopAllMotors();
      // Lámparas de descarga encendidas y el resto apagadas
      PLC_STATE.outputs.LDescgC1 = true;
      PLC_STATE.outputs.LDescgC2 = true;
      PLC_STATE.outputs.LDescgC3 = true;
      
      PLC_STATE.outputs.LConC0 = false;
      PLC_STATE.outputs.LConC1 = false;
      PLC_STATE.outputs.LConC2 = false;
      PLC_STATE.outputs.LConC3 = false;
      
      PLC_STATE.outputs.LDesC0 = false;
      PLC_STATE.outputs.LDesC1 = false;
      PLC_STATE.outputs.LDesC2 = false;
      PLC_STATE.outputs.LDesC3 = false;
      break;
  }
}

// Configura la iluminación de las lámparas de descarga y conexión en funcionamiento normal / descarga
function updateStatusLamps() {
  const activeDest = PLC_STATE.physical.targetPosition;
  
  // Inicialmente apagar todas las lámparas de descarga
  PLC_STATE.outputs.LDescgC1 = false;
  PLC_STATE.outputs.LDescgC2 = false;
  PLC_STATE.outputs.LDescgC3 = false;
  
  if (PLC_STATE.control.status === 'DISCHARGING_C0') {
    // Encender lámparas de descarga correspondientes
    PLC_STATE.outputs[`LDescgC${activeDest}`] = true;
    
    // Luces de conexión: C0 sigue activa, destino sigue activa
    PLC_STATE.outputs.LConC0 = true;
    PLC_STATE.outputs[`LConC${activeDest}`] = true;
  } else if (PLC_STATE.control.status === 'DISCHARGING_DEST') {
    PLC_STATE.outputs[`LDescgC${activeDest}`] = true;
    PLC_STATE.outputs.LConC0 = false;
    PLC_STATE.outputs.LDesC0 = true;
    PLC_STATE.outputs[`LConC${activeDest}`] = true;
  }
}

// Maneja el parpadeo de las lámparas en caso de alarma OT
function updateAlarmBlinkLamps() {
  const blink = PLC_STATE.control.alarmBlinkState;
  
  // Parpadeo a 2 Hz de la lámpara de desconexión de la cinta averiada
  for (let key in PLC_STATE.control.alarms) {
    if (PLC_STATE.control.alarms[key]) {
      const idx = key === 'C0' ? 0 : parseInt(key[1]);
      // Si la falla es en descarga, parpadea LDescg correspondiente
      if (PLC_STATE.outputs[`LDescgC${idx}`]) {
        PLC_STATE.outputs[`LDescgC${idx}`] = blink;
      } else {
        // En normal, parpadea LDes correspondiente
        PLC_STATE.outputs[`LDesC${idx}`] = blink;
      }
    }
  }
}

// Apagar todos los actuadores / motores
function stopAllMotors() {
  PLC_STATE.outputs.MC0 = false;
  PLC_STATE.outputs.MC1 = false;
  PLC_STATE.outputs.MC2 = false;
  PLC_STATE.outputs.MC3 = false;
  PLC_STATE.outputs.MTolAb = false;
  PLC_STATE.outputs.MTolCe = false;
  PLC_STATE.outputs.MGIzq = false;
  PLC_STATE.outputs.MGDer = false;
}

// Activar alarma OT de velocidad
function triggerAlarm(beltKey, msg) {
  PLC_STATE.control.status = 'ALARM';
  PLC_STATE.control.alarms[beltKey] = true;
  PLC_STATE.stats.alarmCount[beltKey]++;
  if (!PLC_STATE.stats.firstAlarmAt) PLC_STATE.stats.firstAlarmAt = new Date().toISOString();
  PLC_STATE.stats.lastAlarmAt = new Date().toISOString();
  
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('plc-alarm', { detail: { beltKey, msg } }));
  }
  
  // Detener la cinta fallida de inmediato
  if (beltKey === 'C0') {
    PLC_STATE.outputs.MC0 = false;
  } else {
    const idx = parseInt(beltKey[1]);
    PLC_STATE.outputs[`MC${idx}`] = false;
  }
  
  // Si la otra sigue activa, sigue en proceso de descarga si procede.
  // Cerrar tolva de forma preventiva
  PLC_STATE.outputs.MTolAb = false;
  if (!PLC_STATE.inputs.FCTolCe) {
    PLC_STATE.outputs.MTolCe = true;
  }
  
  logEvent('WARNING', `ALERTA VIGILANCIA: ${msg}. Deteniendo motor ${beltKey === 'C0' ? 'MC0' : 'MC' + beltKey[1]}.`, 'PLC');
}

// Aceptar / Limpiar alarma (Acuse de recibo con Paro)
function clearAlarms() {
  PLC_STATE.control.alarms = { C0: false, C1: false, C2: false, C3: false };
  // Apagar todos los motores y restaurar lámparas
  stopAllMotors();
  PLC_STATE.outputs.LConC0 = false;
  PLC_STATE.outputs.LConC1 = false;
  PLC_STATE.outputs.LConC2 = false;
  PLC_STATE.outputs.LConC3 = false;
  PLC_STATE.outputs.LDesC0 = true;
  PLC_STATE.outputs.LDesC1 = true;
  PLC_STATE.outputs.LDesC2 = true;
  PLC_STATE.outputs.LDesC3 = true;
  
  PLC_STATE.outputs.LDescgC1 = false;
  PLC_STATE.outputs.LDescgC2 = false;
  PLC_STATE.outputs.LDescgC3 = false;
  
  PLC_STATE.control.status = 'IDLE';
  logEvent('INFO', 'Alarma acusada y reseteada por operador. Sistema en REPOSO.', 'PLC');
}

// -------------------------------------------------------------
// CONTROLADOR DE RED DEL PLC (Validación de Comandos Firmados)
// -------------------------------------------------------------

async function handleNetworkMessage(encryptedOrSignedMessageStr) {
  try {
    const packet = JSON.parse(encryptedOrSignedMessageStr);
    
    // Verificación de integridad: el paquete debe tener payload y hmac
    if (!packet.payload || !packet.hmac) {
      triggerSecurityLockdown('COMANDO_NO_FIRMADO', 'Se recibió un comando sin firma digital HMAC. Posible manipulación de red.');
      return { success: false, error: 'Comando no firmado' };
    }
    
    const payloadStr = JSON.stringify(packet.payload);
    
    // 1. Validar HMAC con la clave secreta
    const isValidHMAC = await verifyHMAC(payloadStr, packet.hmac, PLC_SHARED_SECRET);
    if (!isValidHMAC) {
      triggerSecurityLockdown('INTEGRIDAD_COMPROMETIDA', `Firma HMAC inválida. Se intentó ejecutar: ${packet.payload.command || 'unknown'}.`);
      return { success: false, error: 'Firma digital no coincide (Tampering bloqueado)' };
    }
    
    // 2. Validar Nonce para evitar ataques de Replay
    const nonce = packet.payload.nonce;
    if (receivedNonces.has(nonce)) {
      triggerSecurityLockdown('ATAQUE_REPLAY_DETECTADO', `Ataque de Replay: Nonce '${nonce}' ya fue procesado previamente.`);
      return { success: false, error: 'Replay Attack detectado y bloqueado' };
    }
    
    // 3. Validar Timestamp para evitar que tramas extremadamente antiguas sean enviadas
    const timestamp = packet.payload.timestamp;
    const now = Date.now();
    if (Math.abs(now - timestamp) > maxNonceAgeMs) {
      triggerSecurityLockdown('TRAMA_EXPIRADA', `Trama expirada por retardo temporal: Delta de ${Math.abs(now - timestamp)}ms.`);
      return { success: false, error: 'Comando expirado por tiempo' };
    }
    
    // Registrar el Nonce como utilizado
    receivedNonces.set(nonce, Date.now());
    
    // Ejecutar el comando aprobado por seguridad
    const result = executeCommand(packet.payload);
    return { success: true, result };
    
  } catch (e) {
    triggerSecurityLockdown('FORMATO_CORRUPTO', `Error al deserializar paquete de red: ${e.message}`);
    return { success: false, error: 'Error de protocolo de red' };
  }
}

// Ejecución de comandos del PLC
function executeCommand(payload) {
  const { command, args, user } = payload;
  
  logEvent('OPERATION', `Comando '${command}' recibido y verificado por firma HMAC (Nonce: ${payload.nonce}).`, user);
  
  switch (command) {
    case 'PMARCHA':
      if (PLC_STATE.control.status === 'IDLE') {
        PLC_STATE.control.status = 'ROTATING';
        logEvent('INFO', `Iniciando secuencia de Marcha. Posicionando plataforma a Posición ${PLC_STATE.physical.targetPosition}.`, 'PLC');
      }
      break;
      
    case 'PPARO':
      if (PLC_STATE.control.status === 'ALARM') {
        clearAlarms();
      } else if (PLC_STATE.control.status === 'RUNNING') {
        // Iniciar secuencia de parada temporizada
        PLC_STATE.outputs.MTolAb = false;
        PLC_STATE.outputs.MTolCe = true; // Cerrar tolva
        
        // Iniciar temporizador de 20s para descargar Cinta 0
        PLC_STATE.control.timer = PLC_STATE.config.cinta0DischargeTime * 1000;
        PLC_STATE.control.status = 'DISCHARGING_C0';
        logEvent('INFO', `Iniciando secuencia de Parada. Cerrando tolva y descargando material de Cinta 0 (Vaciado: ${PLC_STATE.config.cinta0DischargeTime}s).`, 'PLC');
      } else if (PLC_STATE.control.status === 'DISCHARGING_C0' || PLC_STATE.control.status === 'DISCHARGING_DEST') {
        // Parada forzada inmediata de todo el proceso
        stopAllMotors();
        PLC_STATE.control.status = 'IDLE';
        logEvent('INFO', 'Secuencia de parada abortada por operador. Motores apagados inmediatamente.', 'PLC');
      }
      break;
      
    case 'PSELEC':
      // Solo cambiar posición si está inactivo (IDLE o ALARM)
      if (PLC_STATE.control.status === 'IDLE' || PLC_STATE.control.status === 'ALARM') {
        PLC_STATE.physical.targetPosition = (PLC_STATE.physical.targetPosition % 3) + 1;
        // Cambiar lámparas de selección LS
        PLC_STATE.outputs.LS1 = PLC_STATE.physical.targetPosition === 1;
        PLC_STATE.outputs.LS2 = PLC_STATE.physical.targetPosition === 2;
        PLC_STATE.outputs.LS3 = PLC_STATE.physical.targetPosition === 3;
        logEvent('INFO', `Posición de destino seleccionada: Posición ${PLC_STATE.physical.targetPosition}.`, 'PLC');
      }
      break;
      
    case 'EMERGENCY':
      PLC_STATE.control.status = 'EMERGENCY_LOCK';
      logEvent('WARNING', 'PARADA DE EMERGENCIA ACTIVA. Motores apagados. Luces de descarga encendidas.', 'PLC');
      break;
      
    case 'RESET_CI':
      if (PLC_STATE.control.status === 'EMERGENCY_LOCK' || PLC_STATE.control.status === 'ALARM') {
        // Volver a condiciones iniciales
        clearAlarms();
        PLC_STATE.physical.hopperOpenPercent = 0;
        PLC_STATE.physical.currentAngle = 0;
        PLC_STATE.physical.targetPosition = 1;
        PLC_STATE.outputs.LS1 = true;
        PLC_STATE.outputs.LS2 = false;
        PLC_STATE.outputs.LS3 = false;
        PLC_STATE.inputs.FC1 = true;
        PLC_STATE.inputs.FC2 = false;
        PLC_STATE.inputs.FC3 = false;
        PLC_STATE.inputs.FCTolCe = true;
        PLC_STATE.inputs.FCTolAb = false;
        
        logEvent('INFO', 'Retorno a Condiciones Iniciales (CI) completado.', 'PLC');
      }
      break;

    case 'CONFIG_UPDATE':
      // Configuración de tiempos (Solo Ingeniero)
      if (args) {
        PLC_STATE.config.hopperOpenDelay = Number(args.hopperOpenDelay || PLC_STATE.config.hopperOpenDelay);
        PLC_STATE.config.cinta0DischargeTime = Number(args.cinta0DischargeTime || PLC_STATE.config.cinta0DischargeTime);
        PLC_STATE.config.destDischargeTime = Number(args.destDischargeTime || PLC_STATE.config.destDischargeTime);
        
        localStorage.setItem('plcConfig', JSON.stringify(PLC_STATE.config));
        logEvent('CONFIG_CHANGE', `Temporizadores actualizados: Tolva=${PLC_STATE.config.hopperOpenDelay}s, Vaciado C0=${PLC_STATE.config.cinta0DischargeTime}s, Vaciado Destino=${PLC_STATE.config.destDischargeTime}s.`, user);
      }
      break;
      
    case 'FORCE_ACTUATOR':
      // Forzado manual de salidas (Ingeniero)
      if (args && args.output !== undefined && args.value !== undefined) {
        PLC_STATE.outputs[args.output] = !!args.value;
        logEvent('CONFIG_CHANGE', `Forzado de Actuador: ${args.output} = ${args.value}`, user);
      }
      break;
      
    case 'INJECT_FAULT':
      // Inyección de falla de velocidad (Ingeniero)
      if (args && args.sensor !== undefined) {
        PLC_STATE.inputs[args.sensor] = !args.value; // false = falla de velocidad
        logEvent('CONFIG_CHANGE', `Simulación de sensor de velocidad alterada: ${args.sensor} = ${PLC_STATE.inputs[args.sensor] ? 'OK' : 'FALLA (Deslizamiento)'}`, user);
      }
      break;
      
    case 'SECURITY_RESET':
      // Desbloqueo tras ataque cibernético
      PLC_STATE.control.securityLockdown = false;
      PLC_STATE.control.securityLockReason = '';
      clearAlarms();
      logEvent('INFO', 'Bloqueo de ciberseguridad restablecido por el ingeniero.', user);
      break;
  }
  
  return true;
}

// Disparar bloqueo por intrusión (Lockdown de Seguridad OT)
function triggerSecurityLockdown(reason, detailMsg) {
  PLC_STATE.control.securityLockdown = true;
  PLC_STATE.control.securityLockReason = reason;
  PLC_STATE.stats.lockdownCount++;
  if (PLC_STATE.stats.securityEvents[reason] !== undefined) {
    PLC_STATE.stats.securityEvents[reason]++;
  }
  
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('plc-lockdown', { detail: { reason, detailMsg } }));
  }
  stopAllMotors();
  logEvent('SECURITY_ALERT', `ALERTA DE SEGURIDAD OT: ${detailMsg}`, 'PLC_FIREWALL', { reason, detailMsg });
}


/* === js/history-store.js === */

class HistoryStore {
  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
    this.key = 'plcHistory';
    this.buffer = this.load();
    this.startSampling();
  }

  load() {
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  }

  save() {
    localStorage.setItem(this.key, JSON.stringify(this.buffer));
  }

  push(sample) {
    this.buffer.push(sample);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    this.save();
  }

  range(desde, hasta) {
    return this.buffer.filter(s => s.t >= desde && s.t <= hasta);
  }

  downsample(n) {
    if (this.buffer.length <= n) return this.buffer;
    const result = [];
    const step = this.buffer.length / n;
    for (let i = 0; i < n; i++) {
      result.push(this.buffer[Math.floor(i * step)]);
    }
    return result;
  }

  clear() {
    this.buffer = [];
    this.save();
  }

  sizeBytes() {
    return localStorage.getItem(this.key)?.length || 0;
  }

  getLatest() {
    return this.buffer[this.buffer.length - 1] || null;
  }

  getAll() {
    return this.buffer;
  }

  startSampling() {
    setInterval(() => {
      // Tomar muestra si el PLC ha sido usado
      if (PLC_STATE.physical.runTimeSeconds > 0) {
        let activeMotors = 0;
        ['MC0','MC1','MC2','MC3','MGIzq','MGDer','MTolAb','MTolCe'].forEach(m => {
          if (PLC_STATE.outputs[m]) activeMotors++;
        });
        
        let alarmSum = 0;
        if (PLC_STATE.stats && PLC_STATE.stats.alarmCount) {
          alarmSum = Object.values(PLC_STATE.stats.alarmCount).reduce((a,b) => a+b, 0);
        }

        this.push({
          t: Date.now(),
          status: PLC_STATE.control.status,
          batches: PLC_STATE.physical.batchesProcessed,
          units: PLC_STATE.physical.unitsTransferred || 0,
          scrap: PLC_STATE.stats ? PLC_STATE.stats.scrapCount : 0,
          kWh: PLC_STATE.physical.powerConsumptionKWh,
          activeMotors: activeMotors,
          alarmCount: alarmSum
        });
      }
    }, 5000);
  }
}

const historyStore = new HistoryStore();


/* === js/stats-engine.js === */

function computeKPIs() {
  const stats = PLC_STATE.stats || {};
  const tTotal = stats.totalElapsedSeconds || 1;
  const tRunning = (stats.stateTime && stats.stateTime.RUNNING) || 0;
  
  // Disponibilidad
  const availability = tRunning / tTotal;
  
  // Rendimiento (Performance)
  // Asumamos que un ciclo ideal de Cinta 0 toma unos 15 segundos y el vaciado 20s. 
  // Aproximaremos a 1 lote por minuto como tasa teórica máxima para cálculos de OEE realistas en esta simulación.
  const expectedBatches = tRunning / 60;
  const performance = expectedBatches > 0 ? PLC_STATE.physical.batchesProcessed / expectedBatches : 0;
  
  // Calidad (Quality)
  const scrap = stats.scrapCount || 0;
  const units = PLC_STATE.physical.unitsTransferred || 0;
  const quality = (units + scrap > 0) ? units / (units + scrap) : 1;
  
  const oee = availability * Math.min(1, performance) * quality;

  return {
    availability: availability * 100,
    performance: Math.min(1, performance) * 100,
    quality: quality * 100,
    oee: oee * 100,
    batchesProcessed: PLC_STATE.physical.batchesProcessed,
    unitsTransferred: units,
    scrapCount: scrap,
    runTimeSeconds: PLC_STATE.physical.runTimeSeconds
  };
}

function computeReliability() {
  const stats = PLC_STATE.stats || {};
  const tTotal = stats.totalElapsedSeconds || 1;
  const tAlarm = (stats.stateTime && stats.stateTime.ALARM) || 0;
  const alarmSum = stats.alarmCount ? Object.values(stats.alarmCount).reduce((a,b)=>a+b,0) : 0;
  
  // MTBF = Tiempo Operativo / nº alarmas
  const operativeTime = tTotal - tAlarm;
  const mtbf = alarmSum > 0 ? operativeTime / alarmSum : operativeTime;
  
  // MTTR = Tiempo en Alarma / nº alarmas
  const mttr = alarmSum > 0 ? tAlarm / alarmSum : 0;

  return {
    mtbf,
    mttr,
    alarmSum,
    alarmCountByBelt: stats.alarmCount || {},
    lockdowns: stats.lockdownCount || 0
  };
}

function computeEnergy(tarifa = 0.15) {
  const stats = PLC_STATE.stats || {};
  const totalKWh = PLC_STATE.physical.powerConsumptionKWh || 0;
  
  return {
    totalKWh,
    totalCost: totalKWh * tarifa,
    motorKWh: stats.motorKWh || {},
    motorCycles: stats.motorCycles || {}
  };
}

function computeSecurity() {
  const stats = PLC_STATE.stats || {};
  const logs = getLogs();
  const rejections = logs.filter(l => l.type === 'SECURITY_ALERT').length;
  
  return {
    lockdowns: stats.lockdownCount || 0,
    events: stats.securityEvents || {},
    rejections,
    totalEvents: logs.length
  };
}

// Analítica temporal (Ejemplo: throughput de la ventana histórica)
function computeTrends(windowMinutes = 5) {
  const buffer = historyStore.getAll();
  if (buffer.length < 2) return { throughput: 0, trend: 0 };
  
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const windowData = buffer.filter(s => (now - s.t) <= windowMs);
  
  if (windowData.length < 2) return { throughput: 0, trend: 0 };
  
  const first = windowData[0];
  const last = windowData[windowData.length - 1];
  
  const dBatches = last.batches - first.batches;
  const dT = (last.t - first.t) / (1000 * 60); /* minutes */
  
  return {
    throughput: dT > 0 ? dBatches / dT : 0, /* lotes/min */
    windowMinutes: dT
  };
}


/* === js/charts.js === */
function renderGauge(containerId, value, min = 0, max = 100, title = '', suffix = '%') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const angle = (pct / 100) * 180 - 90;
  let color = '#a855f7';
  if (pct < 50) color = '#d8b4fe';
  if (pct < 20) color = '#ef4444';
  
  const svg = `
    <svg viewBox="0 0 200 120" style="width:100%; height:100%;">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#333" stroke-width="20" stroke-linecap="round"/>
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" stroke-dasharray="251.2" stroke-dashoffset="${251.2 * (1 - pct/100)}"/>
      <text x="100" y="90" text-anchor="middle" fill="white" font-size="28" font-weight="bold">${Math.round(value)}${suffix}</text>
      <text x="100" y="115" text-anchor="middle" fill="#aaa" font-size="12">${title}</text>
    </svg>
  `;
  container.innerHTML = svg;
}

function renderBarChart(containerId, data, labels, title = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const maxVal = Math.max(...data, 1);
  const barWidth = 40;
  const spacing = 20;
  const w = Math.max(data.length * (barWidth + spacing) + spacing, 300);
  
  let bars = '';
  data.forEach((val, i) => {
    const h = (val / maxVal) * 80;
    const x = spacing + i * (barWidth + spacing);
    bars += `
      <rect x="${x}" y="${100 - h}" width="${barWidth}" height="${h}" fill="#a855f7" rx="2" />
      <text x="${x + barWidth/2}" y="115" text-anchor="middle" fill="#aaa" font-size="10">${labels[i]}</text>
      <text x="${x + barWidth/2}" y="${95 - h}" text-anchor="middle" fill="white" font-size="10">${val.toFixed(1)}</text>
    `;
  });
  
  const svg = `
    <svg viewBox="0 0 ${w} 130" style="width:100%; height:100%;">
      ${title ? `<text x="${w/2}" y="15" text-anchor="middle" fill="#ccc" font-size="12">${title}</text>` : ''}
      <line x1="0" y1="100" x2="${w}" y2="100" stroke="#555" stroke-width="1" />
      ${bars}
    </svg>
  `;
  container.innerHTML = svg;
}

function renderSparkline(containerId, data, color = '#a855f7') {
  const container = document.getElementById(containerId);
  if (!container || data.length < 2) return;
  
  const w = 100, h = 30;
  const maxVal = Math.max(...data, 0.01);
  const minVal = Math.min(...data);
  const range = maxVal - minVal || 1;
  
  const dx = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * dx;
    const y = h - ((v - minVal) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:100%;" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" />
    </svg>
  `;
  container.innerHTML = svg;
}

function renderDonut(containerId, data, labels, colors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const total = data.reduce((a,b)=>a+b,0) || 1;
  let acc = 0;
  let paths = '';
  let legend = '';
  
  data.forEach((val, i) => {
    const pct = val / total;
    const angle1 = acc * Math.PI * 2;
    acc += pct;
    const angle2 = acc * Math.PI * 2;
    
    const x1 = 50 + 40 * Math.sin(angle1);
    const y1 = 50 - 40 * Math.cos(angle1);
    const x2 = 50 + 40 * Math.sin(angle2);
    const y2 = 50 - 40 * Math.cos(angle2);
    
    const largeArc = pct > 0.5 ? 1 : 0;
    if (pct >= 1) { 
      paths += `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i]}" stroke-width="15" />`;
    } else if (pct > 0) {
      paths += `<path d="M ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${colors[i]}" stroke-width="15" />`;
    }
    
    legend += `
      <div style="display:flex; align-items:center; font-size:10px; color:#aaa; margin-top:4px;">
        <div style="width:10px; height:10px; background:${colors[i]}; margin-right:5px; border-radius:2px;"></div>
        ${labels[i]}: ${val}
      </div>
    `;
  });
  
  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; height:100%;">
      <svg viewBox="0 0 100 100" style="width:120px; height:120px;">
        ${paths}
        <text x="50" y="55" text-anchor="middle" fill="white" font-size="14" font-weight="bold">${total}</text>
      </svg>
      <div style="margin-left: 20px;">
        ${legend}
      </div>
    </div>
  `;
}

function renderHorizontalBar(containerId, data, labels, title = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const maxVal = Math.max(...data, 1);
  const barHeight = 20;
  const spacing = 10;
  const h = data.length * (barHeight + spacing) + spacing + 20;
  const w = 300;
  
  let bars = '';
  data.forEach((val, i) => {
    const width = (val / maxVal) * (w - 100);
    const y = spacing + i * (barHeight + spacing) + 20;
    bars += `
      <text x="5" y="${y + 14}" fill="#aaa" font-size="10">${labels[i]}</text>
      <rect x="80" y="${y}" width="${width}" height="${barHeight}" fill="#a855f7" rx="2" />
      <text x="${80 + width + 5}" y="${y + 14}" fill="white" font-size="10">${val.toFixed(1)}</text>
    `;
  });
  
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:100%;">
      ${title ? `<text x="${w/2}" y="15" text-anchor="middle" fill="#ccc" font-size="12">${title}</text>` : ''}
      ${bars}
    </svg>
  `;
  container.innerHTML = svg;
}


/* === js/dashboard.js === */

let updateInterval = null;

function initDashboard() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(refreshDashboard, 1000); // 1 Hz
  
  // Render inicial para que no se vea vacío el primer segundo
  setTimeout(refreshDashboard, 100);
}

function refreshDashboard() {
  const tabAnalytics = document.getElementById('tab-analytics');
  if (!tabAnalytics) return;
  
  const isAnalyticsVisible = !tabAnalytics.classList.contains('hidden');
  if (!isAnalyticsVisible) return;

  const kpis = computeKPIs();
  const rel = computeReliability();
  const energy = computeEnergy();
  
  if (isAnalyticsVisible) {
    const elPower = document.getElementById('kpi-power');
    const elCost = document.getElementById('kpi-cost');
    if (elPower) elPower.innerText = `${energy.totalKWh.toFixed(3)} kWh`;
    if (elCost) elCost.innerText = `$${energy.totalCost.toFixed(3)} USD`;
    
    const labels = ['C0', 'C1', 'C2', 'C3', 'Tolva/MG'];
    const data = [
      energy.motorKWh['MC0'] || 0,
      energy.motorKWh['MC1'] || 0,
      energy.motorKWh['MC2'] || 0,
      energy.motorKWh['MC3'] || 0,
      (energy.motorKWh['MTolAb'] || 0) + (energy.motorKWh['MTolCe'] || 0) + (energy.motorKWh['MGIzq'] || 0) + (energy.motorKWh['MGDer'] || 0)
    ];
    renderBarChart('chart-energy', data, labels, '');

    const cintasHours = [
      ((energy.motorKWh['MC0'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC1'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC2'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC3'] || 0) / 1.5).toFixed(2)
    ].map(Number);
    renderHorizontalBar('chart-maintenance', cintasHours, ['C0', 'C1', 'C2', 'C3'], 'Horas de uso por cinta (Simulado)');
  
    const elOee = document.getElementById('kpi-oee');
    const elAvail = document.getElementById('kpi-avail');
    const elPerf = document.getElementById('kpi-perf');
    const elMtbf = document.getElementById('kpi-mtbf');
    
    if (elOee) elOee.innerText = `${kpis.oee.toFixed(1)}%`;
    if (elAvail) elAvail.innerText = `${kpis.availability.toFixed(1)}%`;
    if (elPerf) elPerf.innerText = `${kpis.performance.toFixed(1)}%`;
    if (elMtbf) elMtbf.innerText = `${rel.mtbf.toFixed(0)}s`;
    
    const alarms = [
      rel.alarmCountByBelt['C0'] || 0,
      rel.alarmCountByBelt['C1'] || 0,
      rel.alarmCountByBelt['C2'] || 0,
      rel.alarmCountByBelt['C3'] || 0
    ];
    renderBarChart('chart-alarms', alarms, ['C0', 'C1', 'C2', 'C3'], '');
    
    const dest = PLC_STATE?.stats?.batchesByDest || {1:0, 2:0, 3:0};
    const destData = [dest[1] || 0, dest[2] || 0, dest[3] || 0];
    if (destData.some(d => d > 0)) {
        renderDonut('chart-destinations', destData, ['Dest 1', 'Dest 2', 'Dest 3'], ['#00e676', '#ff9100', '#00e5ff']);
    } else {
        renderDonut('chart-destinations', [1], ['Sin Lotes'], ['#333']);
    }
  }
}


/* === js/n8n-connector.js === */

const N8N_WEBHOOK_URL = 'http://localhost:5678/webhook/hmi-ask'; // Configurable URL
let connectorActive = false;

async function askAgent(message, history) {
  const payload = {
    message,
    history,
    context: {
      kpis: computeKPIs(),
      reliability: computeReliability(),
      energy: computeEnergy(),
      security: computeSecurity(),
      status: PLC_STATE.control.status,
      activeAlarms: Object.keys(PLC_STATE.control.alarms || {}).filter(k => PLC_STATE.control.alarms[k]),
      timestamp: new Date().toISOString()
    }
  };

  // Cargar configuración desde localStorage (establecida en la pestaña de Ajustes)
  // Hardcode configuration so the user never has to save it again
  const cfgUrl = localStorage.getItem('n8n_url') || 'https://agentes.henkki.co/webhook-test/hmi-ask';
  const authType = localStorage.getItem('n8n_auth_type') || 'none';
  const authCred = localStorage.getItem('n8n_cred') || '';

  const headers = { 'Content-Type': 'application/json' };
  
  if (authType === 'basic' && authCred) {
    headers['Authorization'] = 'Basic ' + btoa(authCred);
  } else if (authType === 'header' && authCred) {
    headers['Authorization'] = authCred;
    // O si prefieren x-api-key, esto dependerá del n8n. Por defecto se usa Authorization.
    // headers['x-api-key'] = authCred; 
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout
    
    const response = await fetch(cfgUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('N8N HTTP Error: ' + response.status);
    
    connectorActive = true;
    const data = await response.json();
    return { text: data.reply || data.output || "Respuesta vacía del agente.", isFallback: false };
    
  } catch (err) {
    connectorActive = false;
    return { text: generateFallbackResponse(message), isFallback: true };
  }
}

function isAgentConnected() {
  return connectorActive;
}

function generateFallbackResponse(msg) {
  const lowerMsg = msg.toLowerCase();
  const kpis = computeKPIs();
  
  if (lowerMsg.includes('oee')) {
    return `(Local) Actualmente el OEE es del ${kpis.oee.toFixed(1)}% (Disponibilidad: ${kpis.availability.toFixed(1)}%, Rendimiento: ${kpis.performance.toFixed(1)}%, Calidad: ${kpis.quality.toFixed(1)}%).`;
  }
  if (lowerMsg.includes('alarma') || lowerMsg.includes('falla') || lowerMsg.includes('error')) {
    const rel = computeReliability();
    return `(Local) Se han registrado ${rel.alarmSum} alarmas en total. El tiempo medio entre fallos (MTBF) actual es de ${rel.mtbf.toFixed(0)} segundos.`;
  }
  if (lowerMsg.includes('energia') || lowerMsg.includes('consumo') || lowerMsg.includes('costo')) {
    const e = computeEnergy();
    return `(Local) El consumo energético acumulado es de ${e.totalKWh.toFixed(3)} kWh, con un costo estimado de $${e.totalCost.toFixed(2)} USD.`;
  }
  if (lowerMsg.includes('lote') || lowerMsg.includes('produccion')) {
    return `(Local) Se han procesado ${kpis.batchesProcessed} lotes completos. Se han transferido un total de ${kpis.unitsTransferred} unidades.`;
  }
  if (lowerMsg.includes('seguridad') || lowerMsg.includes('ciberseguridad') || lowerMsg.includes('ataque')) {
    const sec = computeSecurity();
    return `(Local) Han ocurrido ${sec.rejections} alertas de seguridad que causaron ${sec.lockdowns} bloqueos preventivos (lockdowns) en el sistema OT.`;
  }
  
  return `(Modo Local / Sin Conexión a n8n) No logro conectar con mi servidor principal. Actualmente te puedo responder de forma limitada sobre el OEE, Alarmas, Producción, Energía o Ciberseguridad si usas esas palabras clave.`;
}


/* === js/chat-widget.js === */

let chatHistory = [];

function initChatWidget() {
  const btnOpen = document.getElementById('btn-open-chat');
  const btnClose = document.getElementById('btn-toggle-chat');
  const chatWidget = document.getElementById('ai-chat-widget');
  const btnSend = document.getElementById('btn-send-chat');
  const input = document.getElementById('chat-input');
  
  if (!btnOpen || !chatWidget) return;
  
  // Mostrar el botón de abrir si tiene permisos
  setInterval(() => {
    const hasPerm = checkPermission('USE_AI_ASSISTANT');
    if (hasPerm && chatWidget.classList.contains('hidden')) {
      btnOpen.classList.remove('hidden');
    } else {
      btnOpen.classList.add('hidden');
      if (!hasPerm && !chatWidget.classList.contains('hidden')) {
        chatWidget.classList.add('hidden');
      }
    }
  }, 1000);
  
  btnOpen.addEventListener('click', () => {
    chatWidget.classList.remove('hidden');
    btnOpen.classList.add('hidden');
    input.focus();
  });
  
  btnClose.addEventListener('click', () => {
    chatWidget.classList.add('hidden');
    btnOpen.classList.remove('hidden');
  });
  
  btnSend.addEventListener('click', handleSend);
  
  // Quick replies
  const quickReplies = document.querySelectorAll('.btn-quick-reply');
  quickReplies.forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.innerText;
      btnSend.click();
    });
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });
  
  // Polling para el estado de conexión del led
  setInterval(() => {
    const led = document.getElementById('chat-status-led');
    if (led) {
      if (isAgentConnected()) {
        led.className = 'status-led led-green';
        led.title = 'Agente N8N Conectado';
      } else {
        led.className = 'status-led led-orange';
        led.title = 'Modo Local / Degradado (Sin conexión)';
      }
    }
  }, 2000);
}

async function handleSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  addMessage(text, 'user');
  
  // Guardar en auditoría
  const currentUser = getCurrentUser();
  logEvent('AI_INTERACTION', `Consulta al Asistente IA: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`, currentUser ? currentUser.name : 'Unknown');
  
  // Mostrar indicador de "escribiendo..."
  const thinkingId = addMessage('...', 'bot-thinking');
  
  const historyContext = chatHistory.slice(-6); // últimos 6 mensajes
  
  try {
    const response = await askAgent(text, historyContext);
    
    // Remover thinking
    const el = document.getElementById(thinkingId);
    if (el) el.remove();
    
    addMessage(response.text, 'bot');
    chatHistory.push({ role: 'user', content: text });
    chatHistory.push({ role: 'assistant', content: response.text });
    
  } catch (err) {
    const el = document.getElementById(thinkingId);
    if (el) el.remove();
    addMessage('Error interno al consultar al agente.', 'bot');
  }
}

function addMessage(text, type) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  const id = 'msg-' + Date.now() + '-' + Math.floor(Math.random()*1000);
  div.id = id;
  
  if (type === 'user') {
    div.className = 'msg user';
  } else if (type === 'bot' || type === 'bot-thinking') {
    div.className = 'msg bot';
  }
  
  div.textContent = text; // Previene XSS
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}


/* === js/hmi-controller.js === */

// Clave secreta compartida (debe coincidir con la del PLC)
var PLC_SHARED_SECRET = "PlcSuperSecretKeyOT2026!";

// Registro de tráfico de red virtual para visualización
let networkTraffic = [];

function logNetworkTraffic(direction, packet) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toLocaleTimeString(),
    direction, // 'SENT' o 'RECEIVED'
    data: packet
  };
  
  networkTraffic.unshift(entry);
  if (networkTraffic.length > 30) {
    networkTraffic.pop();
  }
  
  window.dispatchEvent(new CustomEvent('network-traffic-updated', { detail: entry }));
}

function getNetworkTraffic() {
  return networkTraffic;
}

// Enviar comando seguro al PLC (firmado con HMAC y Nonce)
async function sendSecureCommand(command, args = null) {
  const user = getCurrentUser();
  const userName = user ? `${user.name} (${user.role})` : 'ANONYMOUS';
  
  const payload = {
    command,
    args,
    user: userName,
    timestamp: Date.now(),
    nonce: generateNonce()
  };
  
  const payloadStr = JSON.stringify(payload);
  const hmac = await generateHMAC(payloadStr, PLC_SHARED_SECRET);
  
  const packet = {
    payload,
    hmac
  };
  
  logNetworkTraffic('SENT', packet);
  
  const response = await handleNetworkMessage(JSON.stringify(packet));
  
  logNetworkTraffic('RECEIVED', response);
  return response;
}


// -------------------------------------------------------------
// RENDERIZADOR DEL PROCESO FÍSICO EN CANVAS 2D — COCKPIT INDUSTRIAL (NUEVO DISEÑO 3D-ISH)
// -------------------------------------------------------------

function drawTrapezoid(ctx, x, y, topW, bottomW, h, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x - topW/2, y);
  ctx.lineTo(x + topW/2, y);
  ctx.lineTo(x + bottomW/2, y + h);
  ctx.lineTo(x - bottomW/2, y + h);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawIsometricBelt(ctx, x, y, width, length, angleRad, isRunning, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  
  // 1. Sombra exterior
  ctx.shadowBlur = 15;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-width/2, 5, width, length);
  ctx.shadowBlur = 0;

  // 2. Chasis Metálico (Base Zinc)
  const chassisGrad = ctx.createLinearGradient(-width/2 - 8, 0, width/2 + 8, 0);
  chassisGrad.addColorStop(0, '#09090b');
  chassisGrad.addColorStop(0.2, '#27272a');
  chassisGrad.addColorStop(0.8, '#27272a');
  chassisGrad.addColorStop(1, '#09090b');
  
  ctx.fillStyle = chassisGrad;
  // Borde redondeado simulado con un path
  ctx.beginPath();
  ctx.roundRect(-width/2 - 6, -6, width + 12, length + 12, 5);
  ctx.fill();
  
  // 3. Rieles laterales Neón (Brillan si está corriendo)
  if (isRunning) {
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#a855f7';
    ctx.strokeStyle = '#a855f7';
  } else {
    ctx.strokeStyle = '#3f3f46';
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-width/2 - 2, -2); ctx.lineTo(-width/2 - 2, length + 2);
  ctx.moveTo(width/2 + 2, -2); ctx.lineTo(width/2 + 2, length + 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 4. Superficie de la banda (Goma oscura)
  const beltGrad = ctx.createLinearGradient(0, 0, 0, length);
  beltGrad.addColorStop(0, '#18181b');
  beltGrad.addColorStop(0.5, '#27272a');
  beltGrad.addColorStop(1, '#18181b');
  ctx.fillStyle = beltGrad;
  ctx.fillRect(-width/2, 0, width, length);

  // 5. Rodillos metálicos con brillo
  const rollerGrad = ctx.createLinearGradient(-width/2, 0, width/2, 0);
  rollerGrad.addColorStop(0, '#18181b');
  rollerGrad.addColorStop(0.5, '#71717a');
  rollerGrad.addColorStop(1, '#18181b');
  
  ctx.fillStyle = rollerGrad;
  for(let dy = 10; dy < length - 10; dy += 20) {
    ctx.fillRect(-width/2 + 2, dy, width - 4, 6);
  }

  // 6. Animación de Flujo (Láseres Púrpura)
  if (isRunning) {
    const shift = (Date.now() / 15) % 40;
    ctx.strokeStyle = 'rgba(216, 180, 254, 0.8)'; // Light Purple
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#d8b4fe';
    ctx.lineWidth = 2;
    for(let dy = shift - 40; dy < length; dy += 40) {
      if (dy > 0 && dy < length) {
        ctx.beginPath();
        // Forma de V para dar efecto de avance
        ctx.moveTo(-width/2 + 10, dy - 5);
        ctx.lineTo(0, dy + 5);
        ctx.lineTo(width/2 - 10, dy - 5);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }
  
  // 7. Etiqueta Holográfica
  ctx.rotate(-angleRad);
  ctx.fillStyle = isRunning ? '#d8b4fe' : '#a1a1aa';
  ctx.font = 'bold 13px "JetBrains Mono"';
  ctx.textAlign = 'center';
  if (isRunning) {
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#a855f7';
  }
  
  // Posicionamiento inteligente del texto según el ángulo
  let textY = length/2 + 40;
  if (Math.abs(angleRad) > 1.5) textY = -length/2 - 30; // Si está boca abajo
  
  ctx.fillText(label, 0, textY);
  ctx.shadowBlur = 0;
  
  ctx.restore();
}

function draw3DHopper(ctx, x, y, openPercent, isRunning) {
  // ==========================================
  // ESTILO TOLVA PREMIUM 3D CYBERPUNK
  // ==========================================
  const hopperTopW = 120;
  const hopperBotW = 40;
  const hopperH = 100;
  const topY = y - hopperH;
  
  // 1. Shadow/Glow base
  ctx.shadowBlur = 20;
  ctx.shadowColor = 'rgba(168, 85, 247, 0.3)';
  
  // 2. Main Body Gradient (Metallic Dark Zinc)
  const bodyGrad = ctx.createLinearGradient(x - hopperTopW/2, 0, x + hopperTopW/2, 0);
  bodyGrad.addColorStop(0, '#18181b'); // Dark edge
  bodyGrad.addColorStop(0.3, '#3f3f46'); // Metallic highlight
  bodyGrad.addColorStop(0.7, '#27272a'); // Mid tone
  bodyGrad.addColorStop(1, '#09090b'); // Shadow
  
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(x - hopperTopW/2, topY);
  ctx.lineTo(x + hopperTopW/2, topY);
  ctx.lineTo(x + hopperBotW/2, y);
  ctx.lineTo(x - hopperBotW/2, y);
  ctx.closePath();
  ctx.fill();
  
  // 3. Metallic Rim (Top)
  ctx.fillStyle = '#71717a';
  ctx.beginPath();
  ctx.ellipse(x, topY, hopperTopW/2, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner dark hole
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(x, topY, hopperTopW/2 - 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // 4. Glass/Window Level Indicator (Centro)
  const windowW = 20;
  const windowTopW = 50;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.moveTo(x - windowTopW/2, topY + 20);
  ctx.lineTo(x + windowTopW/2, topY + 20);
  ctx.lineTo(x + windowW/2, y - 15);
  ctx.lineTo(x - windowW/2, y - 15);
  ctx.closePath();
  ctx.fill();
  
  // Material Level inside window (Glowing Neon)
  const fillLvl = 0.6; 
  const fillTopY = y - 15 - ((hopperH - 35) * fillLvl);
  const fillTopW = windowW + ((windowTopW - windowW) * fillLvl);
  
  const levelGrad = ctx.createLinearGradient(0, fillTopY, 0, y - 15);
  levelGrad.addColorStop(0, 'rgba(168, 85, 247, 0.8)'); // Neon Purple
  levelGrad.addColorStop(1, 'rgba(168, 85, 247, 0.2)');
  
  ctx.fillStyle = levelGrad;
  ctx.beginPath();
  ctx.moveTo(x - fillTopW/2, fillTopY);
  ctx.lineTo(x + fillTopW/2, fillTopY);
  ctx.lineTo(x + windowW/2, y - 15);
  ctx.lineTo(x - windowW/2, y - 15);
  ctx.closePath();
  ctx.fill();
  
  // Window grid/lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - windowTopW/2, topY + 40); ctx.lineTo(x + windowTopW/2, topY + 40);
  ctx.moveTo(x - windowTopW/2 + 5, topY + 60); ctx.lineTo(x + windowTopW/2 - 5, topY + 60);
  ctx.stroke();

  // 5. Discharge Gate Assembly (Bottom)
  ctx.shadowBlur = 0;
  const gateY = y;
  
  // Flange
  ctx.fillStyle = '#52525b'; // Zinc
  ctx.fillRect(x - 25, gateY, 50, 8);
  
  // Animated Valve / Gate
  ctx.fillStyle = openPercent > 10 ? '#22c55e' : '#ef4444'; // Green if open, Red if closed
  ctx.fillRect(x - 20, gateY + 10, 40 * (openPercent / 100), 4);
  ctx.shadowBlur = openPercent > 10 ? 10 : 0;
  ctx.shadowColor = ctx.fillStyle;
  ctx.fillRect(x - 20, gateY + 10, 40 * (openPercent / 100), 4);
  ctx.shadowBlur = 0;
  
  // Valve body
  ctx.fillStyle = '#27272a';
  ctx.fillRect(x - 22, gateY + 8, 44, 12);
  
  // 6. Holographic Text Label
  ctx.fillStyle = '#d8b4fe';
  ctx.font = 'bold 14px "JetBrains Mono"';
  ctx.textAlign = 'center';
  ctx.shadowBlur = 5;
  ctx.shadowColor = '#a855f7';
  ctx.fillText('SILO PRINCIPAL', x, topY - 25);
  
  ctx.shadowBlur = 0;
}

function drawMaterialParticle(ctx, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  
  // Outer glow
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;
  
  // Sphere base
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  // Inner highlight (3D effect)
  ctx.shadowBlur = 0;
  const highlight = ctx.createRadialGradient(-2, -2, 0, 0, 0, 5);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

function drawLimitSwitch(ctx, x, y, isActive, label) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - 15, y - 10, 30, 20);
  ctx.strokeStyle = isActive ? '#00f0ff' : '#4b5563';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 15, y - 10, 30, 20);
  
  ctx.fillStyle = isActive ? '#00f0ff' : '#374151';
  ctx.shadowBlur = isActive ? 10 : 0;
  ctx.shadowColor = '#00f0ff';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.fillStyle = '#fff';
  ctx.font = '10px "Share Tech Mono"';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 15);
}

function drawConveyorSystem(canvas, state) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  
  // Background gradient is now handled by CSS or subtle canvas clear
  ctx.clearRect(0, 0, W, H);
  
  // Draw floor grid for industrial look
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for(let i=0; i<W; i+=50) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
  }
  for(let i=0; i<H; i+=50) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
  }

  const centerX = W / 2;
  const centerY = H / 2;
  
  // Central Turntable (Plataforma Giratoria)
  ctx.save();
  ctx.translate(centerX, centerY);
  
  // Turntable base
  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(0, 0, 160, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 160, 0, Math.PI*2); ctx.stroke();
  
  // Turntable rotation
  const aRad = (state.physical.currentAngle * Math.PI) / 180;
  ctx.rotate(aRad);
  
  // Cinta 0 (mounted on turntable)
  // Drawn horizontally on the turntable, but center of rotation is at the start of Cinta 0
  ctx.translate(0, 0); // Origin is center of turntable
  // Wait, in previous logic Cinta 0 extends outward from center.
  // Actually, Cinta 0 should bring material FROM hopper TO center.
  // Let's place Hopper at top, Cinta 0 brings it to center. Turntable directs to C1, C2, C3.
  // Original logic: Hopper -> Cinta 0 -> (Angle) -> C1, C2, C3.
  ctx.restore();

  // Let's adjust positions:
  const hopperX = centerX;
  const hopperY = centerY - 300;
  const beltLength = 200;
  const beltWidth = 60;
  
  // CINTA 0 (Hopper to Center)
  drawIsometricBelt(ctx, centerX, centerY - 150, beltWidth, beltLength, 0, state.outputs.MC0, 'CINTA 0 (ALIMENTACIÓN)');
  
  // TURNTABLE (At Center)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.fillStyle = '#0f172a';
  ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2); ctx.stroke();
  
  // Arrow showing rotation direction
  ctx.rotate(aRad);
  ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-20, 70); ctx.lineTo(20, 70); ctx.fill();
  ctx.restore();

  // DESTINATION BELTS (C1, C2, C3)
  // Pos 1 = 0 deg (Down), Pos 2 = 90 deg (Right), Pos 3 = 180 deg (Up/Left? Wait, previous logic was Left, Right, Down)
  // Let's draw them radially from center.
  // C1 (Left)
  drawIsometricBelt(ctx, centerX - 180, centerY, beltWidth, beltLength, Math.PI/2, state.outputs.MC1, 'CINTA 1');
  // C3 (Right)
  drawIsometricBelt(ctx, centerX + 180, centerY, beltWidth, beltLength, -Math.PI/2, state.outputs.MC3, 'CINTA 3');
  // C2 (Down)
  drawIsometricBelt(ctx, centerX, centerY + 180, beltWidth, beltLength, 0, state.outputs.MC2, 'CINTA 2');

  // HOPPER
  draw3DHopper(ctx, hopperX, hopperY, state.physical.hopperOpenPercent, state.outputs.MTolAb || state.outputs.MTolCe);

  // MATERIAL PARTICLES
  // Cinta 0
  state.physical.materialOnCinta0.forEach(p => {
    // p.x goes from 0 to 1. 0 is at hopper, 1 is at center.
    const px = centerX + (p.y - 15) * 2; // slight scatter
    const py = (centerY - 250) + p.x * beltLength;
    drawMaterialParticle(ctx, px, py, '#f59e0b');
  });
  
  // Destination Belts
  state.physical.materialOnDest.forEach(p => {
    let px = centerX, py = centerY;
    // p.x goes from 0 to 1 (center to edge)
    if (p.cinta === 1) { // Left
      px = (centerX - 80) - p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 3) { // Right
      px = (centerX + 80) + p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 2) { // Down
      px = centerX + (p.y - 15);
      py = (centerY + 80) + p.x * beltLength;
    }
    drawMaterialParticle(ctx, px, py, '#10b981');
  });

  // LIMIT SWITCHES
  drawLimitSwitch(ctx, centerX, centerY + 100, state.inputs.FC1, 'FC1 (POS 1)');
  drawLimitSwitch(ctx, centerX + 100, centerY, state.inputs.FC2, 'FC2 (POS 2)');
  drawLimitSwitch(ctx, centerX - 100, centerY, state.inputs.FC3, 'FC3 (POS 3)');
  
  // LOCKDOWN ALERTS
  if (state.control.securityLockdown) {
    ctx.fillStyle = 'rgba(255, 0, 51, 0.2)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff0033';
    ctx.font = 'bold 36px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('🚨 LOCKDOWN ACTIVO 🚨', W/2, H/2 - 50);
    ctx.font = '20px "Share Tech Mono"';
    ctx.fillText(state.control.securityLockReason, W/2, H/2);
  }
}


/* === js/app.js === */

// Capturar última trama válida para ataque de replay
let lastValidPacket = null;

// Suscribirse a actualizaciones del tráfico de red
window.addEventListener('network-traffic-updated', (e) => {
  const entry = e.detail;
  if (entry.direction === 'SENT' && !entry.data.payload.user.includes('Hacker')) {
    lastValidPacket = entry.data; // Guardar la última trama legítima enviada
  }
  renderNetworkTraffic();
});

// Suscribirse a actualizaciones del log de auditoría
window.addEventListener('audit-log-updated', () => {
  renderAuditLogs();
});

// Función de actualización de la UI invocada en cada ciclo de la simulación
function updateUI(state) {
  const canvas = document.getElementById('plant-canvas');
  if (canvas) {
    drawConveyorSystem(canvas, state);
  }
  
  // Actualizar indicadores digitales y analógicos en la pantalla
  const elStatus = document.getElementById('state-display');
  if (elStatus) elStatus.innerText = state.control.status;
  
  const elAngle = document.getElementById('cinta0-angle');
  if (elAngle) elAngle.innerText = state.physical.currentAngle.toFixed(0);
  
  const elHopper = document.getElementById('hopper-percent');
  if (elHopper) elHopper.innerText = state.physical.hopperOpenPercent.toFixed(0) + '%';
  
  const elPos = document.getElementById('active-pos-lbl');
  if (elPos) elPos.innerText = `Posición ${state.physical.targetPosition}`;
  
  // Actualizar luces indicadoras LED en el panel
  updateLed('led-ls1', state.outputs.LS1, 'yellow');
  updateLed('led-ls2', state.outputs.LS2, 'yellow');
  updateLed('led-ls3', state.outputs.LS3, 'yellow');
  
  updateLed('led-lcon-c0', state.outputs.LConC0, 'green');
  updateLed('led-lcon-c1', state.outputs.LConC1, 'green');
  updateLed('led-lcon-c2', state.outputs.LConC2, 'green');
  updateLed('led-lcon-c3', state.outputs.LConC3, 'green');
  
  updateLed('led-ldes-c0', state.outputs.LDesC0, 'red-blink');
  updateLed('led-ldes-c1', state.outputs.LDesC1, 'red-blink');
  updateLed('led-ldes-c2', state.outputs.LDesC2, 'red-blink');
  updateLed('led-ldes-c3', state.outputs.LDesC3, 'red-blink');
  
  updateLed('led-ldescg-c1', state.outputs.LDescgC1, 'orange-blink');
  updateLed('led-ldescg-c2', state.outputs.LDescgC2, 'orange-blink');
  updateLed('led-ldescg-c3', state.outputs.LDescgC3, 'orange-blink');

  // Si parpadeo está activo, aplicar parpadeo dinámico a LDes
  if (state.control.status === 'ALARM') {
    const isLit = state.control.alarmBlinkState;
    for (let key in state.control.alarms) {
      if (state.control.alarms[key]) {
        const id = key === 'C0' ? 0 : parseInt(key[1]);
        const ledEl = document.getElementById(`led-ldes-c${id}`);
        if (ledEl) {
          ledEl.className = isLit ? 'status-led led-red' : 'status-led led-off';
        }
      }
    }
  }

  // Actualizar KPIs viejos si existen
  const elRt = document.getElementById('kpi-runtime');
  if (elRt) elRt.innerText = formatTime(state.physical.runTimeSeconds);
  
  const elBatches = document.getElementById('kpi-batches');
  if (elBatches) elBatches.innerText = state.physical.batchesProcessed;
  
  const elPwr = document.getElementById('kpi-power');
  if (elPwr) elPwr.innerText = state.physical.powerConsumptionKWh.toFixed(4) + ' kWh';
  
  const elCost = document.getElementById('kpi-cost');
  if (elCost) elCost.innerText = '$' + (state.physical.powerConsumptionKWh * 0.15).toFixed(4) + ' USD';
  
  // Actualizar controles de forzado en el panel del Ingeniero
  if (checkPermission('FORCE_ACTUATOR')) {
    updateForcedSwitches(state);
  }
}

// Auxiliar para actualizar luces LED
function updateLed(id, isActive, color) {
  const el = document.getElementById(id);
  if (!el) return;
  
  if (!isActive) {
    el.className = 'led-indicator led-off';
  } else {
    if (color === 'red-blink') {
      el.className = 'led-indicator led-red';
    } else if (color === 'orange-blink') {
      el.className = 'led-indicator led-orange';
    } else if (color === 'green') {
      el.className = 'led-indicator led-green';
    } else if (color === 'yellow') {
      el.className = 'led-indicator led-yellow';
    }
  }
}

function formatTime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Pintar la lista de logs de red
function renderNetworkTraffic() {
  const tbody = document.getElementById('network-traffic-logs');
  if (!tbody) return;
  
  const traffic = getNetworkTraffic();
  tbody.innerHTML = traffic.map(t => {
    const isSent = t.direction.startsWith('SENT');
    const badgeClass = isSent 
      ? (t.direction.includes('ATTACK') ? 'badge-attack' : 'badge-sent') 
      : 'badge-received';
    
    // Formatear payload de forma legible
    let payloadDesc = '';
    if (isSent) {
      const payload = t.data.payload;
      payloadDesc = `CMD: <strong>${payload.command}</strong> | Nonce: <code>${payload.nonce}</code> | HMAC: <code class="truncate-text">${t.data.hmac.slice(0, 10)}...</code>`;
    } else {
      payloadDesc = t.data.success 
        ? `<span class="text-success">OK: Comando Aceptado</span>`
        : `<span class="text-danger">RECHAZADO: ${t.data.error}</span>`;
    }
    
    return `
      <tr>
        <td>${t.timestamp}</td>
        <td><span class="badge ${badgeClass}">${t.direction}</span></td>
        <td>${payloadDesc}</td>
      </tr>
    `;
  }).join('');
}

// Pintar el registro de auditoría
function renderAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;
  
  if (!checkPermission('VIEW_AUDIT_LOG')) {
    container.innerHTML = `
      <div class="access-denied-message">
        <h3>🔒 Acceso Restringido</h3>
        <p>Solo los usuarios con el rol de **Ingeniero/Supervisor** pueden inspeccionar los registros de auditoría OT/IT.</p>
      </div>
    `;
    return;
  }
  
  const logs = getLogs();
  const tableRows = logs.map(l => {
    let typeClass = 'log-info';
    if (l.type === 'WARNING') typeClass = 'log-warning';
    if (l.type === 'SECURITY_ALERT') typeClass = 'log-security';
    if (l.type === 'CONFIG_CHANGE') typeClass = 'log-config';
    if (l.type === 'OPERATION') typeClass = 'log-op';
    
    return `
      <tr class="${typeClass}">
        <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
        <td><strong>${l.type}</strong></td>
        <td><code>${l.user}</code></td>
        <td>${l.message}</td>
      </tr>
    `;
  }).join('');
  
  container.innerHTML = `
    <div class="table-actions">
      <button class="btn btn-secondary btn-sm" id="btn-clear-logs">Limpiar Auditoría</button>
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Usuario</th>
            <th>Descripción del Evento</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows.length > 0 ? tableRows : '<tr><td colspan="4" class="text-center">No hay registros de eventos.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  
  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    if (confirm('¿Está seguro de que desea limpiar todos los registros de auditoría?')) {
      clearLogs();
    }
  });
}

// Sincronizar el panel de forzado con el estado físico real
// Sincronizar el panel de forzado con el estado físico real (Deshabilitado, elementos UI eliminados)
function updateForcedSwitches(state) {
  // Ya no se dibujan estos interruptores en la nueva UI
}


// Configurar permisos de la interfaz basados en el rol activo
function applyRBACPermissions() {
  const user = getCurrentUser();
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const userRoleBadge = document.getElementById('user-role-badge');
  const userWelcome = document.getElementById('user-welcome-name');
  
  if (!user) {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    return;
  }
  
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  
  userWelcome.innerText = user.name;
  userRoleBadge.innerText = user.role;
  userRoleBadge.className = `role-badge role-${user.role.toLowerCase()}`;
  
  // UX: Filtrar roles permitidos en el dropdown basado en la Pirámide
  const roleSelect = document.getElementById('ireg-role');
  if (roleSelect) {
    for (let i = 0; i < roleSelect.options.length; i++) {
      const val = roleSelect.options[i].value;
      if (!val) continue;
      
      let allowed = false;
      if (user.role === 'Admin' && val === 'Gerente') allowed = true;
      if (user.role === 'Gerente' && val === 'Supervisor') allowed = true;
      if (user.role === 'Supervisor' && val === 'Operador') allowed = true;
      
      roleSelect.options[i].disabled = !allowed;
      if (!allowed) {
        if (!roleSelect.options[i].text.includes('(Denegado)')) {
          roleSelect.options[i].text = roleSelect.options[i].text.split(' - ')[0] + ' - (Denegado)';
        }
      }
    }
  }
  
  // 1. Mostrar/Ocultar pestañas del panel
  const tabDash  = document.getElementById('tab-header-dashboard');
  const tabAnl   = document.getElementById('tab-header-analytics');
  const tabEng   = document.getElementById('tab-header-engineer');
  const tabMgr   = document.getElementById('tab-header-manager');
  const tabSec   = document.getElementById('tab-header-security');
  const tabUsers = document.getElementById('tab-header-users');
  
  if (user.role === 'Operador') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'none';
    if(tabAnl) tabAnl.style.display = 'none';
    if(tabMgr) tabMgr.style.display = 'none';
    if(tabSec) tabSec.style.display = 'none';
    if(tabUsers) tabUsers.style.display = 'none';
    switchTab('dashboard');
  } else if (user.role === 'Gerente') {
    if(tabDash) tabDash.style.display = 'none';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'none';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'none';
    if(tabUsers) tabUsers.style.display = 'inline-block'; 
    switchTab('analytics');
  } else if (user.role === 'Supervisor' || user.role === 'Ingeniero') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'inline-block';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'inline-block';
    if(tabUsers) tabUsers.style.display = 'inline-block';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    switchTab('dashboard');
  } else if (user.role === 'Admin') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'inline-block';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'inline-block';
    if(tabUsers) tabUsers.style.display = 'inline-block';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    switchTab('users');
  }
  
  // Habilitar/Deshabilitar botones de control en el HMI
  const basicControlsEnabled = checkPermission('BASIC_CONTROL');
  document.getElementById('btn-marcha').disabled = !basicControlsEnabled;
  document.getElementById('btn-paro').disabled = !basicControlsEnabled;
  document.getElementById('btn-selec').disabled = !basicControlsEnabled;
  document.getElementById('btn-emer').disabled = !basicControlsEnabled;
  document.getElementById('btn-reset-ci').disabled = !basicControlsEnabled;
  
  // Renderizar registros de auditoría si corresponde
  renderAuditLogs();
  
  // Cargar valores de temporizadores en el panel de Ingeniero
  if (user.role === 'Ingeniero' || user.role === 'Admin') {
    const hopperInput = document.getElementById('cfg-hopper-delay');
    if (hopperInput) hopperInput.value = PLC_STATE.config.hopperOpenDelay;
    const cinta0Input = document.getElementById('cfg-cinta0-time');
    if (cinta0Input) cinta0Input.value = PLC_STATE.config.cinta0DischargeTime;
    const destInput = document.getElementById('cfg-dest-time');
    if (destInput) destInput.value = PLC_STATE.config.destDischargeTime;
    
    // Cargar n8n configs
    const n8nUrlInput = document.getElementById('cfg-n8n-url');
    if (n8nUrlInput) n8nUrlInput.value = localStorage.getItem('n8n_url') || 'http://localhost:5678/webhook/hmi-ask';
    
    const n8nAuthInput = document.getElementById('cfg-n8n-auth-type');
    if (n8nAuthInput) n8nAuthInput.value = localStorage.getItem('n8n_auth_type') || 'basic';
    
    const n8nCredInput = document.getElementById('cfg-n8n-cred');
    if (n8nCredInput) n8nCredInput.value = localStorage.getItem('n8n_cred') || 'miguelalexander.urbina@unet.edu.ve:Madagascar=94';
  }
}

// Navegación de pestañas
function switchTab(tabId) {
  const tabs = ['dashboard', 'engineer', 'analytics', 'security', 'users'];
  tabs.forEach(t => {
    const pane = document.getElementById(`tab-${t}`);
    const btn  = document.getElementById(`tab-header-${t}`);
    if (pane) {
      pane.classList.toggle('hidden', t !== tabId);
      pane.classList.toggle('tab-active', t === tabId);
    }
    if (btn) {
      btn.classList.toggle('tab-active', t === tabId);
      // Ensure the click event is attached
      if (!btn.dataset.bound) {
        btn.addEventListener('click', () => switchTab(t));
        btn.dataset.bound = 'true';
      }
    }
  });
  if (tabId === 'engineer') renderAuditLogs();
  if (tabId === 'users')    renderUsersTable();
}

// -------------------------------------------------------------
// TABLA DE USUARIOS DEL SISTEMA
// -------------------------------------------------------------
async function renderUsersTable() {
  const container = document.getElementById('users-table-container');
  if (!container) return;

  if (!checkPermission('MANAGE_USERS') && getCurrentUser()?.role !== 'Gerente') {
    container.innerHTML = `<div class="access-denied-message">
      <h3>🔒 Acceso Restringido</h3>
      <p>Solo el rol <strong>Gerente</strong> puede gestionar usuarios del sistema.</p>
    </div>`;
    return;
  }

  const users = await getAllUsers();
  const rows = users.map(u => {
    const roleClass = u.role === 'Ingeniero' ? 'log-op' : (u.role === 'Gerente' ? 'log-warning' : 'log-info');
    const lockIcon  = u.isSystem ? '🔒' : '👤';
    const createdAt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('es') : 'Sistema';
    const deleteBtn = u.isSystem
      ? `<span style="font-size:11px;color:var(--text-muted);">Sistema</span>`
      : `<button class="btn btn-secondary btn-sm" style="color:#f87171;border:1px solid rgba(239,68,68,.25);" data-del="${u.username}">Eliminar</button>`;
    return `<tr class="${roleClass}">
      <td>${lockIcon} <strong>${u.username}</strong></td>
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td style="font-size:10px;font-family:monospace;color:var(--text-secondary);">${u.algo || 'PBKDF2-SHA256'}</td>
      <td>${createdAt}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll">
      <table class="table">
        <thead><tr>
          <th>Usuario</th><th>Nombre</th><th>Rol</th><th>Algoritmo</th><th>Creado</th><th>Acción</th>
        </tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="6" class="text-center">Sin usuarios</td></tr>'}</tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar al usuario "${btn.dataset.del}"?`)) return;
      try {
        await deleteUser(btn.dataset.del);
        renderUsersTable();
      } catch(e) { alert('Error: ' + e.message); }
    });
  });
}

// -------------------------------------------------------------
// EVENT BINDINGS (INICIALIZACIÓN DE LA APLICACIÓN)
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Inicializar simulación con callback de actualización
  initSimulation(updateUI);
  initDashboard();
  initChatWidget();
  
  // Comprobar si hay sesión previa
  applyRBACPermissions();
  
  // 1. Manejo del Login
  
  // Auto-completar el formulario por defecto con admin para facilitar el acceso inicial
  document.getElementById('login-username').value = 'admin';
  document.getElementById('login-password').value = 'admin123';
  
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Login form submitted!');
    const userVal  = document.getElementById('login-username').value;
    const passVal  = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');
    errorEl.innerText = 'Autenticando...';
    try {
      console.log('Attempting login for:', userVal);
      await login(userVal, passVal);
      console.log('Login successful, applying permissions...');
      applyRBACPermissions();
    } catch(err) {
      console.error('Login error:', err);
      errorEl.innerText = '⚠️ ' + err.message;
    }
  });

  
  // 2. Manejo de Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    applyRBACPermissions();
  });

  // 3. Botones de Control HMI Seguro
  document.getElementById('btn-marcha').addEventListener('click', () => {
    sendSecureCommand('PMARCHA');
  });
  
  document.getElementById('btn-paro').addEventListener('click', () => {
    sendSecureCommand('PPARO');
  });
  
  document.getElementById('btn-selec').addEventListener('click', () => {
    sendSecureCommand('PSELEC');
  });
  
  document.getElementById('btn-emer').addEventListener('click', () => {
    sendSecureCommand('EMERGENCY');
  });
  
  document.getElementById('btn-reset-ci').addEventListener('click', () => {
    sendSecureCommand('RESET_CI');
  });
  
  // Desbloqueo del Firewall OT
  document.getElementById('btn-sec-reset').addEventListener('click', () => {
    sendSecureCommand('SECURITY_RESET');
  });

  // 4. Cambios de Configuración de Temporizadores (Ingeniero)
  const configForm = document.getElementById('config-timers-form');
  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const hopperD = parseInt(document.getElementById('cfg-hopper-delay').value);
        const cint0T = parseInt(document.getElementById('cfg-cinta0-time').value);
        const destT = parseInt(document.getElementById('cfg-dest-time').value);
        
        const response = await sendSecureCommand('UPDATE_TIMERS', {
          hopperOpenDelay: hopperD,
          cinta0DischargeTime: cint0T,
          destDischargeTime: destT
        });
        
        if (response.success) {
          alert('Temporizadores actualizados y firmados correctamente.');
        } else {
          alert('Fallo de seguridad al actualizar: ' + response.error);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  // Eventos para Ajustes n8n
  const n8nForm = document.getElementById('config-n8n-form');
  if (n8nForm) {
    n8nForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('cfg-n8n-url').value;
      const type = document.getElementById('cfg-n8n-auth-type').value;
      const cred = document.getElementById('cfg-n8n-cred').value;
      
      localStorage.setItem('n8n_url', url);
      localStorage.setItem('n8n_auth_type', type);
      localStorage.setItem('n8n_cred', cred);
      
      alert('Configuración de n8n guardada localmente.');
    });
  }
  
  // 5. Forzado manual de actuadores (Ingeniero) (ELIMINADOS DE UI)
  // 6. Inyección de fallas de velocidad (Ingeniero) (ELIMINADOS DE UI)
  
  // 7. Enlace de los botones de pestañas
  const tabButtons = ['dashboard', 'engineer', 'manager', 'security', 'users', 'analytics'];
  tabButtons.forEach(t => {
    const btn = document.getElementById(`tab-header-${t}`);
    if (btn) btn.addEventListener('click', () => switchTab(t));
  });

  // 8. GESTIÓN DE USUARIOS INTEGRADA (Pestaña Usuarios)
  // Wrapped in try-catch: these elements may not exist in simplified HTML
  try {
    const iregPass  = document.getElementById('ireg-password');
    const iregPass2 = document.getElementById('ireg-password2');
    const sFill     = document.getElementById('ireg-strength-fill');
    const sLabel    = document.getElementById('ireg-strength-label');
    const matchHint = document.getElementById('ireg-match-hint');

    if (iregPass) {
      iregPass.addEventListener('input', () => {
        const p = iregPass.value;
        let score = 0;
        if (p.length >= 6)  score++;
        if (p.length >= 10) score++;
        if (/[A-Z]/.test(p)) score++;
        if (/[0-9]/.test(p)) score++;
        if (/[^A-Za-z0-9]/.test(p)) score++;
        const pct   = (score / 5) * 100;
        const colors = ['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6'];
        const labels = ['Muy débil','Débil','Moderada','Fuerte','Muy fuerte'];
        const idx = Math.min(score, 4);
        if (sFill) { sFill.style.width = pct + '%'; sFill.style.backgroundColor = p.length ? colors[idx] : 'transparent'; }
        if (sLabel) { sLabel.textContent = p.length ? `Fortaleza: ${labels[idx]}` : 'Ingresa una contraseña'; sLabel.style.color = p.length ? colors[idx] : 'var(--text-secondary)'; }
        checkPasswordMatch();
      });
    }

    if (iregPass2) iregPass2.addEventListener('input', checkPasswordMatch);

    function checkPasswordMatch() {
      if (!iregPass || !iregPass2 || !matchHint) return;
      const p1 = iregPass.value, p2 = iregPass2.value;
      if (!p2) { matchHint.textContent = ''; return; }
      if (p1 === p2) {
        matchHint.textContent = '✔ Las contraseñas coinciden';
        matchHint.style.color = 'var(--accent-green)';
      } else {
        matchHint.textContent = '✕ Las contraseñas no coinciden';
        matchHint.style.color = '#f87171';
      }
    }

    // Toggle visibilidad de contraseña
    const togglePass = document.getElementById('ireg-toggle-pass');
    if (togglePass && iregPass) {
      togglePass.addEventListener('click', () => {
        const t = iregPass.type === 'password' ? 'text' : 'password';
        iregPass.type = t;
        togglePass.textContent = t === 'password' ? '👁' : '🙈';
      });
    }

    // Normalizar username a minúsculas
    const iregUsername = document.getElementById('ireg-username');
    if (iregUsername) {
      iregUsername.addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
      });
    }

    // Mostrar checklist solo para Operador
    const iregRoleSelect = document.getElementById('ireg-role');
    const opCapBox = document.getElementById('operador-capabilities-box');
    if (iregRoleSelect && opCapBox) {
      iregRoleSelect.addEventListener('change', (e) => {
        opCapBox.style.display = e.target.value === 'Operador' ? 'block' : 'none';
      });
    }

    // Formulario de creación de usuario con PBKDF2
    const inlineRegForm = document.getElementById('inline-register-form');
    if (inlineRegForm) {
      inlineRegForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('inline-register-error');
        const okEl  = document.getElementById('inline-register-success');
        if (errEl) errEl.innerText = ''; if (okEl) okEl.innerText = '';

        const name  = document.getElementById('ireg-fullname')?.value || '';
        const user  = document.getElementById('ireg-username')?.value || '';
        const pass  = iregPass ? iregPass.value : '';
        const pass2 = iregPass2 ? iregPass2.value : '';
        const role  = document.getElementById('ireg-role')?.value || 'Operador';

        if (pass !== pass2) { if (errEl) errEl.innerText = '⚠️ Las contraseñas no coinciden.'; return; }
        
        let capabilities = [];
        if (role === 'Operador') {
          capabilities.push('VIEW_ONLY');
          const capBasic = document.getElementById('cap-basic-control');
          const capSetpoints = document.getElementById('cap-change-setpoints');
          if (capBasic && capBasic.checked) capabilities.push('CONTROL_MANUAL');
          if (capSetpoints && capSetpoints.checked) capabilities.push('CHANGE_SETPOINTS');
        }

        const btn = document.getElementById('btn-ireg-submit');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Generando hash PBKDF2 (100k iteraciones)...'; }
        try {
          await createUser(user, pass, role, name, capabilities);
          if (okEl) okEl.innerText = `✔ Usuario "${user}" (${role}) creado con éxito.`;
          e.target.reset();
          if (opCapBox) opCapBox.style.display = 'none';
          if (sFill) sFill.style.width = '0';
          if (sLabel) sLabel.textContent = 'Ingresa una contraseña';
          if (matchHint) matchHint.textContent = '';
          renderUsersTable();
        } catch(err) {
          if (errEl) errEl.innerText = '⚠️ ' + err.message;
        } finally {
          if (btn) { btn.disabled = false; btn.innerText = '🔐 Crear Usuario (PBKDF2-SHA256)'; }
        }
      });
    }

    // Formulario simple (create-user-form) — el que realmente existe en el HTML
    const simpleForm = document.getElementById('create-user-form');
    if (simpleForm && !inlineRegForm) {
      simpleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const user = document.getElementById('ireg-user')?.value || '';
          const name = document.getElementById('ireg-name')?.value || '';
          const role = document.getElementById('ireg-role')?.value || 'Operador';
          const pass = document.getElementById('ireg-pass')?.value || '';
          await createUser(user, pass, role, name);
          alert(`✔ Usuario "${user}" (${role}) creado con éxito.`);
          e.target.reset();
          renderUsersTable();
        } catch(err) {
          alert('⚠️ ' + err.message);
        }
      });
    }

    // Exportar usuarios.json
    const btnExport = document.getElementById('btn-export-json');
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        const users = await getAllUsers();
        const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), generatedBy: 'Sistema OT — HMI Integrado (PBKDF2-SHA256)', users };
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'usuarios.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showJsonIOMsg('ok', '✔ Archivo usuarios.json descargado.');
      });
    }

    // Copiar JSON al portapapeles
    const btnCopy = document.getElementById('btn-copy-json-users');
    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const users = await getAllUsers();
        const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), users };
        try {
          await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
          showJsonIOMsg('ok', '✔ JSON copiado al portapapeles.');
          showJsonPreview(jsonData);
        } catch(e) { showJsonIOMsg('err', 'No se pudo copiar. Usa HTTPS o localhost.'); }
      });
    }

    // Importar usuarios.json
    const btnImport = document.getElementById('ireg-import-file');
    if (btnImport) {
      btnImport.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const count = importUsersJSON(text);
          showJsonIOMsg('ok', `✔ ${count} usuario(s) importados desde "${file.name}".`);
          renderUsersTable();
          showJsonPreview(JSON.parse(text));
        } catch(err) { showJsonIOMsg('err', '⚠️ ' + err.message); }
        e.target.value = '';
      });
    }

    // Cerrar preview JSON
    const btnClosePreview = document.getElementById('btn-json-preview-close');
    if (btnClosePreview) {
      btnClosePreview.addEventListener('click', () => {
        const box = document.getElementById('json-preview-box');
        if (box) box.style.display = 'none';
      });
    }

    // Botón actualizar tabla
    const btnRefresh = document.getElementById('btn-refresh-users');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => { renderUsersTable(); });
    }
  } catch(userSectionError) {
    console.warn('[HMI] Sección de gestión de usuarios no disponible:', userSectionError.message);
  }

  // ─── Helpers de la pestaña Usuarios ───
  function showJsonIOMsg(type, text) {
    const el = document.getElementById('json-io-msg');
    el.style.color = type === 'ok' ? 'var(--accent-green)' : '#f87171';
    el.textContent = text;
    setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function showJsonPreview(data) {
    const box = document.getElementById('json-preview-box');
    const content = document.getElementById('json-preview-content');
    box.style.display = 'block';
    content.innerHTML = syntaxHighlightJSON(JSON.stringify(data, null, 2));
  }

  function syntaxHighlightJSON(json) {
    return json
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
        let cls = 'jn';
        if (/^"/.test(m)) cls = /:$/.test(m) ? 'jk' : 'js';
        else if (/true|false/.test(m)) cls = 'jb';
        return `<span class="${cls}">${m}</span>`;
      });
  }
  
  // -------------------------------------------------------------
  // ATAQUES DE PRUEBA DE VULNERABILIDAD (SANDBOX DE CIBERSEGURIDAD)
  // -------------------------------------------------------------
  
  // Ataque de trama no firmada
  const btnUnsigned = document.getElementById('btn-attack-unsigned');
  if (btnUnsigned) {
    btnUnsigned.addEventListener('click', async () => {
      const payload = {
        command: 'PMARCHA',
        user: 'Hacker (Unsigned Injection)',
        timestamp: Date.now(),
        nonce: generateNonce()
      };
      const packet = { payload }; // Sin hmac
      logNetworkTraffic('SENT (ATTACK)', packet);
      await handleNetworkMessage(JSON.stringify(packet));
    });
  }
  
  // Ataque de manipulación de datos (Tampering)
  const btnTampered = document.getElementById('btn-attack-tampered');
  if (btnTampered) {
    btnTampered.addEventListener('click', async () => {
      const payload = {
        command: 'PPARO',
        user: 'Hacker (Tampering)',
        timestamp: Date.now(),
        nonce: generateNonce()
      };
      const payloadStr = JSON.stringify(payload);
      const correctHmac = await generateHMAC(payloadStr, "PlcSuperSecretKeyOT2026!");
      payload.command = 'PMARCHA';
      payload.user = 'Hacker (Tampered Payload)';
      const packet = { payload, hmac: correctHmac };
      logNetworkTraffic('SENT (ATTACK)', packet);
      await handleNetworkMessage(JSON.stringify(packet));
    });
  }
  
  // Ataque de Replay
  const btnReplay = document.getElementById('btn-attack-replay');
  if (btnReplay) {
    btnReplay.addEventListener('click', async () => {
      if (!lastValidPacket) {
        alert('Primero debes enviar un comando legítimo en el Dashboard (ej. presionar Marcha) para interceptar y registrar una trama válida en tránsito.');
        return;
      }
      logNetworkTraffic('SENT (ATTACK - REPLAY)', lastValidPacket);
      await handleNetworkMessage(JSON.stringify(lastValidPacket));
    });
  }
});


})();