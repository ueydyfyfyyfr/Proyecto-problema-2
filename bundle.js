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
let loaded = false;

// Cargar logs guardados en localStorage para persistencia.
// Solo se lee del disco una vez: el array en memoria es la fuente de verdad
// mientras dura la sesión. Deserializar 500 entradas en cada consulta era
// inasumible para un dashboard que refresca cada segundo.
function loadLogs() {
  const saved = localStorage.getItem('auditLogs');
  if (saved) {
    try {
      auditLogs = JSON.parse(saved);
    } catch (e) {
      auditLogs = [];
    }
  }
  loaded = true;
}

// Guardar logs en localStorage
function saveLogs() {
  localStorage.setItem('auditLogs', JSON.stringify(auditLogs));
}

// Agregar una entrada de auditoría
// type: 'INFO' | 'WARNING' | 'SECURITY_ALERT' | 'CONFIG_CHANGE' | 'OPERATION'
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
  if (!loaded) loadLogs();
  return auditLogs;
}

// Entradas posteriores a un instante dado. Acepta epoch en ms o fecha ISO.
function getLogsSince(since) {
  if (!loaded) loadLogs();
  const cutoff = typeof since === 'number' ? since : new Date(since).getTime();
  if (isNaN(cutoff)) return [];
  return auditLogs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
}

// Entradas de un tipo concreto ('SECURITY_ALERT', 'OPERATION', 'CONFIG_CHANGE'...)
function getLogsByType(type) {
  if (!loaded) loadLogs();
  return auditLogs.filter(l => l.type === type);
}

// Limpiar el registro de auditoría (solo accesible por Administrador / Ingeniero en simulación)
function clearLogs() {
  auditLogs = [];
  saveLogs();
  window.dispatchEvent(new CustomEvent('audit-log-updated', { detail: null }));
}

// Otra pestaña del navegador puede haber escrito en el registro: releer en ese caso
window.addEventListener('storage', (e) => {
  if (e.key === 'auditLogs') {
    loadLogs();
    window.dispatchEvent(new CustomEvent('audit-log-updated', { detail: null }));
  }
});

// Cargar logs iniciales
loadLogs();


/* === js/history-store.js === */
/**
 * history-store.js — Serie temporal de la planta (contrato TASKS.md §6.2)
 *
 * Buffer circular persistido en localStorage['plcHistory']:
 *   { t, status, batches, units, scrap, kWh, activeMotors, alarmCount }
 *
 * El módulo es autónomo a propósito: NO importa nada de plc-simulation.js.
 * Recibe la muestra ya construida (la arma app.js), de modo que la simulación
 * no dependa nunca del historial y este pueda probarse de forma aislada.
 */

const HISTORY_KEY = 'plcHistory';

// 2 000 muestras a una cada 5 s ≈ 2,8 h de historia continua (~250 KB frente
// al límite de ~5 MB de localStorage). El tope es una variable, no una
// constante: ante QuotaExceededError se reduce a la mitad (ver persistHistory).
const HISTORY_DEFAULT_MAX = 2000;

// Suelo del tope tras reducciones sucesivas: por debajo de ~10 min de historia
// el módulo deja de aportar nada y es preferible fallar de forma visible.
const HISTORY_MIN_MAX = 125;

// Escritura agrupada: una muestra cada 5 s ⇒ una escritura cada 30 s.
// Persistir en cada push multiplicaría por seis el coste de serialización
// sin ganar nada, igual que ya se decidió con flushMetrics() en la simulación.
const HISTORY_FLUSH_EVERY = 6;

let historyBuffer = [];
let historyLoaded = false;
let historyMaxSamples = HISTORY_DEFAULT_MAX;
let historyPending = 0;

// localStorage puede lanzar al accederse (iframes con cookies bloqueadas) o no
// existir fuera del navegador. El historial es prescindible: si no hay dónde
// guardarlo, el módulo sigue funcionando en memoria.
function historyStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

function toFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

// Acepta epoch en ms, Date o cadena ISO. Devuelve `fallback` si no es fecha.
function toTimestamp(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return isFinite(value) ? value : fallback;
  if (value instanceof Date) {
    const ms = value.getTime();
    return isNaN(ms) ? fallback : ms;
  }
  const parsed = new Date(value).getTime();
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Fija la forma del contrato §6.2 sobre lo que llegue. Una muestra malformada
 * que se colara aquí reaparecería más tarde como NaN en los KPIs de F3, muy
 * lejos de su origen; se normaliza en la frontera.
 * @returns {object|null} muestra saneada, o null si no es utilizable
 */
function normalizeSample(sample) {
  if (!sample || typeof sample !== 'object') return null;

  const t = toTimestamp(sample.t, NaN);
  if (isNaN(t)) return null;

  return {
    t,
    status: typeof sample.status === 'string' ? sample.status : 'DESCONOCIDO',
    batches: toFiniteNumber(sample.batches),
    units: toFiniteNumber(sample.units),
    scrap: toFiniteNumber(sample.scrap),
    kWh: toFiniteNumber(sample.kWh),
    activeMotors: toFiniteNumber(sample.activeMotors),
    alarmCount: toFiniteNumber(sample.alarmCount)
  };
}

// Descarta por el extremo antiguo hasta respetar el tope vigente.
function trimHistory() {
  const excess = historyBuffer.length - historyMaxSamples;
  if (excess > 0) historyBuffer.splice(0, excess);
}

// Carga perezosa: el array en memoria es la fuente de verdad durante la sesión,
// igual que en audit-log.js. Solo se lee de disco una vez.
function ensureHistoryLoaded() {
  if (historyLoaded) return;
  historyLoaded = true;

  const store = historyStorage();
  if (!store) return;

  try {
    const raw = store.getItem(HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    historyBuffer = parsed
      .map(normalizeSample)
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
    trimHistory();
  } catch (e) {
    console.warn('Historial ilegible, se empieza de cero:', e.message);
    historyBuffer = [];
  }
}

/**
 * Persiste el buffer completo. Ante cuota agotada reduce el tope a la mitad y
 * reintenta una vez (T-F2-1): el historial es el dato más prescindible del
 * sistema y nunca debe impedir que la planta siga operando.
 * @returns {boolean} true si la escritura llegó a disco
 */
function persistHistory() {
  historyPending = 0;

  const store = historyStorage();
  if (!store) return false;

  try {
    store.setItem(HISTORY_KEY, JSON.stringify(historyBuffer));
    return true;
  } catch (e) {
    historyMaxSamples = Math.max(HISTORY_MIN_MAX, Math.floor(historyMaxSamples / 2));
    trimHistory();
    try {
      store.setItem(HISTORY_KEY, JSON.stringify(historyBuffer));
      console.warn(`Cuota de localStorage agotada: tope de historial reducido a ${historyMaxSamples} muestras.`);
      return true;
    } catch (e2) {
      console.warn('No se pudo guardar el historial ni tras reducir el tope:', e2.message);
      return false;
    }
  }
}

// ============================================================
// API PÚBLICA (informe §5.2)
// ============================================================

/**
 * Añade una muestra al historial. Al superar el tope descarta la más antigua.
 * @param {object} sample  Muestra según el contrato §6.2
 * @returns {object|null}  La muestra normalizada que quedó almacenada
 */
function push(sample) {
  ensureHistoryLoaded();

  const entry = normalizeSample(sample);
  if (!entry) return null;

  historyBuffer.push(entry);
  trimHistory();

  historyPending++;
  if (historyPending >= HISTORY_FLUSH_EVERY) persistHistory();

  return entry;
}

/**
 * Muestras dentro de un intervalo, ambos extremos incluidos.
 * @param {number|string|Date} [from]  Sin valor: desde el principio
 * @param {number|string|Date} [to]    Sin valor: hasta el final
 */
function range(from, to) {
  ensureHistoryLoaded();

  const start = toTimestamp(from, -Infinity);
  const end = toTimestamp(to, Infinity);
  if (start > end) return [];

  return historyBuffer.filter(s => s.t >= start && s.t <= end);
}

/**
 * Reduce el historial a `n` puntos representativos, monótonos en `t`.
 *
 * Toma el ÚLTIMO elemento de cada tramo en lugar de promediar: los campos del
 * contrato son acumuladores monótonos (batches, units, scrap, kWh) y `status`
 * es una cadena. Promediar rompería la monotonía de los primeros y no tiene
 * significado para el segundo.
 */
function downsample(n) {
  ensureHistoryLoaded();

  const count = Math.floor(n);
  if (!isFinite(count) || count <= 0) return [];

  const total = historyBuffer.length;
  if (count >= total) return historyBuffer.slice();

  const out = [];
  for (let i = 0; i < count; i++) {
    const end = Math.floor(((i + 1) * total) / count);
    out.push(historyBuffer[end - 1]);
  }
  return out;
}

/** Vacía el historial y restaura el tope por defecto. */
function clear() {
  ensureHistoryLoaded();

  historyBuffer = [];
  historyPending = 0;
  historyMaxSamples = HISTORY_DEFAULT_MAX;

  const store = historyStorage();
  if (store) {
    try {
      store.removeItem(HISTORY_KEY);
    } catch (e) {
      console.warn('No se pudo borrar el historial:', e.message);
    }
  }
}

/** Bytes que ocupa el historial serializado (alimenta system.storageBytes de §6.3). */
function sizeBytes() {
  ensureHistoryLoaded();
  if (historyBuffer.length === 0) return 0;

  const raw = JSON.stringify(historyBuffer);
  try {
    if (typeof Blob !== 'undefined') return new Blob([raw]).size;
  } catch (e) { /* sin Blob: se aproxima por longitud */ }
  return raw.length;
}

/** Fuerza la escritura pendiente. Útil antes de abandonar la página. */
function flushHistory() {
  ensureHistoryLoaded();
  if (historyPending === 0) return true;
  return persistHistory();
}

/** Número de muestras almacenadas (F3 lo usa para decidir meta.degraded). */
function historyCount() {
  ensureHistoryLoaded();
  return historyBuffer.length;
}

/**
 * Fachada con nombre propio. Los consumidores deben usarla en lugar de importar
 * `push`/`range`/`clear` sueltos: build_bundle.js vuelca todos los módulos en un
 * único ámbito, donde esos nombres genéricos son fáciles de colisionar.
 */
const HistoryStore = {
  push,
  range,
  downsample,
  clear,
  sizeBytes,
  flush: flushHistory,
  count: historyCount
};

// Con escritura agrupada se pierden hasta 6 muestras al cerrar la pestaña.
// 'visibilitychange' es el único evento fiable para consolidarlas (más que
// 'beforeunload', que los navegadores móviles no garantizan).
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && historyPending > 0) {
      persistHistory();
    }
  });
}


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
    // Sin esto checkPermission() leía siempre un array vacío y el checklist
    // de capacidades del Operador no tenía ningún efecto real.
    capabilities: user.capabilities || [],
    isSystem: user.isSystem || false
  };

  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  logEvent('INFO', `Sesión iniciada correctamente.`, currentUser.name + ' (' + currentUser.role + ')');
  return currentUser;
}

function logout() {
  if (currentUser) {
    logEvent('INFO', `Sesión cerrada.`, currentUser.name + ' (' + currentUser.role + ')');
  }
  // Consolidar los acumulados antes de abandonar la sesión
  flushMetrics();
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
    case 'MANAGE_USERS':
      return R === 'Admin' || R === 'Gerente' || R === 'Supervisor';
    case 'VIEW_ANALYTICS':
      return R === 'Admin' || R === 'Gerente' || R === 'Supervisor';
    case 'USE_AI_ASSISTANT':
      return true; // Cualquier rol autenticado; el contexto se filtra por rol
    default:
      return false;
  }
}


/* === js/plc-simulation.js === */

// -------------------------------------------------------------
// INSTRUMENTACIÓN: estructura de acumuladores (contrato TASKS.md §6.1)
// -------------------------------------------------------------

// Actuadores instrumentados de forma individual (8 salidas de motor)
const MOTOR_KEYS = ['MC0', 'MC1', 'MC2', 'MC3', 'MGIzq', 'MGDer', 'MTolAb', 'MTolCe'];

// Estados contabilizados. 'SECURITY_LOCKDOWN' no pertenece a la máquina de estados
// del PLC: es un modo superpuesto que prevalece mientras el firewall OT mantiene el
// bloqueo, porque durante ese tiempo la planta está parada aunque control.status
// siga marcando otra cosa.
const STATE_KEYS = ['IDLE', 'ROTATING', 'RUNNING', 'DISCHARGING_C0', 'DISCHARGING_DEST', 'ALARM', 'EMERGENCY_LOCK', 'SECURITY_LOCKDOWN'];

// Motivos de rechazo codificados en el firewall OT
const SECURITY_REASONS = ['COMANDO_NO_FIRMADO', 'INTEGRIDAD_COMPROMETIDA', 'ATAQUE_REPLAY_DETECTADO', 'TRAMA_EXPIRADA', 'FORMATO_CORRUPTO'];

function zeroMap(keys) {
  const o = {};
  for (const k of keys) o[k] = 0;
  return o;
}

function createDefaultStats() {
  return {
    totalElapsedSeconds: 0,       // Tiempo de calendario: denominador de disponibilidad
    sessionStartedAt: Date.now(), // Marca de inicio de la sesión actual (no se restaura)

    stateTime: zeroMap(STATE_KEYS),    // Segundos acumulados en cada estado
    stateEntries: zeroMap(STATE_KEYS), // Número de entradas a cada estado

    alarmCount: { C0: 0, C1: 0, C2: 0, C3: 0 }, // Incrementado por flanco
    firstAlarmAt: null,
    lastAlarmAt: null,

    motorSeconds: zeroMap(MOTOR_KEYS), // Horas de servicio por actuador
    motorKWh: zeroMap(MOTOR_KEYS),     // Energía imputada a cada actuador
    motorCycles: zeroMap(MOTOR_KEYS),  // Arranques (flancos de subida)

    unitsTransferred: 0,                 // Partículas entregadas al destino
    batchesByDest: { 1: 0, 2: 0, 3: 0 }, // Ciclos productivos por posición
    scrapCount: 0,                       // Partículas perdidas con el destino parado

    commandCounts: {},                        // Comandos recibidos y verificados, por tipo
    rejectedCommands: {},                     // Comandos rechazados, por comando intentado
    securityEvents: zeroMap(SECURITY_REASONS),// Rechazos por tipo de ataque
    lockdownCount: 0,                         // Entradas en bloqueo del firewall OT

    hopperCycles: 0,        // Aperturas completas de la tolva (flancos de FCTolAb)
    totalDegreesRotated: 0, // Recorrido angular acumulado de MG (desgaste del reductor)

    loop: { ticks: 0, avgDtMs: 0, maxDtMs: 0, jitterMs: 0 } // Salud del bucle (no se restaura)
  };
}

// Restaura los acumulados guardados sobre la estructura por defecto. Toda clave
// ausente, no numérica o corrupta queda en su valor inicial, de modo que ampliar
// el contrato más adelante no rompe la carga de datos antiguos.
function mergeSavedStats(saved) {
  const fresh = createDefaultStats();
  if (!saved || typeof saved !== 'object') return fresh;

  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const intoMap = (target, src) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(target)) target[k] = num(src[k]);
  };

  fresh.totalElapsedSeconds = num(saved.totalElapsedSeconds);
  fresh.unitsTransferred = num(saved.unitsTransferred);
  fresh.scrapCount = num(saved.scrapCount);
  fresh.lockdownCount = num(saved.lockdownCount);
  fresh.hopperCycles = num(saved.hopperCycles);
  fresh.totalDegreesRotated = num(saved.totalDegreesRotated);
  fresh.firstAlarmAt = typeof saved.firstAlarmAt === 'number' ? saved.firstAlarmAt : null;
  fresh.lastAlarmAt = typeof saved.lastAlarmAt === 'number' ? saved.lastAlarmAt : null;

  intoMap(fresh.stateTime, saved.stateTime);
  intoMap(fresh.stateEntries, saved.stateEntries);
  intoMap(fresh.alarmCount, saved.alarmCount);
  intoMap(fresh.motorSeconds, saved.motorSeconds);
  intoMap(fresh.motorKWh, saved.motorKWh);
  intoMap(fresh.motorCycles, saved.motorCycles);
  intoMap(fresh.batchesByDest, saved.batchesByDest);
  intoMap(fresh.securityEvents, saved.securityEvents);

  // Mapas de claves abiertas: se copia únicamente lo que sea numérico
  for (const mapName of ['commandCounts', 'rejectedCommands']) {
    const src = saved[mapName];
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) fresh[mapName][k] = num(src[k]);
    }
  }

  // 'loop' y 'sessionStartedAt' describen la sesión en curso: no se restauran.
  return fresh;
}

// Estado de la iteración anterior, para detectar flancos y transiciones
let prevMotorState = {};
let prevEffectiveState = null;

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
    runTimeSeconds: 0,        // Tiempo con al menos un motor activo (régimen activo)
    batchesProcessed: 0,      // Ciclos productivos completados (un ciclo = una descarga con material entregado)
    powerConsumptionKWh: 0,   // Consumo estimado
  },

  // Acumuladores de estadística (contrato completo en TASKS.md §6.1)
  stats: createDefaultStats(),

  // Configuración de temporizadores (ajustable por Ingeniero)
  config: {
    hopperOpenDelay: 5,       // Tiempo para abrir tolva tras M0 (segundos)
    cinta0DischargeTime: 20,  // Tiempo de vaciado Cinta 0 tras Paro (segundos)
    destDischargeTime: 20,    // Tiempo adicional de vaciado destino (segundos)
    speedSensorPulsePeriod: 100, // ms entre pulsos (10Hz)
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
    securityLockReason: '',
    cycleProducedMaterial: false // El ciclo en curso ha entregado material al destino
  }
};

// Configuración de negocio (tarifa eléctrica, factor de emisión, potencia nominal).
// Persistida en localStorage['businessConfig']; editable desde la UI a partir de F5.
const BUSINESS_CONFIG = {
  tariffUSDPerKWh: 0.15,
  co2KgPerKWh: 0.4,
  motorRatedKW: 1.5
};

function loadBusinessConfig() {
  const saved = localStorage.getItem('businessConfig');
  if (saved) {
    try {
      Object.assign(BUSINESS_CONFIG, JSON.parse(saved));
    } catch (e) {}
  }
}

// Clave secreta compartida del PLC (para autenticar comandos HMI)
var PLC_SHARED_SECRET = "PlcSuperSecretKeyOT2026!";

// Registro de Nonces recibidos para prevenir ataques de Replay (nonce → instante de recepción)
const receivedNonces = new Map();
const maxNonceAgeMs = 60000; // Rechazar comandos con timestamps mayores a 60 segundos

// Purga los nonces fuera de la ventana de validez. La ventana es exactamente la misma
// que la de validación de timestamp, así que un nonce purgado ya no puede reutilizarse:
// su trama sería rechazada por 'TRAMA_EXPIRADA'.
function purgeExpiredNonces() {
  const cutoff = Date.now() - maxNonceAgeMs;
  for (const [nonce, seenAt] of receivedNonces) {
    if (seenAt < cutoff) receivedNonces.delete(nonce);
  }
}

// Iniciar simulación física
let simInterval = null;
let flushInterval = null;

// Inicializa o reinicia la simulación
function initSimulation(onStateUpdate) {
  if (simInterval) clearInterval(simInterval);
  if (flushInterval) clearInterval(flushInterval);

  loadBusinessConfig();

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
    } catch(e) {}
  }

  // Cargar acumuladores de estadística con merge defensivo
  let parsedStats = null;
  const savedStats = localStorage.getItem('plcStats');
  if (savedStats) {
    try { parsedStats = JSON.parse(savedStats); } catch(e) {}
  }
  PLC_STATE.stats = mergeSavedStats(parsedStats);

  // Reiniciar los detectores de flanco de la sesión anterior
  prevMotorState = {};
  prevEffectiveState = null;

  // Guardado periódico de métricas (sustituye a la escritura por ciclo)
  flushInterval = setInterval(flushMetrics, 5000);

  // Bucle de simulación a 50 FPS (cada 20 ms)
  let lastTime = Date.now();
  simInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // Diferencial de tiempo en segundos
    lastTime = now;

    // La estadística se actualiza antes que nada y aislada del control: ninguna
    // salida temprana de la lógica del PLC debe hacerle perder tiempo, y ningún
    // fallo suyo puede llegar a detener la planta.
    try {
      updateStats(dt);
    } catch (e) {
      console.warn('Fallo al acumular estadística (el control continúa):', e.message);
    }

    updatePhysics(dt);
    updatePLCLogic(dt);
    
    if (onStateUpdate) onStateUpdate(PLC_STATE);
  }, 20);
}

// Estado atribuible a efectos de estadística. El bloqueo del firewall OT prevalece
// sobre la máquina de estados: mientras dura, la planta está parada aunque
// control.status conserve el valor que tuviera al producirse la intrusión.
function effectiveState() {
  return PLC_STATE.control.securityLockdown ? 'SECURITY_LOCKDOWN' : PLC_STATE.control.status;
}

// Acumuladores que deben avanzar en cada ciclo pase lo que pase en la lógica de control.
function updateStats(dt) {
  const s = PLC_STATE.stats;

  // Tiempo de calendario: avanza siempre, haya o no motores activos
  s.totalElapsedSeconds += dt;

  // Tiempo por estado y detección de transición
  const state = effectiveState();
  if (s.stateTime[state] === undefined) s.stateTime[state] = 0;
  s.stateTime[state] += dt;

  if (state !== prevEffectiveState) {
    s.stateEntries[state] = (s.stateEntries[state] || 0) + 1;
    window.dispatchEvent(new CustomEvent('plc-state-change', {
      detail: { from: prevEffectiveState, to: state, at: Date.now() }
    }));
    prevEffectiveState = state;
  }

  // Salud del bucle: media móvil exponencial de dt y desviación respecto a los 20 ms
  // nominales. Solo es representativa con la pestaña en primer plano: en segundo
  // plano el navegador estrangula setInterval y dt se dispara.
  const dtMs = dt * 1000;
  s.loop.ticks++;
  s.loop.avgDtMs = s.loop.ticks === 1 ? dtMs : s.loop.avgDtMs + (dtMs - s.loop.avgDtMs) * 0.05;
  s.loop.jitterMs = Math.abs(s.loop.avgDtMs - 20);
  if (dtMs > s.loop.maxDtMs) s.loop.maxDtMs = dtMs;
}

// Simulación de la física del sistema (movimiento real, tolva, material)
function updatePhysics(dt) {
  const angleBefore = PLC_STATE.physical.currentAngle;
  const hopperFullyOpenBefore = PLC_STATE.inputs.FCTolAb;

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

  // Recorrido angular acumulado del motor de giro (base del desgaste del reductor)
  PLC_STATE.stats.totalDegreesRotated += Math.abs(PLC_STATE.physical.currentAngle - angleBefore);

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

  // Flanco de apertura completa: un ciclo de tolva
  if (!hopperFullyOpenBefore && PLC_STATE.inputs.FCTolAb) {
    PLC_STATE.stats.hopperCycles++;
  }

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
          // Unidad física entregada. El lote (evento de negocio) se contabiliza
          // al cerrar el ciclo productivo, no aquí.
          PLC_STATE.stats.unitsTransferred++;
          PLC_STATE.control.cycleProducedMaterial = true;
        } else {
          // La cinta de destino está parada: el material cae al vacío y se pierde
          PLC_STATE.stats.scrapCount++;
        }
        return false; // Remover de Cinta 0
      }
      return true;
    });
  }
  
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
  // Un único recorrido por los 8 actuadores alimenta a la vez el desglose por motor
  // y el total de planta, de modo que la suma de motorKWh cuadra con
  // powerConsumptionKWh por construcción y no por coincidencia.
  let activeMotorsCount = 0;
  let instantKW = 0;

  for (const key of MOTOR_KEYS) {
    const isOn = !!PLC_STATE.outputs[key];

    if (isOn) {
      activeMotorsCount++;
      instantKW += BUSINESS_CONFIG.motorRatedKW;
      PLC_STATE.stats.motorSeconds[key] += dt;
      PLC_STATE.stats.motorKWh[key] += (BUSINESS_CONFIG.motorRatedKW * dt) / 3600;
    }

    // Flanco de subida: un arranque del actuador
    if (isOn && !prevMotorState[key]) {
      PLC_STATE.stats.motorCycles[key]++;
    }
    prevMotorState[key] = isOn;
  }

  if (activeMotorsCount > 0) {
    PLC_STATE.physical.runTimeSeconds += dt;
    PLC_STATE.physical.powerConsumptionKWh += (instantKW * dt) / 3600;
  }
  // La persistencia NO se hace aquí: ver flushMetrics(), invocado cada 5 s
  // y en eventos clave. Escribir en localStorage a 50 Hz degradaba la UI.
}

// Persiste los acumulados en localStorage. Invocada por temporizador cada 5 s y
// en eventos clave: cierre de ciclo, alarma, bloqueo de seguridad y cierre de sesión.
function flushMetrics() {
  try {
    localStorage.setItem('plcMetrics', JSON.stringify({
      runTimeSeconds: PLC_STATE.physical.runTimeSeconds,
      batchesProcessed: PLC_STATE.physical.batchesProcessed,
      powerConsumptionKWh: PLC_STATE.physical.powerConsumptionKWh
    }));
    localStorage.setItem('plcStats', JSON.stringify(PLC_STATE.stats));
  } catch (e) {
    console.warn('No se pudieron guardar las métricas:', e.message);
  }
}

// Cierra el ciclo productivo en curso. Cuenta el lote solo si llegó a entregarse
// material a la cinta de destino; un ciclo abortado en vacío no suma.
function finishProductionCycle(destPosition) {
  if (PLC_STATE.control.cycleProducedMaterial) {
    PLC_STATE.physical.batchesProcessed++;
    PLC_STATE.stats.batchesByDest[destPosition] = (PLC_STATE.stats.batchesByDest[destPosition] || 0) + 1;
    PLC_STATE.control.cycleProducedMaterial = false;
  }
  flushMetrics();
}

// Descarta el ciclo en curso sin contabilizarlo (acuse de alarma, retorno a CI).
function discardProductionCycle() {
  PLC_STATE.control.cycleProducedMaterial = false;
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
  // Ignoramos durante los primeros 3 segundos de arranque.
  // 'ALARM' queda excluido: la planta ya está detenida y reevaluar allí permitía
  // que un motor forzado sobre un sensor en falla disparase la alarma cada 20 ms.
  if (PLC_STATE.control.status !== 'IDLE' && PLC_STATE.control.status !== 'ROTATING' && PLC_STATE.control.status !== 'ALARM' && PLC_STATE.control.status !== 'EMERGENCY_LOCK') {
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
        finishProductionCycle(activeDest);
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
  // Idempotente: si la alarma de esa cinta ya está activa no se repite el evento.
  // Sin esto, el contador de alarmas y el MTBF/MTTR quedarían falseados.
  if (PLC_STATE.control.alarms[beltKey]) return;

  PLC_STATE.control.status = 'ALARM';
  PLC_STATE.control.alarms[beltKey] = true;

  // Contabilización por flanco: base de MTBF, MTTR y "alarmas por cinta"
  const alarmAt = Date.now();
  PLC_STATE.stats.alarmCount[beltKey] = (PLC_STATE.stats.alarmCount[beltKey] || 0) + 1;
  if (PLC_STATE.stats.firstAlarmAt === null) PLC_STATE.stats.firstAlarmAt = alarmAt;
  PLC_STATE.stats.lastAlarmAt = alarmAt;
  window.dispatchEvent(new CustomEvent('plc-alarm', {
    detail: { belt: beltKey, message: msg, at: alarmAt }
  }));
  
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
  flushMetrics();
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
  // El ciclo se interrumpió por alarma o retorno a CI: no se contabiliza como lote
  discardProductionCycle();
  flushMetrics();
  logEvent('INFO', 'Alarma acusada y reseteada por operador. Sistema en REPOSO.', 'PLC');
}

// -------------------------------------------------------------
// CONTROLADOR DE RED DEL PLC (Validación de Comandos Firmados)
// -------------------------------------------------------------

async function handleNetworkMessage(encryptedOrSignedMessageStr) {
  try {
    // Descartar los nonces que ya han salido de la ventana de validez
    purgeExpiredNonces();

    const packet = JSON.parse(encryptedOrSignedMessageStr);

    // Verificación de integridad: el paquete debe tener payload y hmac
    if (!packet.payload || !packet.hmac) {
      triggerSecurityLockdown('COMANDO_NO_FIRMADO', 'Se recibió un comando sin firma digital HMAC. Posible manipulación de red.', packet.payload && packet.payload.command);
      return { success: false, error: 'Comando no firmado' };
    }
    
    const payloadStr = JSON.stringify(packet.payload);
    
    // 1. Validar HMAC con la clave secreta
    const isValidHMAC = await verifyHMAC(payloadStr, packet.hmac, PLC_SHARED_SECRET);
    if (!isValidHMAC) {
      triggerSecurityLockdown('INTEGRIDAD_COMPROMETIDA', `Firma HMAC inválida. Se intentó ejecutar: ${packet.payload.command || 'unknown'}.`, packet.payload.command);
      return { success: false, error: 'Firma digital no coincide (Tampering bloqueado)' };
    }
    
    // 2. Validar Nonce para evitar ataques de Replay
    const nonce = packet.payload.nonce;
    if (receivedNonces.has(nonce)) {
      triggerSecurityLockdown('ATAQUE_REPLAY_DETECTADO', `Ataque de Replay: Nonce '${nonce}' ya fue procesado previamente.`, packet.payload.command);
      return { success: false, error: 'Replay Attack detectado y bloqueado' };
    }
    
    // 3. Validar Timestamp para evitar que tramas extremadamente antiguas sean enviadas
    const timestamp = packet.payload.timestamp;
    const now = Date.now();
    if (Math.abs(now - timestamp) > maxNonceAgeMs) {
      triggerSecurityLockdown('TRAMA_EXPIRADA', `Trama expirada por retardo temporal: Delta de ${Math.abs(now - timestamp)}ms.`, packet.payload.command);
      return { success: false, error: 'Comando expirado por tiempo' };
    }
    
    // Registrar el Nonce como utilizado, con el instante de recepción para poder purgarlo
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
  
  // Cuenta comandos RECIBIDOS y verificados, no comandos con efecto: un PMARCHA
  // enviado fuera de IDLE se contabiliza aunque la máquina de estados lo ignore.
  PLC_STATE.stats.commandCounts[command] = (PLC_STATE.stats.commandCounts[command] || 0) + 1;

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
        // El ciclo se aborta, pero si llegó a entregar material cuenta como lote
        finishProductionCycle(PLC_STATE.physical.targetPosition);
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
function triggerSecurityLockdown(reason, detailMsg, attemptedCommand) {
  // El contador de lockdowns cuenta ENTRADAS en bloqueo, no rechazos: los intentos
  // sucesivos con el firewall ya cerrado suman en securityEvents, no aquí.
  if (!PLC_STATE.control.securityLockdown) {
    PLC_STATE.stats.lockdownCount++;
  }
  PLC_STATE.stats.securityEvents[reason] = (PLC_STATE.stats.securityEvents[reason] || 0) + 1;

  const rejectedKey = attemptedCommand || 'DESCONOCIDO';
  PLC_STATE.stats.rejectedCommands[rejectedKey] = (PLC_STATE.stats.rejectedCommands[rejectedKey] || 0) + 1;

  PLC_STATE.control.securityLockdown = true;
  PLC_STATE.control.securityLockReason = reason;
  stopAllMotors();

  const at = Date.now();
  logEvent('SECURITY_ALERT', `ALERTA DE SEGURIDAD OT: ${detailMsg}`, 'PLC_FIREWALL', { reason, detailMsg });
  window.dispatchEvent(new CustomEvent('plc-lockdown', {
    detail: { reason, message: detailMsg, command: rejectedKey, at }
  }));
  flushMetrics();
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
// RENDERIZADOR DEL PROCESO FÍSICO EN CANVAS 2D — PREMIUM HMI
// -------------------------------------------------------------

// Utilidades de dibujo
function createMetalGradient(ctx, x, y, w, h, baseColor, highlightColor) {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, highlightColor);
  grad.addColorStop(0.3, baseColor);
  grad.addColorStop(0.7, baseColor);
  grad.addColorStop(1, highlightColor);
  return grad;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawConveyorSystem(canvas, state) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  
  // === FONDO INDUSTRIAL PREMIUM ===
  // Gradiente oscuro profundo
  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
  bgGrad.addColorStop(0, '#1a1a2e');
  bgGrad.addColorStop(1, '#0a0a14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  
  // Rejilla de fondo premium (puntos en lugar de líneas)
  const gridSize = 30;
  ctx.fillStyle = 'rgba(100, 120, 180, 0.08)';
  for (let x = gridSize; x < W; x += gridSize) {
    for (let y = gridSize; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Líneas de guía sutiles (ejes principales)
  ctx.strokeStyle = 'rgba(100, 120, 180, 0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2 + 50); ctx.lineTo(W, H / 2 + 50);
  ctx.stroke();
  ctx.setLineDash([]);
  
  const centerX = W / 2;
  const centerY = H / 2 + 50;
  
  // === 1. CINTAS DE DESTINO (C1, C2, C3) ===
  const beltLength = 170;
  const beltThickness = 28;
  
  // Cinta 1 (Izquierda)
  drawPremiumBelt(ctx, centerX - beltLength - 65, centerY - beltThickness / 2, beltLength, beltThickness, 'LEFT', state.outputs.MC1, state, 'C1');
  
  // Cinta 3 (Derecha)
  drawPremiumBelt(ctx, centerX + 65, centerY - beltThickness / 2, beltLength, beltThickness, 'RIGHT', state.outputs.MC3, state, 'C3');
  
  // Cinta 2 (Abajo)
  drawPremiumBelt(ctx, centerX - beltThickness / 2, centerY + 65, beltThickness, beltLength, 'DOWN', state.outputs.MC2, state, 'C2');
  
  // === 2. PLATAFORMA GIRATORIA (MG) — Efecto 3D ===
  ctx.save();
  ctx.translate(centerX, centerY);
  
  // Sombra exterior
  ctx.beginPath();
  ctx.arc(0, 5, 78, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  
  // Anillo exterior metálico
  const outerRingGrad = ctx.createRadialGradient(0, 0, 60, 0, 0, 82);
  outerRingGrad.addColorStop(0, '#3a3a50');
  outerRingGrad.addColorStop(0.5, '#52526e');
  outerRingGrad.addColorStop(1, '#2a2a3e');
  ctx.beginPath();
  ctx.arc(0, 0, 80, 0, Math.PI * 2);
  ctx.fillStyle = outerRingGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Base de la plataforma (gradiente metálico)
  const platformGrad = ctx.createRadialGradient(-15, -15, 0, 0, 0, 70);
  platformGrad.addColorStop(0, '#5a5a7a');
  platformGrad.addColorStop(0.5, '#3e3e58');
  platformGrad.addColorStop(1, '#2a2a42');
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.fillStyle = platformGrad;
  ctx.fill();
  
  // Borde interior iluminado
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Anillo de tornillos decorativos
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const bx = Math.cos(angle) * 74;
    const by = Math.sin(angle) * 74;
    ctx.beginPath();
    ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#6a6a88';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  
  // Anillo dentado animado
  const gearAnimAngle = (Date.now() / 2000) * Math.PI * 2;
  ctx.save();
  ctx.rotate(state.outputs.MG ? gearAnimAngle : 0);
  ctx.beginPath();
  ctx.arc(0, 0, 67, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(160, 170, 200, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  
  // LED de estado del motor MG (centro)
  const mgLedColor = state.outputs.MG ? '#10b981' : '#f43f5e';
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  const ledGrad = ctx.createRadialGradient(0, -2, 0, 0, 0, 6);
  ledGrad.addColorStop(0, state.outputs.MG ? '#6ee7b7' : '#fda4af');
  ledGrad.addColorStop(1, mgLedColor);
  ctx.fillStyle = ledGrad;
  ctx.fill();
  // Resplandor del LED
  if (state.outputs.MG) {
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.fill();
  }
  
  // Rotar para Cinta 0
  const angleRad = (state.physical.currentAngle * Math.PI) / 180;
  ctx.rotate(angleRad);
  
  // Cinta 0 sobre la plataforma
  const c0Length = 115;
  const c0Thick = 22;
  
  // Sombra de la cinta
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(-c0Length / 2 + 2, -c0Thick / 2 + 2, c0Length, c0Thick);
  
  // Cuerpo de la cinta con gradiente metálico
  const c0Grad = createMetalGradient(ctx, 0, -c0Thick / 2, c0Length, c0Thick, '#2a2a42', '#3e3e58');
  ctx.fillStyle = c0Grad;
  ctx.fillRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
  
  // Borde de la cinta (color según estado)
  const c0BorderColor = state.outputs.MC0 ? '#10b981' : '#f43f5e';
  ctx.strokeStyle = c0BorderColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
  
  // Resplandor sutil de la cinta si activa
  if (state.outputs.MC0) {
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 8;
    ctx.strokeRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
    ctx.shadowBlur = 0;
  }
  
  // Rodillos metálicos 3D
  [-c0Length / 2 + 12, c0Length / 2 - 12].forEach(rx => {
    const rollerGrad = ctx.createRadialGradient(rx - 2, -2, 0, rx, 0, 9);
    rollerGrad.addColorStop(0, '#8888aa');
    rollerGrad.addColorStop(1, '#2a2a42');
    ctx.beginPath();
    ctx.arc(rx, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = rollerGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Eje del rodillo
    ctx.beginPath();
    ctx.arc(rx, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
  });
  
  // Patrón animado de banda rodante
  if (state.outputs.MC0 && state.control.status !== 'ALARM') {
    const shift = (Date.now() / 6) % 15;
    ctx.strokeStyle = 'rgba(150, 160, 200, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let lx = -c0Length / 2 + 18 + shift; lx < c0Length / 2 - 18; lx += 15) {
      ctx.moveTo(lx, -c0Thick / 2 + 1);
      ctx.lineTo(lx - 4, c0Thick / 2 - 1);
    }
    ctx.stroke();
  }
  
  // Flecha de dirección de flujo
  ctx.fillStyle = 'rgba(150, 170, 220, 0.5)';
  ctx.beginPath();
  ctx.moveTo(18, -5);
  ctx.lineTo(30, 0);
  ctx.lineTo(18, 5);
  ctx.fill();
  
  ctx.restore();
  
  // === 3. FINALES DE CARRERA (FC1, FC2, FC3) ===
  drawPremiumLimitSwitch(ctx, centerX - 85, centerY, 'FC1', state.inputs.FC1);
  drawPremiumLimitSwitch(ctx, centerX, centerY + 85, 'FC2', state.inputs.FC2);
  drawPremiumLimitSwitch(ctx, centerX + 85, centerY, 'FC3', state.inputs.FC3);
  
  // === 4. TOLVA DE ALIMENTACIÓN — Efecto 3D Premium ===
  const hopperTopY = 20;
  const hopperHeight = 90;
  const hopperWidthTop = 150;
  const hopperWidthBot = 45;
  
  // Sombra de la tolva
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2 + 4, hopperTopY + 4);
  ctx.lineTo(centerX + hopperWidthTop / 2 + 4, hopperTopY + 4);
  ctx.lineTo(centerX + hopperWidthBot / 2 + 4, hopperTopY + hopperHeight + 4);
  ctx.lineTo(centerX - hopperWidthBot / 2 + 4, hopperTopY + hopperHeight + 4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();
  
  // Cuerpo de la tolva con gradiente metálico
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2, hopperTopY);
  ctx.lineTo(centerX + hopperWidthTop / 2, hopperTopY);
  ctx.lineTo(centerX + hopperWidthBot / 2, hopperTopY + hopperHeight);
  ctx.lineTo(centerX - hopperWidthBot / 2, hopperTopY + hopperHeight);
  ctx.closePath();
  
  const hopperGrad = ctx.createLinearGradient(centerX - hopperWidthTop / 2, hopperTopY, centerX + hopperWidthTop / 2, hopperTopY);
  hopperGrad.addColorStop(0, '#7c4a1e');
  hopperGrad.addColorStop(0.2, '#c2711e');
  hopperGrad.addColorStop(0.5, '#e8922a');
  hopperGrad.addColorStop(0.8, '#c2711e');
  hopperGrad.addColorStop(1, '#7c4a1e');
  ctx.fillStyle = hopperGrad;
  ctx.fill();
  
  // Borde de la tolva
  ctx.strokeStyle = '#5c3310';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Reflejo superior (brillo metálico)
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2 + 10, hopperTopY + 3);
  ctx.lineTo(centerX + hopperWidthTop / 2 - 10, hopperTopY + 3);
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Remaches decorativos en la tolva
  const remachePositions = [
    [centerX - hopperWidthTop / 2 + 12, hopperTopY + 10],
    [centerX + hopperWidthTop / 2 - 12, hopperTopY + 10],
    [centerX - hopperWidthTop / 2 + 20, hopperTopY + 25],
    [centerX + hopperWidthTop / 2 - 20, hopperTopY + 25],
    [centerX - 30, hopperTopY + hopperHeight - 8],
    [centerX + 30, hopperTopY + hopperHeight - 8],
  ];
  remachePositions.forEach(([rx, ry]) => {
    ctx.beginPath();
    ctx.arc(rx, ry, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#8a5a28';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Brillo del remache
    ctx.beginPath();
    ctx.arc(rx - 0.8, ry - 0.8, 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 220, 150, 0.4)';
    ctx.fill();
  });
  
  // Material dentro de la tolva
  if (state.physical.hopperOpenPercent < 100 || state.control.status !== 'IDLE') {
    ctx.beginPath();
    ctx.moveTo(centerX - 55, hopperTopY + 28);
    ctx.lineTo(centerX + 55, hopperTopY + 28);
    ctx.lineTo(centerX + hopperWidthBot / 2 - 2, hopperTopY + hopperHeight - 2);
    ctx.lineTo(centerX - hopperWidthBot / 2 + 2, hopperTopY + hopperHeight - 2);
    ctx.closePath();
    const matGrad = ctx.createLinearGradient(centerX, hopperTopY + 28, centerX, hopperTopY + hopperHeight);
    matGrad.addColorStop(0, '#a0522d');
    matGrad.addColorStop(0.5, '#8b4513');
    matGrad.addColorStop(1, '#6b3410');
    ctx.fillStyle = matGrad;
    ctx.fill();
  }
  
  // Compuerta de la tolva (deslizante metálica)
  const gateOpenOffset = (state.physical.hopperOpenPercent / 100) * 28;
  const gateX = centerX - 22 + gateOpenOffset;
  const gateY = hopperTopY + hopperHeight;
  const gateGrad = createMetalGradient(ctx, gateX, gateY, 44, 8, '#4a4a60', '#6a6a80');
  ctx.fillStyle = gateGrad;
  ctx.fillRect(gateX, gateY, 44, 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(gateX, gateY, 44, 8);
  
  // FCTolCe y FCTolAb
  drawPremiumLimitSwitch(ctx, centerX - 40, hopperTopY + hopperHeight + 4, 'FCTolCe', state.inputs.FCTolCe);
  drawPremiumLimitSwitch(ctx, centerX + 30, hopperTopY + hopperHeight + 4, 'FCTolAb', state.inputs.FCTolAb);
  
  // Caída de material (partículas animadas realistas)
  if (state.physical.hopperOpenPercent > 10 && state.outputs.MC0) {
    const time = Date.now();
    for (let i = 0; i < 8; i++) {
      const seed = (time / 50 + i * 137) % 1000;
      const px = centerX - 8 + (Math.sin(seed) * 0.5 + 0.5) * 16;
      const py = hopperTopY + hopperHeight + 8 + ((seed % 100) / 100) * (centerY - (hopperTopY + hopperHeight) - 25);
      const size = 2 + (Math.sin(seed * 3.7) * 0.5 + 0.5) * 4;
      
      const particleGrad = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, size);
      particleGrad.addColorStop(0, '#f97316');
      particleGrad.addColorStop(1, '#c2410c');
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = particleGrad;
      ctx.fill();
    }
  }
  
  // === 5. PARTÍCULAS DE MATERIAL EN CINTAS ===
  // Partículas en Cinta 0
  state.physical.materialOnCinta0.forEach(p => {
    const c0Len = 115;
    const startX = -c0Len / 2 + 12;
    const endX = c0Len / 2 - 12;
    const relX = startX + p.x * (endX - startX);
    
    const aRad = (state.physical.currentAngle * Math.PI) / 180;
    const px = centerX + relX * Math.cos(aRad) - p.y * Math.sin(aRad);
    const py = centerY + relX * Math.sin(aRad) + p.y * Math.cos(aRad);
    
    const matParticle = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, 7);
    matParticle.addColorStop(0, '#fb923c');
    matParticle.addColorStop(1, '#c2410c');
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = matParticle;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 50, 10, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  
  // Partículas en Cintas de Destino
  state.physical.materialOnDest.forEach(p => {
    let px = 0, py = 0;
    
    if (p.cinta === 1) {
      px = (centerX - 65) - p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 3) {
      px = (centerX + 65) + p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 2) {
      px = centerX + (p.y - 15);
      py = (centerY + 65) + p.x * beltLength;
    }
    
    const matParticle = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, 7);
    matParticle.addColorStop(0, '#fdba74');
    matParticle.addColorStop(1, '#ea580c');
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = matParticle;
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 60, 10, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  
  // === 6. SENSORES DE VELOCIDAD (VIGILANCIA) ===
  drawPremiumSpeedSensor(ctx, centerX, centerY - 28, 'VigC0', state.inputs.VigC0, state.outputs.MC0);
  drawPremiumSpeedSensor(ctx, centerX - 150, centerY - 32, 'VigC1', state.inputs.VigC1, state.outputs.MC1);
  drawPremiumSpeedSensor(ctx, centerX + 150, centerY - 32, 'VigC3', state.inputs.VigC3, state.outputs.MC3);
  drawPremiumSpeedSensor(ctx, centerX - 32, centerY + 150, 'VigC2', state.inputs.VigC2, state.outputs.MC2);
  
  // === 7. ETIQUETAS DE LAS CINTAS ===
  ctx.font = 'bold 11px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(150, 170, 220, 0.6)';
  ctx.fillText('← C1', centerX - beltLength / 2 - 65, centerY - 22);
  ctx.fillText('C3 →', centerX + beltLength / 2 + 65, centerY - 22);
  ctx.fillText('C2 ↓', centerX + 28, centerY + beltLength / 2 + 85);
  ctx.fillText('TOLVA', centerX, hopperTopY - 6);
  
  // === 8. ALERTA DE CIBERSEGURIDAD ===
  if (state.control.securityLockdown) {
    // Fondo de alerta con gradiente
    const alertGrad = ctx.createLinearGradient(0, 0, 0, H);
    alertGrad.addColorStop(0, 'rgba(244, 63, 94, 0.92)');
    alertGrad.addColorStop(1, 'rgba(180, 30, 50, 0.92)');
    ctx.fillStyle = alertGrad;
    ctx.fillRect(10, 10, W - 20, H - 20);
    
    // Icono y texto
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚨 ALERTA DE SEGURIDAD INDUSTRIAL OT 🚨', W / 2, H / 2 - 45);
    
    ctx.font = '600 16px "Inter", monospace';
    ctx.fillText('PLC LOCKDOWN ACTIVO — Comando Rechazado', W / 2, H / 2);
    
    ctx.font = '14px "Inter", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`Causa: ${state.control.securityLockReason}`, W / 2, H / 2 + 28);
    ctx.fillText('Desbloqueo requerido por Supervisor', W / 2, H / 2 + 52);
  }
  
  // === 9. BARRA DE ESTADO INFERIOR ===
  const barY = H - 32;
  ctx.fillStyle = 'rgba(10, 10, 20, 0.7)';
  ctx.fillRect(0, barY, W, 32);
  ctx.strokeStyle = 'rgba(100, 120, 180, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barY); ctx.lineTo(W, barY);
  ctx.stroke();
  
  ctx.font = '11px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(160, 175, 210, 0.7)';
  ctx.fillText(`Física: 4 Cintas, Plataforma Giratoria y Tolva de Alimentación`, 16, barY + 20);
  ctx.textAlign = 'right';
  ctx.fillText(`Modo: Simulación de Planta Ciberfísica ${Math.round(1000/20)} FPS`, W - 16, barY + 20);
  
  // LED de estado del sistema en la barra
  const sysLedColor = state.control.status === 'ALARM' ? '#f43f5e' : 
                       state.control.status === 'RUNNING' ? '#10b981' : '#f59e0b';
  ctx.beginPath();
  ctx.arc(W / 2, barY + 16, 4, 0, Math.PI * 2);
  ctx.fillStyle = sysLedColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, barY + 16, 8, 0, Math.PI * 2);
  ctx.fillStyle = sysLedColor.replace(')', ', 0.2)').replace('rgb', 'rgba');
  ctx.fill();
  
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200, 210, 240, 0.6)';
  ctx.font = '10px "Inter", sans-serif';
  ctx.fillText(state.control.status, W / 2 + 16, barY + 20);
}

// === CINTA TRANSPORTADORA PREMIUM ===
function drawPremiumBelt(ctx, x, y, w, h, dir, isRunning, state, label) {
  const isHorizontal = (dir === 'LEFT' || dir === 'RIGHT');
  
  // Sombra
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  if (isHorizontal) {
    ctx.fillRect(x + 3, y + 3, w, h);
  } else {
    ctx.fillRect(x + 3, y + 3, w, h);
  }
  
  // Cuerpo de la cinta (gradiente metálico)
  const beltGrad = isHorizontal 
    ? createMetalGradient(ctx, x, y, w, h, '#1a1a2e', '#2a2a42')
    : ctx.createLinearGradient(x, y, x + w, y);
  if (!isHorizontal) {
    beltGrad.addColorStop(0, '#2a2a42');
    beltGrad.addColorStop(0.3, '#1a1a2e');
    beltGrad.addColorStop(0.7, '#1a1a2e');
    beltGrad.addColorStop(1, '#2a2a42');
  }
  ctx.fillStyle = beltGrad;
  ctx.fillRect(x, y, w, h);
  
  // Borde con color de estado
  const borderColor = isRunning ? '#10b981' : '#4a4a60';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
  
  // Resplandor si activa
  if (isRunning) {
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 6;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;
  }
  
  // Rodillos metálicos 3D
  ctx.save();
  if (isHorizontal) {
    [x + 12, x + w - 12].forEach(rx => {
      const rollerGrad = ctx.createRadialGradient(rx - 2, y + h / 2 - 2, 0, rx, y + h / 2, 9);
      rollerGrad.addColorStop(0, '#7a7a9a');
      rollerGrad.addColorStop(1, '#2a2a42');
      ctx.beginPath();
      ctx.arc(rx, y + h / 2, 9, 0, Math.PI * 2);
      ctx.fillStyle = rollerGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, y + h / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    });
  } else {
    [y + 12, y + h - 12].forEach(ry => {
      const rollerGrad = ctx.createRadialGradient(x + w / 2 - 2, ry - 2, 0, x + w / 2, ry, 9);
      rollerGrad.addColorStop(0, '#7a7a9a');
      rollerGrad.addColorStop(1, '#2a2a42');
      ctx.beginPath();
      ctx.arc(x + w / 2, ry, 9, 0, Math.PI * 2);
      ctx.fillStyle = rollerGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w / 2, ry, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    });
  }
  ctx.restore();
  
  // Patrón animado de bandas
  if (isRunning && state.control.status !== 'ALARM') {
    const shift = (Date.now() / 5) % 15;
    ctx.strokeStyle = 'rgba(150, 160, 200, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    if (dir === 'LEFT') {
      for (let lx = x + w - 18 - shift; lx > x + 18; lx -= 15) {
        ctx.moveTo(lx, y + 1);
        ctx.lineTo(lx - 4, y + h - 1);
      }
    } else if (dir === 'RIGHT') {
      for (let lx = x + 18 + shift; lx < x + w - 18; lx += 15) {
        ctx.moveTo(lx, y + 1);
        ctx.lineTo(lx - 4, y + h - 1);
      }
    } else if (dir === 'DOWN') {
      for (let ly = y + 18 + shift; ly < y + h - 18; ly += 15) {
        ctx.moveTo(x + 1, ly);
        ctx.lineTo(x + w - 1, ly - 4);
      }
    }
    ctx.stroke();
  }
  
  // Etiqueta de la cinta
  ctx.font = 'bold 10px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = isRunning ? 'rgba(16, 185, 129, 0.8)' : 'rgba(160, 170, 200, 0.4)';
  if (isHorizontal) {
    ctx.fillText(label, x + w / 2, y - 6);
  } else {
    ctx.fillText(label, x - 14, y + h / 2 + 4);
  }
}

// === FINAL DE CARRERA PREMIUM ===
function drawPremiumLimitSwitch(ctx, x, y, name, isActive) {
  // Carcasa del switch con gradiente
  drawRoundedRect(ctx, x - 8, y - 8, 16, 16, 3);
  const swGrad = createMetalGradient(ctx, x - 8, y - 8, 16, 16, '#2a2a42', '#3e3e58');
  ctx.fillStyle = swGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // LED del switch con resplandor
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  const swLedColor = isActive ? '#10b981' : '#4a4a60';
  const swLedGrad = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
  swLedGrad.addColorStop(0, isActive ? '#6ee7b7' : '#5a5a70');
  swLedGrad.addColorStop(1, swLedColor);
  ctx.fillStyle = swLedGrad;
  ctx.fill();
  
  // Resplandor exterior
  if (isActive) {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.fill();
  }
  
  // Etiqueta
  ctx.fillStyle = isActive ? 'rgba(110, 231, 183, 0.9)' : 'rgba(160, 170, 200, 0.5)';
  ctx.font = '8px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y - 12);
}

// === SENSOR DE VELOCIDAD PREMIUM ===
function drawPremiumSpeedSensor(ctx, x, y, name, isOk, motorRunning) {
  // Carcasa con efecto 3D
  drawRoundedRect(ctx, x - 22, y - 12, 44, 20, 4);
  const sGrad = createMetalGradient(ctx, x - 22, y - 12, 44, 20, '#1a1a2e', '#2e2e48');
  ctx.fillStyle = sGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // LED de estado con resplandor
  let ledColor, ledHighlight;
  if (!isOk) {
    ledColor = '#f43f5e';
    ledHighlight = '#fda4af';
  } else if (motorRunning) {
    const pulse = Math.floor(Date.now() / 100) % 2 === 0;
    ledColor = pulse ? '#10b981' : '#047857';
    ledHighlight = pulse ? '#6ee7b7' : '#34d399';
  } else {
    ledColor = '#4a4a60';
    ledHighlight = '#6a6a80';
  }
  
  ctx.beginPath();
  ctx.arc(x - 10, y - 2, 5, 0, Math.PI * 2);
  const sLedGrad = ctx.createRadialGradient(x - 11, y - 3, 0, x - 10, y - 2, 5);
  sLedGrad.addColorStop(0, ledHighlight);
  sLedGrad.addColorStop(1, ledColor);
  ctx.fillStyle = sLedGrad;
  ctx.fill();
  
  // Resplandor exterior del LED
  if (motorRunning && isOk) {
    ctx.beginPath();
    ctx.arc(x - 10, y - 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.fill();
  }
  
  // Nombre del sensor
  ctx.fillStyle = '#c0c8e0';
  ctx.font = 'bold 8px "Space Grotesk", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(name.slice(3), x + 1, y + 2);
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

// -------------------------------------------------------------
// MUESTREO DEL HISTORIAL (contrato TASKS.md §6.2)
// -------------------------------------------------------------

const HISTORY_SAMPLE_INTERVAL_MS = 5000;
let historySampler = null;

// Arma la muestra desde PLC_STATE. Vive en app.js y no en plc-simulation.js
// para que la simulación no dependa del historial (decisión de T-F2-2).
function buildHistorySample() {
  const stats = PLC_STATE.stats;

  let activeMotors = 0;
  for (const key of MOTOR_KEYS) {
    if (PLC_STATE.outputs[key]) activeMotors++;
  }

  // 'alarmCount' del contrato es el total agregado de las cuatro cintas
  let alarmCount = 0;
  for (const key in stats.alarmCount) {
    alarmCount += stats.alarmCount[key];
  }

  return {
    t: Date.now(),
    status: effectiveState(),   // el bloqueo del firewall OT prevalece sobre control.status
    batches: PLC_STATE.physical.batchesProcessed,
    units: stats.unitsTransferred,
    scrap: stats.scrapCount,
    kWh: PLC_STATE.physical.powerConsumptionKWh,
    activeMotors,
    alarmCount
  };
}

// Temporizador propio de 5 s, deliberadamente desacoplado del bucle de 50 Hz:
// el historial no debe encarecer el ciclo de control ni depender de su cadencia.
function startHistorySampling() {
  if (historySampler) clearInterval(historySampler);
  historySampler = setInterval(() => {
    try {
      HistoryStore.push(buildHistorySample());
    } catch (e) {
      console.warn('No se pudo registrar la muestra de historial:', e.message);
    }
  }, HISTORY_SAMPLE_INTERVAL_MS);
}

// Función de actualización de la UI invocada en cada ciclo de la simulación
function updateUI(state) {
  const canvas = document.getElementById('plant-canvas');
  if (canvas) {
    drawConveyorSystem(canvas, state);
  }
  
  // Actualizar indicadores digitales y analógicos en la pantalla
  document.getElementById('state-display').innerText = state.control.status;
  document.getElementById('cinta0-angle').innerText = state.physical.currentAngle.toFixed(0) + '°';
  document.getElementById('hopper-percent').innerText = state.physical.hopperOpenPercent.toFixed(0) + '%';
  document.getElementById('active-pos-lbl').innerText = `Posición ${state.physical.targetPosition}`;
  
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
          ledEl.className = isLit ? 'led-indicator led-red' : 'led-indicator led-off';
        }
      }
    }
  }

  // Actualizar KPIs y reportes
  document.getElementById('kpi-runtime').innerText = formatTime(state.physical.runTimeSeconds);
  document.getElementById('kpi-batches').innerText = state.physical.batchesProcessed;
  document.getElementById('kpi-power').innerText = state.physical.powerConsumptionKWh.toFixed(4) + ' kWh';
  
  // Costo financiero estimado según la tarifa configurada en BUSINESS_CONFIG
  const cost = state.physical.powerConsumptionKWh * BUSINESS_CONFIG.tariffUSDPerKWh;
  document.getElementById('kpi-cost').innerText = '$' + cost.toFixed(4) + ' USD';
  
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
function updateForcedSwitches(state) {
  const switches = [
    { id: 'force-mc0', output: 'MC0' },
    { id: 'force-mc1', output: 'MC1' },
    { id: 'force-mc2', output: 'MC2' },
    { id: 'force-mc3', output: 'MC3' },
    { id: 'force-mgizq', output: 'MGIzq' },
    { id: 'force-mgder', output: 'MGDer' },
    { id: 'force-mtolab', output: 'MTolAb' },
    { id: 'force-mtolce', output: 'MTolCe' },
  ];
  
  switches.forEach(sw => {
    const el = document.getElementById(sw.id);
    if (el) {
      el.checked = state.outputs[sw.output];
    }
  });
  
  const sensors = [
    { id: 'fail-vigc0', sensor: 'VigC0' },
    { id: 'fail-vigc1', sensor: 'VigC1' },
    { id: 'fail-vigc2', sensor: 'VigC2' },
    { id: 'fail-vigc3', sensor: 'VigC3' },
  ];
  
  sensors.forEach(sn => {
    const el = document.getElementById(sn.id);
    if (el) {
      el.checked = !state.inputs[sn.sensor]; // checked = sensor está fallando
    }
  });
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
  const tabEng   = document.getElementById('tab-header-engineer');
  const tabMgr   = document.getElementById('tab-header-manager');
  const tabSec   = document.getElementById('tab-header-security');
  const tabUsers = document.getElementById('tab-header-users');
  
  if (user.role === 'Operador') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'none';
    tabMgr.style.display = 'none';
    tabSec.style.display = 'none';
    tabUsers.style.display = 'none';
    switchTab('dashboard');
  } else if (user.role === 'Gerente') {
    tabDash.style.display = 'none'; // Acceso exclusivo a métricas
    tabEng.style.display = 'none';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'none';
    tabUsers.style.display = 'inline-block'; 
    switchTab('manager');
  } else if (user.role === 'Supervisor') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'inline-block';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'inline-block';
    tabUsers.style.display = 'inline-block';
    switchTab('dashboard');
  } else if (user.role === 'Admin') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'inline-block';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'inline-block';
    tabUsers.style.display = 'inline-block';
    switchTab('users');
  }
  
  // Habilitar/Deshabilitar botones de control en el HMI
  const basicControlsEnabled = checkPermission('BASIC_CONTROL');
  document.getElementById('btn-marcha').disabled = !basicControlsEnabled;
  document.getElementById('btn-paro').disabled = !basicControlsEnabled;
  document.getElementById('btn-selec').disabled = !basicControlsEnabled;
  document.getElementById('btn-emer').disabled = !basicControlsEnabled;
  document.getElementById('btn-reset-ci').disabled = !basicControlsEnabled;

  // Explicar por qué los mandos están bloqueados. Admin y Gerente no operan la
  // planta por separación de funciones OT: sin este aviso los botones quedaban
  // inertes sin explicación alguna.
  const ctrlHint = document.getElementById('control-permission-hint');
  if (ctrlHint) {
    if (basicControlsEnabled) {
      ctrlHint.style.display = 'none';
    } else {
      ctrlHint.style.display = 'block';
      ctrlHint.innerHTML = user.role === 'Operador'
        ? '🔒 Su cuenta de Operador no tiene la capacidad <strong>Control Manual</strong>. Solicite a un Supervisor que la habilite.'
        : `🔒 El rol <strong>${user.role}</strong> no opera la planta (separación de funciones OT). Inicie sesión como <strong>Supervisor</strong> u <strong>Operador con Control Manual</strong> para usar los mandos.`;
    }
  }

  // Renderizar registros de auditoría si corresponde
  renderAuditLogs();

  // Cargar valores de temporizadores en el panel de Ingeniería
  if (user.role === 'Supervisor') {
    document.getElementById('cfg-hopper-delay').value = PLC_STATE.config.hopperOpenDelay;
    document.getElementById('cfg-cinta0-time').value = PLC_STATE.config.cinta0DischargeTime;
    document.getElementById('cfg-dest-time').value = PLC_STATE.config.destDischargeTime;
  }
}

// Navegación de pestañas
function switchTab(tabId) {
  const tabs = ['dashboard', 'engineer', 'manager', 'security', 'users'];
  tabs.forEach(t => {
    const pane = document.getElementById(`tab-${t}`);
    const btn  = document.getElementById(`tab-header-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tabId);
    if (btn)  btn.classList.toggle('tab-active', t === tabId);
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
    const roleClass = u.role === 'Supervisor' ? 'log-op' : (u.role === 'Gerente' ? 'log-warning' : 'log-info');
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

  // Poblar la serie temporal que consumirán stats-engine (F3) y el dashboard (F5)
  startHistorySampling();

  // Reflejar la tarifa realmente configurada, no un literal en el HTML
  const costSub = document.getElementById('kpi-cost-sub');
  if (costSub) {
    costSub.innerText = `Tarifa industrial ($${BUSINESS_CONFIG.tariffUSDPerKWh} / kWh)`;
  }

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
  document.getElementById('config-timers-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const hopper = document.getElementById('cfg-hopper-delay').value;
    const c0 = document.getElementById('cfg-cinta0-time').value;
    const dest = document.getElementById('cfg-dest-time').value;
    
    sendSecureCommand('CONFIG_UPDATE', {
      hopperOpenDelay: hopper,
      cinta0DischargeTime: c0,
      destDischargeTime: dest
    });
    alert('Temporizadores del PLC actualizados con éxito por firma digital.');
  });
  
  // 5. Forzado manual de actuadores (Ingeniero)
  const forceSwitches = [
    { id: 'force-mc0', output: 'MC0' },
    { id: 'force-mc1', output: 'MC1' },
    { id: 'force-mc2', output: 'MC2' },
    { id: 'force-mc3', output: 'MC3' },
    { id: 'force-mgizq', output: 'MGIzq' },
    { id: 'force-mgder', output: 'MGDer' },
    { id: 'force-mtolab', output: 'MTolAb' },
    { id: 'force-mtolce', output: 'MTolCe' },
  ];
  
  forceSwitches.forEach(sw => {
    document.getElementById(sw.id).addEventListener('change', (e) => {
      sendSecureCommand('FORCE_ACTUATOR', {
        output: sw.output,
        value: e.target.checked
      });
    });
  });
  
  // 6. Inyección de fallas de velocidad (Ingeniero)
  const failSensors = [
    { id: 'fail-vigc0', sensor: 'VigC0' },
    { id: 'fail-vigc1', sensor: 'VigC1' },
    { id: 'fail-vigc2', sensor: 'VigC2' },
    { id: 'fail-vigc3', sensor: 'VigC3' },
  ];
  
  failSensors.forEach(sn => {
    document.getElementById(sn.id).addEventListener('change', (e) => {
      sendSecureCommand('INJECT_FAULT', {
        sensor: sn.sensor,
        value: e.target.checked // true significa inyectar falla (sensor desactiva señal)
      });
    });
  });
  
  // 7. Enlace de los botones de pestañas
  const tabButtons = ['dashboard', 'engineer', 'manager', 'security', 'users'];
  tabButtons.forEach(t => {
    const btn = document.getElementById(`tab-header-${t}`);
    if (btn) btn.addEventListener('click', () => switchTab(t));
  });

  // 8. GESTIÓN DE USUARIOS INTEGRADA (Pestaña Usuarios)
  // ─── Medidor de fortaleza de contraseña ───
  const iregPass  = document.getElementById('ireg-password');
  const iregPass2 = document.getElementById('ireg-password2');
  const sFill     = document.getElementById('ireg-strength-fill');
  const sLabel    = document.getElementById('ireg-strength-label');
  const matchHint = document.getElementById('ireg-match-hint');

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
    sFill.style.width = pct + '%';
    sFill.style.backgroundColor = p.length ? colors[idx] : 'transparent';
    sLabel.textContent = p.length ? `Fortaleza: ${labels[idx]}` : 'Ingresa una contraseña';
    sLabel.style.color = p.length ? colors[idx] : 'var(--text-secondary)';
    checkPasswordMatch();
  });

  iregPass2.addEventListener('input', checkPasswordMatch);

  function checkPasswordMatch() {
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

  // ─── Toggle visibilidad de contraseña ───
  document.getElementById('ireg-toggle-pass').addEventListener('click', () => {
    const t = iregPass.type === 'password' ? 'text' : 'password';
    iregPass.type = t;
    document.getElementById('ireg-toggle-pass').textContent = t === 'password' ? '👁' : '🙈';
  });

  // ─── Normalizar username a minúsculas ───
  document.getElementById('ireg-username').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
  });

  // ─── Lógica UI: Mostrar checklist solo para Operador ───
  const iregRoleSelect = document.getElementById('ireg-role');
  const opCapBox = document.getElementById('operador-capabilities-box');
  if (iregRoleSelect && opCapBox) {
    iregRoleSelect.addEventListener('change', (e) => {
      if (e.target.value === 'Operador') {
        opCapBox.style.display = 'block';
      } else {
        opCapBox.style.display = 'none';
      }
    });
  }

  // ─── Formulario de creación de usuario con PBKDF2 ───
  document.getElementById('inline-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('inline-register-error');
    const okEl  = document.getElementById('inline-register-success');
    errEl.innerText = ''; okEl.innerText = '';

    const name  = document.getElementById('ireg-fullname').value;
    const user  = document.getElementById('ireg-username').value;
    const pass  = iregPass.value;
    const pass2 = iregPass2.value;
    const role  = document.getElementById('ireg-role').value;

    if (pass !== pass2) { errEl.innerText = '⚠️ Las contraseñas no coinciden.'; return; }
    
    let capabilities = [];
    if (role === 'Operador') {
      capabilities.push('VIEW_ONLY');
      if (document.getElementById('cap-basic-control').checked) capabilities.push('CONTROL_MANUAL');
      if (document.getElementById('cap-change-setpoints').checked) capabilities.push('CHANGE_SETPOINTS');
    }

    const btn = document.getElementById('btn-ireg-submit');
    btn.disabled = true;
    btn.innerText = '⏳ Generando hash PBKDF2 (100k iteraciones)...';
    try {
      await createUser(user, pass, role, name, capabilities);
      okEl.innerText = `✔ Usuario "${user}" (${role}) creado con éxito.`;
      e.target.reset();
      opCapBox.style.display = 'none';
      sFill.style.width = '0'; sLabel.textContent = 'Ingresa una contraseña';
      matchHint.textContent = '';
      renderUsersTable();
    } catch(err) {
      errEl.innerText = '⚠️ ' + err.message;
    } finally {
      btn.disabled = false;
      btn.innerText = '🔐 Crear Usuario (PBKDF2-SHA256)';
    }
  });

  // ─── Exportar usuarios.json ───
  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const users = await getAllUsers();
    const jsonData = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      generatedBy: 'Sistema OT — HMI Integrado (PBKDF2-SHA256)',
      users: users
    };
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'usuarios.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showJsonIOMsg('ok', '✔ Archivo usuarios.json descargado.');
  });

  // ─── Copiar JSON al portapapeles ───
  document.getElementById('btn-copy-json-users').addEventListener('click', async () => {
    const users = await getAllUsers();
    const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), users };
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      showJsonIOMsg('ok', '✔ JSON copiado al portapapeles.');
      // Mostrar preview
      showJsonPreview(jsonData);
    } catch(e) {
      showJsonIOMsg('err', 'No se pudo copiar. Usa HTTPS o localhost.');
    }
  });

  // ─── Importar usuarios.json ───
  document.getElementById('ireg-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = importUsersJSON(text);
      showJsonIOMsg('ok', `✔ ${count} usuario(s) importados desde "${file.name}".`);
      renderUsersTable();
      // Mostrar preview del archivo importado
      showJsonPreview(JSON.parse(text));
    } catch(err) {
      showJsonIOMsg('err', '⚠️ ' + err.message);
    }
    e.target.value = '';
  });

  // ─── Cerrar preview JSON ───
  document.getElementById('btn-json-preview-close').addEventListener('click', () => {
    document.getElementById('json-preview-box').style.display = 'none';
  });

  // ─── Botón actualizar tabla ───
  document.getElementById('btn-refresh-users').addEventListener('click', () => {
    renderUsersTable();
  });

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
  document.getElementById('btn-attack-unsigned').addEventListener('click', async () => {
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
  
  // Ataque de manipulación de datos (Tampering)
  document.getElementById('btn-attack-tampered').addEventListener('click', async () => {
    // El atacante genera un comando legítimo de Parada, pero lo manipula para que sea Marcha sin conocer la clave secreta
    const payload = {
      command: 'PPARO',
      user: 'Hacker (Tampering)',
      timestamp: Date.now(),
      nonce: generateNonce()
    };
    const payloadStr = JSON.stringify(payload);
    // Generar HMAC válido para PPARO
    const correctHmac = await generateHMAC(payloadStr, "PlcSuperSecretKeyOT2026!");
    
    // Manipular el comando en el payload enviado
    payload.command = 'PMARCHA';
    payload.user = 'Hacker (Tampered Payload)';
    
    const packet = { payload, hmac: correctHmac };
    
    logNetworkTraffic('SENT (ATTACK)', packet);
    await handleNetworkMessage(JSON.stringify(packet));
  });
  
  // Ataque de Replay
  document.getElementById('btn-attack-replay').addEventListener('click', async () => {
    if (!lastValidPacket) {
      alert('Primero debes enviar un comando legítimo en el Dashboard (ej. presionar Marcha) para interceptar y registrar una trama válida en tránsito.');
      return;
    }
    
    logNetworkTraffic('SENT (ATTACK - REPLAY)', lastValidPacket);
    await handleNetworkMessage(JSON.stringify(lastValidPacket));
  });
});


})();