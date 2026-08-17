import { PLC_STATE } from './plc-simulation.js';
import { historyStore } from './history-store.js';
import { getLogs, getLogsByType } from './audit-log.js';

export function computeKPIs() {
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

export function computeReliability() {
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

export function computeEnergy(tarifa = 0.15) {
  const stats = PLC_STATE.stats || {};
  const totalKWh = PLC_STATE.physical.powerConsumptionKWh || 0;
  
  return {
    totalKWh,
    totalCost: totalKWh * tarifa,
    motorKWh: stats.motorKWh || {},
    motorCycles: stats.motorCycles || {}
  };
}

export function computeSecurity() {
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
export function computeTrends(windowMinutes = 5) {
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
