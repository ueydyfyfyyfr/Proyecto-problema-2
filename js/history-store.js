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
export function push(sample) {
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
export function range(from, to) {
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
export function downsample(n) {
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
export function clear() {
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
export function sizeBytes() {
  ensureHistoryLoaded();
  if (historyBuffer.length === 0) return 0;

  const raw = JSON.stringify(historyBuffer);
  try {
    if (typeof Blob !== 'undefined') return new Blob([raw]).size;
  } catch (e) { /* sin Blob: se aproxima por longitud */ }
  return raw.length;
}

/** Fuerza la escritura pendiente. Útil antes de abandonar la página. */
export function flushHistory() {
  ensureHistoryLoaded();
  if (historyPending === 0) return true;
  return persistHistory();
}

/** Número de muestras almacenadas (F3 lo usa para decidir meta.degraded). */
export function historyCount() {
  ensureHistoryLoaded();
  return historyBuffer.length;
}

/**
 * Fachada con nombre propio. Los consumidores deben usarla en lugar de importar
 * `push`/`range`/`clear` sueltos: build_bundle.js vuelca todos los módulos en un
 * único ámbito, donde esos nombres genéricos son fáciles de colisionar.
 */
export const HistoryStore = {
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
