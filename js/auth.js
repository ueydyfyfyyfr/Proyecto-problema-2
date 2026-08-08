/**
 * auth.js — Autenticación y gestión de usuarios (RBAC)
 *
 * Arquitectura de dos aplicaciones:
 *   - Aplicación 1 (admin.html): genera usuarios.json con hashes PBKDF2
 *   - Aplicación 2 (index.html, esta app): carga usuarios.json y verifica
 *     contraseñas localmente con PBKDF2 — las contraseñas NUNCA existen en texto plano.
 */

import { verifyPassword, createCredential } from './crypto-helper.js';
import { logEvent } from './audit-log.js';

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
export async function loadUsersDB() {
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
export function invalidateCache() {
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
export function importUsersJSON(jsonText) {
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

// Bloqueo temporal ante fuerza bruta (RT-10)
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const failedAttempts = new Map(); // username → { count, lockedUntil }

/** Devuelve los segundos restantes de bloqueo, o 0 si la cuenta está disponible */
function getLockoutRemaining(key) {
  const record = failedAttempts.get(key);
  if (!record || !record.lockedUntil) return 0;
  const remaining = record.lockedUntil - Date.now();
  if (remaining <= 0) {
    failedAttempts.delete(key);
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

/**
 * Intenta iniciar sesión con las credenciales dadas.
 * Verifica la contraseña con PBKDF2 — nunca existe en texto plano.
 */
export async function login(username, password) {
  const db = await loadUsersDB();
  const key = username.toLowerCase().trim();

  const lockedFor = getLockoutRemaining(key);
  if (lockedFor > 0) {
    logEvent('SECURITY_ALERT', `Intento de acceso sobre la cuenta bloqueada "${key}" (quedan ${lockedFor}s de bloqueo).`, 'AUTH_SYSTEM');
    throw new Error(`Cuenta bloqueada por intentos fallidos. Reintenta en ${lockedFor} segundos.`);
  }

  const user = db[key];

  if (!user) {
    throw new Error('Usuario no encontrado');
  }

  // Verificar contraseña con PBKDF2 + salt individual
  const isValid = await verifyPassword(password, user.hash, user.salt);
  if (!isValid) {
    const record = failedAttempts.get(key) || { count: 0, lockedUntil: 0 };
    record.count++;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_MS;
      record.count = 0;
      logEvent('SECURITY_ALERT', `Cuenta "${key}" bloqueada ${LOCKOUT_MS / 60000} minutos tras ${MAX_FAILED_ATTEMPTS} intentos fallidos consecutivos.`, 'AUTH_SYSTEM');
    } else {
      logEvent('WARNING', `Intento de inicio de sesión fallido para usuario: ${key} (${record.count}/${MAX_FAILED_ATTEMPTS}).`, 'AUTH_SYSTEM');
    }
    failedAttempts.set(key, record);
    throw new Error('Contraseña incorrecta');
  }

  // Autenticación correcta: se reinicia el contador de intentos
  failedAttempts.delete(key);

  currentUser = {
    username: key,
    role: user.role,
    name: user.name,
    isSystem: user.isSystem || false
  };

  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  logEvent('INFO', `Sesión iniciada correctamente.`, currentUser.name + ' (' + currentUser.role + ')');
  return currentUser;
}

export function logout() {
  if (currentUser) {
    logEvent('INFO', `Sesión cerrada.`, currentUser.name + ' (' + currentUser.role + ')');
  }
  currentUser = null;
  localStorage.removeItem('currentUser');
}

export function getCurrentUser() {
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
export async function createUser(username, password, role, fullName, capabilities = []) {
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
export async function deleteUser(username) {
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
export async function getAllUsers() {
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
export function checkPermission(action) {
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
    default:                
      return false;
  }
}
