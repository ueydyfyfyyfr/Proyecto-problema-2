/**
 * n8n-connector.js â€” Canal de telemetrÃ­a HMI â†’ n8n (Â§5.6, Â§5.7 del informe)
 *
 * PRINCIPIO RECTOR (no negociable):
 *   El agente observa, analiza y recomienda. El agente NUNCA actÃºa sobre el proceso.
 *
 * Este mÃ³dulo es el equivalente software de un *data diode* industrial:
 *   - S-1: el flujo es unidireccional. AquÃ­ no se importa `handleNetworkMessage`
 *          ni ninguna funciÃ³n de control del PLC; es imposible que una respuesta
 *          de n8n derive en un comando.
 *   - S-2: la respuesta del agente se trata siempre como texto a mostrar.
 *          No hay `eval`, `Function`, ni despacho dinÃ¡mico de acciones.
 *   - S-3: la clave del LLM vive exclusivamente en las credenciales de n8n.
 *   - S-4: el webhook exige un token que el operador configura en la UI y que
 *          se guarda en localStorage, nunca en el cÃ³digo fuente (RF-DEP-04).
 *   - S-7: toda interacciÃ³n queda registrada como evento `AI_INTERACTION`.
 */

import { logEvent } from './audit-log.js';
import { getCurrentUser } from './auth.js';
import { PLC_STATE } from './plc-simulation.js';
import { computeStatistics, getSanitizedRecentEvents, sanitizeForPrompt } from './stats-engine.js';

const SCHEMA_VERSION = '1.0';
const CONFIG_KEY = 'n8nConfig';
const REQUEST_TIMEOUT_MS = 8000;

// Estado de conexiÃ³n observable por la UI (RF-IA-11)
export const CONNECTION = {
  OFFLINE: 'offline',
  CONNECTED: 'connected',
  PROCESSING: 'processing',
  ERROR: 'error'
};

let connectionState = CONNECTION.OFFLINE;
let lastError = '';

const DEFAULT_CONFIG = {
  baseUrl: '',              // ej. https://mi-instancia.n8n.cloud/webhook
  token: '',                // cabecera X-HMI-Token
  telemetryPath: '/hmi-telemetry',
  securityPath: '/hmi-security',
  analysisPath: '/hmi-analysis',
  askPath: '/hmi-ask',
  autoTelemetry: false,
  intervalSeconds: 60
};

// ============================================================
// CONFIGURACIÃ“N (persistida en localStorage, nunca en el cÃ³digo)
// ============================================================

export function getN8nConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return { ...DEFAULT_CONFIG, ...saved };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveN8nConfig(partial) {
  const merged = { ...getN8nConfig(), ...partial };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  logEvent('CONFIG_CHANGE',
    `ConfiguraciÃ³n del conector n8n actualizada (endpoint: ${merged.baseUrl || 'no definido'}).`,
    getCurrentUser()?.name || 'SYSTEM');
  restartAutoTelemetry();
  return merged;
}

export function isConfigured() {
  const c = getN8nConfig();
  return Boolean(c.baseUrl && c.token);
}

export function getConnectionState() {
  return { state: connectionState, lastError };
}

function setConnectionState(state, error = '') {
  connectionState = state;
  lastError = error;
  window.dispatchEvent(new CustomEvent('n8n-connection-changed', {
    detail: { state, error }
  }));
}

// ============================================================
// CONTRATO DE DATOS HMI â†’ n8n (Â§5.6)
// ============================================================

/**
 * Construye el payload de telemetrÃ­a.
 * Regla 1 del contrato: jamÃ¡s se incluyen hash, salt, contraseÃ±as ni el
 * secreto compartido del PLC. Solo estado de proceso, mÃ©tricas y eventos.
 */
export function buildTelemetryPayload() {
  const stats = computeStatistics();
  const user = getCurrentUser();

  const activeMotors = Object.keys(PLC_STATE.outputs)
    .filter(k => k.startsWith('M') && PLC_STATE.outputs[k]);

  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'HMI-Problema2',
    sentAt: new Date().toISOString(),
    session: {
      user: user ? sanitizeForPrompt(user.name) : 'ANONYMOUS',
      role: user ? user.role : 'NONE'
    },
    snapshot: {
      status: PLC_STATE.control.status,
      targetPosition: PLC_STATE.physical.targetPosition,
      hopperOpenPercent: Math.round(PLC_STATE.physical.hopperOpenPercent),
      currentAngle: Math.round(PLC_STATE.physical.currentAngle),
      activeMotors,
      securityLockdown: PLC_STATE.control.securityLockdown
    },
    metrics: {
      runTimeSeconds: Number(stats.runTimeSeconds.toFixed(1)),
      batchesProcessed: stats.batchesProcessed,
      powerConsumptionKWh: Number(stats.powerConsumptionKWh.toFixed(5)),
      alarmsByBelt: stats.alarmsByBelt,
      batchesByDestination: stats.batchesByDestination,
      securityEvents: stats.securityEvents,
      timeInState: stats.timeInState
    },
    derived: {
      availability: Number(stats.availability.toFixed(4)),
      mtbfSeconds: Number(stats.mtbfSeconds.toFixed(1)),
      mttrSeconds: Number(stats.mttrSeconds.toFixed(1)),
      kwhPerBatch: Number(stats.kwhPerBatch.toFixed(5)),
      throughputPerHour: Number(stats.throughputPerHour.toFixed(2)),
      trends: stats.trends
    },
    recentEvents: getSanitizedRecentEvents(25)
  };
}

// ============================================================
// TRANSPORTE â€” SIEMPRE ASÃNCRONO Y NO BLOQUEANTE (RF-N8N-08)
// ============================================================

/**
 * Realiza un POST al webhook con timeout. Un fallo NUNCA se propaga:
 * la lÃ³gica del PLC no debe verse afectada jamÃ¡s por el estado de n8n.
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
async function postToWebhook(path, body) {
  const cfg = getN8nConfig();
  if (!cfg.baseUrl || !cfg.token) {
    return { ok: false, error: 'Conector n8n no configurado' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMI-Token': cfg.token
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    // La respuesta se interpreta como DATOS para mostrar, nunca como instrucciones (S-2)
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { text }; }
    return { ok: true, data };

  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Tiempo de espera agotado' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// API PÃšBLICA DEL CONECTOR
// ============================================================

/** WF-1 â€” EnvÃ­o de telemetrÃ­a (fire-and-forget) */
export async function sendTelemetry(reason = 'manual') {
  if (!isConfigured()) {
    setConnectionState(CONNECTION.OFFLINE);
    return { ok: false, error: 'Conector n8n no configurado' };
  }

  setConnectionState(CONNECTION.PROCESSING);
  const payload = buildTelemetryPayload();
  const result = await postToWebhook(getN8nConfig().telemetryPath, { reason, ...payload });

  if (result.ok) {
    setConnectionState(CONNECTION.CONNECTED);
    logEvent('AI_INTERACTION', `TelemetrÃ­a enviada a n8n (motivo: ${reason}).`, 'N8N_CONNECTOR');
  } else {
    setConnectionState(CONNECTION.ERROR, result.error);
    logEvent('AI_INTERACTION', `Fallo al enviar telemetrÃ­a a n8n: ${result.error}. La operaciÃ³n del PLC no se ve afectada.`, 'N8N_CONNECTOR');
  }
  return result;
}

/** WF-3 â€” NotificaciÃ³n de un incidente de ciberseguridad para su triaje con IA */
export async function sendSecurityEvent(reason, detail) {
  if (!isConfigured()) return { ok: false, error: 'Conector n8n no configurado' };

  const result = await postToWebhook(getN8nConfig().securityPath, {
    schemaVersion: SCHEMA_VERSION,
    source: 'HMI-Problema2',
    sentAt: new Date().toISOString(),
    incident: {
      reason: sanitizeForPrompt(reason),
      detail: sanitizeForPrompt(detail)
    },
    securityEvents: computeStatistics().securityEvents,
    recentEvents: getSanitizedRecentEvents(10)
  });

  logEvent('AI_INTERACTION',
    result.ok ? `Incidente "${reason}" remitido a n8n para triaje con IA.`
              : `No se pudo remitir el incidente "${reason}" a n8n: ${result.error}.`,
    'N8N_CONNECTOR');
  return result;
}

/**
 * WF-2 â€” Solicita el anÃ¡lisis estadÃ­stico al agente.
 * @returns {Promise<{ok:boolean, recommendations?:Array, error?:string}>}
 */
export async function requestAnalysis() {
  if (!isConfigured()) {
    setConnectionState(CONNECTION.OFFLINE);
    return { ok: false, error: 'Conector n8n no configurado' };
  }

  setConnectionState(CONNECTION.PROCESSING);
  const result = await postToWebhook(getN8nConfig().analysisPath, buildTelemetryPayload());

  if (!result.ok) {
    setConnectionState(CONNECTION.ERROR, result.error);
    logEvent('AI_INTERACTION', `El agente de IA no respondiÃ³ al anÃ¡lisis: ${result.error}. Se muestran las estadÃ­sticas locales.`, 'N8N_CONNECTOR');
    return { ok: false, error: result.error };
  }

  setConnectionState(CONNECTION.CONNECTED);
  const recommendations = normalizeRecommendations(result.data);
  logEvent('AI_INTERACTION', `AnÃ¡lisis del agente recibido: ${recommendations.length} recomendaciÃ³n(es).`, 'N8N_CONNECTOR');
  return { ok: true, recommendations };
}

/** WF-5 â€” Consulta en lenguaje natural sobre el histÃ³rico (RF-IA-08) */
export async function askAgent(question) {
  const cleanQuestion = sanitizeForPrompt(question);
  if (!cleanQuestion) return { ok: false, error: 'La pregunta estÃ¡ vacÃ­a' };

  logEvent('AI_INTERACTION', `Consulta al agente: "${cleanQuestion}"`, getCurrentUser()?.name || 'SYSTEM');

  if (!isConfigured()) {
    setConnectionState(CONNECTION.OFFLINE);
    return { ok: false, error: 'Conector n8n no configurado' };
  }

  setConnectionState(CONNECTION.PROCESSING);
  const result = await postToWebhook(getN8nConfig().askPath, {
    question: cleanQuestion,
    context: buildTelemetryPayload()
  });

  if (!result.ok) {
    setConnectionState(CONNECTION.ERROR, result.error);
    return { ok: false, error: result.error };
  }

  setConnectionState(CONNECTION.CONNECTED);
  const answer = extractAnswerText(result.data);
  logEvent('AI_INTERACTION', `Respuesta del agente recibida (${answer.length} caracteres).`, 'N8N_CONNECTOR');
  return { ok: true, answer };
}

/** Comprueba la conectividad con la instancia de n8n */
export async function testConnection() {
  setConnectionState(CONNECTION.PROCESSING);
  const result = await postToWebhook(getN8nConfig().telemetryPath, {
    schemaVersion: SCHEMA_VERSION,
    source: 'HMI-Problema2',
    reason: 'connection-test',
    sentAt: new Date().toISOString()
  });
  setConnectionState(result.ok ? CONNECTION.CONNECTED : CONNECTION.ERROR, result.error || '');
  logEvent('AI_INTERACTION',
    result.ok ? 'Prueba de conexiÃ³n con n8n correcta.' : `Prueba de conexiÃ³n con n8n fallida: ${result.error}.`,
    getCurrentUser()?.name || 'SYSTEM');
  return result;
}

// ============================================================
// NORMALIZACIÃ“N DEFENSIVA DE LA RESPUESTA DEL AGENTE (S-2)
// ============================================================

/**
 * Convierte lo que devuelva n8n en una lista de recomendaciones con la forma
 * esperada. Todo campo se sanea y se trunca: la respuesta del LLM es un dato
 * no confiable que solo se renderiza como texto.
 */
export function normalizeRecommendations(data) {
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data?.recommendations)) list = data.recommendations;
  else if (Array.isArray(data?.output)) list = data.output;
  else if (data && typeof data === 'object') list = [data];

  const validSeverities = ['CrÃ­tica', 'Alta', 'Media', 'Informativa'];

  return list
    .filter(r => r && typeof r === 'object')
    .map(r => {
      const severity = validSeverities.includes(r.severity) ? r.severity : 'Informativa';
      return {
        severity,
        category: sanitizeForPrompt(r.category || 'Agente IA'),
        finding: sanitizeForPrompt(r.finding || r.hallazgo || r.message || ''),
        evidence: sanitizeForPrompt(r.evidence || r.evidencia || ''),
        action: sanitizeForPrompt(r.action || r.accion || r.recommendation || ''),
        fromAgent: true
      };
    })
    .filter(r => r.finding);
}

/** Extrae el texto de respuesta de la consulta en lenguaje natural */
export function extractAnswerText(data) {
  if (typeof data === 'string') return sanitizeAnswer(data);
  const candidate = data?.answer ?? data?.output ?? data?.text ?? data?.respuesta;
  if (typeof candidate === 'string') return sanitizeAnswer(candidate);
  return sanitizeAnswer(JSON.stringify(data ?? ''));
}

/** Saneado del texto de respuesta: se muestra como texto plano, nunca como HTML */
function sanitizeAnswer(text) {
  return String(text).replace(/[<>]/g, '').slice(0, 2000);
}

// ============================================================
// TELEMETRÃA AUTOMÃTICA PERIÃ“DICA
// ============================================================

let autoTimer = null;

export function restartAutoTelemetry() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  const cfg = getN8nConfig();
  if (cfg.autoTelemetry && isConfigured()) {
    autoTimer = setInterval(() => {
      sendTelemetry('periodica');
    }, Math.max(15, cfg.intervalSeconds) * 1000);
  }
}

// Reenviar automÃ¡ticamente los incidentes de seguridad al triaje de n8n (WF-3)
window.addEventListener('audit-log-updated', (e) => {
  const entry = e.detail;
  if (!entry || entry.type !== 'SECURITY_ALERT') return;
  if (!getN8nConfig().autoTelemetry || !isConfigured()) return;
  sendSecurityEvent(entry.details?.reason || 'SECURITY_ALERT', entry.message);
});
