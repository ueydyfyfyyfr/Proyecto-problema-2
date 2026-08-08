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
export function generateSalt() {
  const arr = new Uint8Array(16);
  window.crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

/** Convierte un array de bytes a string hexadecimal */
export function uint8ToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convierte un string hexadecimal a Uint8Array */
export function hexToUint8(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

/**
 * Deriva el hash PBKDF2-SHA256 de una contraseña usando el salt dado.
 * @param {string} password  Contraseña en texto plano
 * @param {string} saltHex   Salt en formato hexadecimal (16 bytes)
 * @returns {Promise<string>} Hash resultante en hexadecimal (32 bytes / 64 chars)
 */
export async function hashPasswordPBKDF2(password, saltHex) {
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
export async function createCredential(password) {
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
export async function verifyPassword(password, storedHash, saltHex) {
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
export async function hashSHA256(text) {
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

export async function generateHMAC(message, secret) {
  const cryptoKey = await importHMACKey(secret);
  const enc = new TextEncoder();
  const sigBuffer = await window.crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return uint8ToHex(new Uint8Array(sigBuffer));
}

export async function verifyHMAC(message, signatureHex, secret) {
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

export async function encryptAES(text, secret) {
  const key = await importAESKey(secret);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertextBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `${uint8ToHex(iv)}:${uint8ToHex(new Uint8Array(ciphertextBuffer))}`;
}

export async function decryptAES(encryptedStr, secret) {
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
export function generateNonce() {
  const arr = new Uint8Array(8);
  window.crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}
