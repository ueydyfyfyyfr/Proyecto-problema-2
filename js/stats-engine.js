/**
 * stats-engine.js — Capa analítica DETERMINISTA (§5.2, §5.3 del informe)
 *
 * Calcula todos los KPIs del proceso con fórmulas exactas, en el navegador y
 * sin dependencias de red. Es la capa que garantiza que el dashboard siempre
 * tenga contenido que mostrar aunque n8n o el LLM no estén disponibles
 * (RF-IA-09, mitigación de RF2-06 / RF2-08 / RF2-11).
 *
 * La capa agéntica (n8n + LLM) interpreta y redacta sobre estos números;
 * nunca los sustituye.
 */

import { PLC_STATE } from './plc-simulation.js';
import { getLogs } from './audit-log.js';

// Objetivos de referencia usados para evaluar desviaciones
export const BASELINE = {
  availabilityTarget: 0.85,   // 85 % de disponibilidad objetivo
  kwhPerBatchTarget: 0.05,    // consumo de referencia por lote
  mtbfTargetSeconds: 600,     // 10 minutos entre fallos
  energyCostPerKWh: 0.15,     // USD
  beltAlarmShareLimit: 0.5,   // una cinta no debería concentrar >50 % de alarmas
  destinationShareLimit: 0.7  // desequilibrio de destinos
};

// Estados que se consideran "produciendo"
const PRODUCTIVE_STATES = ['RUNNING', 'DISCHARGING_C0', 'DISCHARGING_DEST'];

/**
 * Calcula el conjunto completo de indicadores del proceso.
 * @returns {object} Snapshot analítico determinista
 */
export function computeStatistics() {
  const { physical, control, stats } = PLC_STATE;
  const timeInState = stats.timeInState || {};

  const totalTime = Object.values(timeInState).reduce((a, b) => a + b, 0);
  const productiveTime = PRODUCTIVE_STATES.reduce((a, s) => a + (timeInState[s] || 0), 0);
  const alarmTime = timeInState.ALARM || 0;
  const alarmCount = stats.alarmCount || 0;

  // Disponibilidad = tiempo productivo / tiempo total observado
  const availability = totalTime > 0 ? productiveTime / totalTime : 0;

  // MTBF = tiempo operativo / número de fallos (sin fallos ⇒ todo el tiempo operativo)
  const mtbfSeconds = alarmCount > 0 ? productiveTime / alarmCount : productiveTime;

  // MTTR = tiempo total en alarma / número de fallos
  const mttrSeconds = alarmCount > 0 ? alarmTime / alarmCount : 0;

  const batches = physical.batchesProcessed || 0;
  const kwh = physical.powerConsumptionKWh || 0;
  const kwhPerBatch = batches > 0 ? kwh / batches : 0;
  const operatingHours = (physical.runTimeSeconds || 0) / 3600;
  const throughputPerHour = operatingHours > 0 ? batches / operatingHours : 0;

  const alarmsByBelt = { ...(stats.alarmsByBelt || {}) };
  const totalAlarms = Object.values(alarmsByBelt).reduce((a, b) => a + b, 0);

  const batchesByDestination = { ...(stats.batchesByDestination || {}) };
  const totalRouted = Object.values(batchesByDestination).reduce((a, b) => a + b, 0);

  const securityEvents = { ...(stats.securityEvents || {}) };
  const totalSecurityEvents = Object.values(securityEvents).reduce((a, b) => a + b, 0);

  return {
    generatedAt: new Date().toISOString(),
    status: control.status,
    availability,
    mtbfSeconds,
    mttrSeconds,
    alarmCount,
    alarmsByBelt,
    totalAlarms,
    batchesProcessed: batches,
    batchesByDestination,
    totalRouted,
    powerConsumptionKWh: kwh,
    kwhPerBatch,
    operatingCostUSD: kwh * BASELINE.energyCostPerKWh,
    throughputPerHour,
    runTimeSeconds: physical.runTimeSeconds || 0,
    timeInState,
    totalObservedSeconds: totalTime,
    securityEvents,
    totalSecurityEvents,
    samples: stats.samples || [],
    trends: computeTrends(stats.samples || [])
  };
}

/**
 * Detección de tendencias sobre la serie histórica (RF-IA-07).
 * Compara la primera y la segunda mitad de las muestras disponibles.
 */
export function computeTrends(samples) {
  if (samples.length < 4) {
    return { enoughData: false, energyPerBatchDeltaPct: 0, throughputDeltaPct: 0 };
  }

  const mid = Math.floor(samples.length / 2);
  const first = samples.slice(0, mid);
  const second = samples.slice(mid);

  const segmentRate = (segment) => {
    const dKwh = segment[segment.length - 1].kwh - segment[0].kwh;
    const dBatches = segment[segment.length - 1].batches - segment[0].batches;
    const dSeconds = (segment[segment.length - 1].t - segment[0].t) / 1000;
    return {
      kwhPerBatch: dBatches > 0 ? dKwh / dBatches : 0,
      batchesPerHour: dSeconds > 0 ? (dBatches / dSeconds) * 3600 : 0
    };
  };

  const a = segmentRate(first);
  const b = segmentRate(second);
  const pctDelta = (prev, curr) => (prev > 0 ? ((curr - prev) / prev) * 100 : 0);

  return {
    enoughData: true,
    energyPerBatchDeltaPct: pctDelta(a.kwhPerBatch, b.kwhPerBatch),
    throughputDeltaPct: pctDelta(a.batchesPerHour, b.batchesPerHour),
    baselineKwhPerBatch: a.kwhPerBatch,
    currentKwhPerBatch: b.kwhPerBatch
  };
}

/**
 * Recomendaciones deterministas de reserva (§5.4).
 * Se muestran cuando el agente de IA no está disponible, y sirven además de
 * "verdad de referencia" con la que contrastar lo que responde el LLM.
 *
 * Cada recomendación sigue la estructura exigida:
 *   severidad · hallazgo · evidencia · acción sugerida
 */
export function computeLocalRecommendations(stats = computeStatistics()) {
  const recs = [];

  // 1. Mantenimiento predictivo: una cinta concentra las alarmas
  if (stats.totalAlarms >= 3) {
    const [belt, count] = Object.entries(stats.alarmsByBelt)
      .sort((a, b) => b[1] - a[1])[0];
    const share = count / stats.totalAlarms;
    if (share > BASELINE.beltAlarmShareLimit) {
      recs.push({
        severity: 'Crítica',
        category: 'Mantenimiento predictivo',
        finding: `La cinta ${belt} concentra el ${(share * 100).toFixed(0)} % de las alarmas de vigilancia.`,
        evidence: `${count} de ${stats.totalAlarms} alarmas registradas corresponden a ${belt}.`,
        action: `Programar inspección del reductor y tensado de la banda de la cinta ${belt} antes del próximo turno.`
      });
    }
  }

  // 2. Disponibilidad por debajo del objetivo
  if (stats.totalObservedSeconds > 60 && stats.availability < BASELINE.availabilityTarget) {
    recs.push({
      severity: stats.availability < 0.6 ? 'Crítica' : 'Alta',
      category: 'Disponibilidad',
      finding: `Disponibilidad del ${(stats.availability * 100).toFixed(1)} %, por debajo del objetivo del ${(BASELINE.availabilityTarget * 100).toFixed(0)} %.`,
      evidence: `MTBF ${formatSeconds(stats.mtbfSeconds)} · MTTR ${formatSeconds(stats.mttrSeconds)} sobre ${formatSeconds(stats.totalObservedSeconds)} observados.`,
      action: stats.mttrSeconds > stats.mtbfSeconds * 0.1
        ? 'El MTTR es el principal causante: agilizar el acuse de alarmas y revisar el procedimiento de rearme.'
        : 'La causa dominante es la frecuencia de fallos: revisar los sensores de vigilancia de velocidad.'
    });
  }

  // 3. Eficiencia energética
  if (stats.batchesProcessed > 5 && stats.kwhPerBatch > BASELINE.kwhPerBatchTarget) {
    const over = ((stats.kwhPerBatch / BASELINE.kwhPerBatchTarget) - 1) * 100;
    recs.push({
      severity: over > 40 ? 'Alta' : 'Media',
      category: 'Eficiencia energética',
      finding: `El consumo por lote supera la línea base en un ${over.toFixed(0)} %.`,
      evidence: `${stats.kwhPerBatch.toFixed(4)} kWh/lote frente a ${BASELINE.kwhPerBatchTarget} kWh/lote de referencia.`,
      action: 'Revisar la tensión de las bandas y evaluar la reducción de los tiempos de vaciado en vacío.'
    });
  }

  // 4. Tendencia de consumo al alza
  if (stats.trends.enoughData && stats.trends.energyPerBatchDeltaPct > 15) {
    recs.push({
      severity: 'Media',
      category: 'Tendencia',
      finding: `El consumo por lote muestra una tendencia creciente del ${stats.trends.energyPerBatchDeltaPct.toFixed(0)} %.`,
      evidence: `De ${stats.trends.baselineKwhPerBatch.toFixed(4)} a ${stats.trends.currentKwhPerBatch.toFixed(4)} kWh/lote entre la primera y la segunda mitad de la serie.`,
      action: 'Anticipar el mantenimiento de rodillos: una deriva sostenida suele indicar fricción creciente.'
    });
  }

  // 5. Optimización de setpoints
  const dischargeSetpoint = PLC_STATE.config.cinta0DischargeTime;
  if (stats.batchesProcessed > 10 && dischargeSetpoint > 15) {
    recs.push({
      severity: 'Informativa',
      category: 'Optimización de setpoints',
      finding: `El tiempo de vaciado de la cinta 0 está configurado en ${dischargeSetpoint} s.`,
      evidence: `Con el caudal medido (${stats.throughputPerHour.toFixed(1)} lotes/h) la cinta queda vacía antes de agotar el temporizador.`,
      action: 'Evaluar la reducción del setpoint de vaciado; cada segundo ahorrado reduce el consumo en vacío.'
    });
  }

  // 6. Alerta de seguridad
  if (stats.totalSecurityEvents > 0) {
    const detail = Object.entries(stats.securityEvents)
      .map(([k, v]) => `${k}×${v}`).join(', ');
    recs.push({
      severity: stats.totalSecurityEvents >= 3 ? 'Crítica' : 'Alta',
      category: 'Ciberseguridad',
      finding: `Se han bloqueado ${stats.totalSecurityEvents} intentos de intrusión sobre el canal HMI→PLC.`,
      evidence: `Desglose por vector: ${detail}.`,
      action: 'Revisar el control de acceso a la red OT y conservar el registro de auditoría como evidencia forense.'
    });
  }

  // 7. Desequilibrio de destinos
  if (stats.totalRouted >= 10) {
    const [pos, count] = Object.entries(stats.batchesByDestination)
      .sort((a, b) => b[1] - a[1])[0];
    const share = count / stats.totalRouted;
    if (share > BASELINE.destinationShareLimit) {
      recs.push({
        severity: 'Informativa',
        category: 'Operativa',
        finding: `El ${(share * 100).toFixed(0)} % de los lotes se dirige a la posición ${pos}.`,
        evidence: `${count} de ${stats.totalRouted} lotes evacuados por la cinta ${pos}.`,
        action: 'Verificar si el reparto responde a la planificación prevista o a un sesgo del operador.'
      });
    }
  }

  if (recs.length === 0) {
    recs.push({
      severity: 'Informativa',
      category: 'Estado general',
      finding: 'El proceso opera dentro de todos los umbrales de referencia.',
      evidence: `Disponibilidad ${(stats.availability * 100).toFixed(1)} % · ${stats.alarmCount} alarmas · ${stats.totalSecurityEvents} incidentes de seguridad.`,
      action: 'Sin acciones correctivas. Mantener el plan de mantenimiento programado.'
    });
  }

  return prioritize(recs);
}

/** Ordena por impacto: Crítica → Alta → Media → Informativa (RF-IA-06) */
export function prioritize(recommendations) {
  const order = { 'Crítica': 0, 'Alta': 1, 'Media': 2, 'Informativa': 3 };
  return [...recommendations].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)
  );
}

/**
 * Extrae los últimos eventos del log SANEADOS para su envío al agente.
 * Neutraliza los patrones habituales de prompt injection (S-5, mitigación RF2-02).
 */
export function getSanitizedRecentEvents(limit = 25) {
  return getLogs().slice(0, limit).map(l => ({
    ts: l.timestamp,
    level: l.type,
    actor: sanitizeForPrompt(l.user),
    message: sanitizeForPrompt(l.message)
  }));
}

/**
 * Saneado defensivo del texto que viajará dentro de un prompt.
 * No confía en el contenido del log: lo trata como dato, nunca como instrucción.
 */
export function sanitizeForPrompt(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[`${}<>]/g, ' ')                                  // metacaracteres de plantilla y markup
    .replace(/\b(ignore|disregard|olvida|ignora)\b[^.]*/gi, '[texto filtrado]')
    .replace(/\b(system|assistant|user)\s*:/gi, '[rol filtrado]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** Formatea segundos como texto legible (ej. "2 m 15 s") */
export function formatSeconds(sec) {
  if (!isFinite(sec) || sec <= 0) return '0 s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m ${s} s`;
  return `${s} s`;
}
