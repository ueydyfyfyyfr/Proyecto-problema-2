import { computeKPIs, computeReliability, computeEnergy, computeSecurity } from './stats-engine.js';
import { getLogsSince, getLogsByType } from './audit-log.js';
import { PLC_STATE } from './plc-simulation.js';

let connectorActive = true; // Local AI is always active

export async function askAgent(message, history) {
  // ─── AGENTE IA LOCAL INTELIGENTE ───
  // Analiza el mensaje del usuario y responde usando datos reales de la planta en tiempo real.
  // No requiere conexión externa (n8n, OpenAI, etc.)
  connectorActive = true;
  const response = generateIntelligentResponse(message, history);
  return { text: response, isFallback: false };
}

export function isAgentConnected() {
  return connectorActive;
}

// ─── MOTOR DE IA LOCAL ───
function generateIntelligentResponse(msg, history) {
  const lowerMsg = msg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const kpis = computeKPIs();
  const rel = computeReliability();
  const energy = computeEnergy();
  const sec = computeSecurity();
  const status = PLC_STATE.control.status;
  const alarms = PLC_STATE.control.alarms || {};
  const activeAlarms = Object.keys(alarms).filter(k => alarms[k]);
  const physical = PLC_STATE.physical;
  const outputs = PLC_STATE.outputs;
  const stats = PLC_STATE.stats;

  // ─── COMANDOS DE ACCIÓN (AGENTE CON CAPACIDAD DE CONTROL) ───
  if (match(lowerMsg, ['iniciar marcha', 'inicia marcha', 'arranca la planta', 'arrancar la planta', 'encender planta', 'pon en marcha'])) {
    sendSecureCommand('PMARCHA');
    return `▶ **Comando Ejecutado por la IA**\n\nSe ha firmado y transmitido el comando de **MARCHA** al PLC. La secuencia de posicionamiento y descarga ha comenzado.`;
  }
  
  if (match(lowerMsg, ['detener planta', 'deten la planta', 'ejecutar paro', 'apagar planta', 'para la planta', 'haz un paro'])) {
    sendSecureCommand('PPARO');
    return `⏹ **Comando Ejecutado por la IA**\n\nSe ha firmado y transmitido el comando de **PARADA SEGURA** al PLC. Se ha cerrado la tolva y se iniciará el vaciado de las cintas.`;
  }

  if (match(lowerMsg, ['cambiar posicion', 'cambia posicion', 'cambia destino', 'seleccionar posicion', 'siguiente posicion'])) {
    sendSecureCommand('PSELEC');
    return `↻ **Comando Ejecutado por la IA**\n\nSe ha cambiado la posición de destino seleccionada en la plataforma giratoria.`;
  }

  // ─── ESTADO GENERAL / RESUMEN ───
  if (match(lowerMsg, ['estado', 'resumen', 'como esta', 'como va', 'status', 'general', 'reporte', 'informe'])) {
    const statusEmoji = status === 'RUNNING' ? '🟢' : status === 'IDLE' ? '🟡' : status === 'ALARM' ? '🔴' : '🔵';
    let resp = `${statusEmoji} **Reporte de Estado del Sistema OT**\n\n`;
    resp += `• **Estado PLC:** ${status}\n`;
    resp += `• **OEE Global:** ${kpis.oee.toFixed(1)}%\n`;
    resp += `  - Disponibilidad: ${kpis.availability.toFixed(1)}%\n`;
    resp += `  - Rendimiento: ${kpis.performance.toFixed(1)}%\n`;
    resp += `  - Calidad: ${kpis.quality.toFixed(1)}%\n`;
    resp += `• **Lotes procesados:** ${kpis.batchesProcessed}\n`;
    resp += `• **Unidades transferidas:** ${kpis.unitsTransferred}\n`;
    resp += `• **Tolva:** ${physical.hopperOpenPercent.toFixed(0)}% abierta\n`;
    resp += `• **Posición actual:** Destino ${physical.targetPosition}\n`;
    resp += `• **Tiempo de operación:** ${formatSeconds(physical.runTimeSeconds)}\n`;
    if (activeAlarms.length > 0) {
      resp += `\n⚠️ **Alarmas activas:** ${activeAlarms.join(', ')}`;
    } else {
      resp += `\n✅ Sin alarmas activas.`;
    }
    return resp;
  }

  // ─── OEE ───
  if (match(lowerMsg, ['oee', 'eficiencia', 'rendimiento global', 'overall equipment'])) {
    let resp = `📊 **Análisis OEE (Overall Equipment Effectiveness)**\n\n`;
    resp += `• **OEE Global:** ${kpis.oee.toFixed(1)}%\n`;
    resp += `• **Disponibilidad:** ${kpis.availability.toFixed(1)}%\n`;
    resp += `• **Rendimiento:** ${kpis.performance.toFixed(1)}%\n`;
    resp += `• **Calidad:** ${kpis.quality.toFixed(1)}%\n\n`;
    
    if (kpis.oee >= 85) resp += `✅ El OEE está en nivel **World Class** (≥85%). ¡Excelente rendimiento!`;
    else if (kpis.oee >= 60) resp += `🟡 El OEE está en nivel **Aceptable** (60-84%). Hay oportunidades de mejora.`;
    else if (kpis.oee > 0) resp += `🔴 El OEE está **por debajo del estándar** (<60%). Se recomienda investigar las causas de pérdida.`;
    else resp += `⏸ La planta no ha iniciado operación. Presiona MARCHA para comenzar.`;
    return resp;
  }

  // ─── ALARMAS / FALLAS ───
  if (match(lowerMsg, ['alarma', 'falla', 'error', 'alerta', 'problema', 'fallo'])) {
    let resp = `🔔 **Análisis de Alarmas y Fiabilidad**\n\n`;
    resp += `• **Total alarmas registradas:** ${rel.alarmSum}\n`;
    resp += `• **MTBF (Tiempo Medio Entre Fallos):** ${rel.mtbf.toFixed(0)}s\n`;
    resp += `• **Alarmas por cinta:**\n`;
    resp += `  - C0: ${stats.alarmCount.C0} | C1: ${stats.alarmCount.C1} | C2: ${stats.alarmCount.C2} | C3: ${stats.alarmCount.C3}\n\n`;
    
    if (activeAlarms.length > 0) {
      resp += `⚠️ **Alarmas ACTIVAS ahora:** ${activeAlarms.join(', ')}\n`;
      resp += `Recomendación: Verificar los sensores de velocidad de las cintas afectadas.`;
    } else {
      resp += `✅ No hay alarmas activas en este momento.`;
    }
    
    if (rel.alarmSum > 5) {
      const maxAlarm = Object.entries(stats.alarmCount).sort((a,b) => b[1] - a[1])[0];
      resp += `\n\n📌 **Diagnóstico:** La cinta ${maxAlarm[0]} tiene la mayor cantidad de alarmas (${maxAlarm[1]}). Se recomienda inspeccionar el sensor de velocidad VigC${maxAlarm[0].replace('C','')}.`;
    }
    return resp;
  }

  // ─── ENERGÍA ───
  if (match(lowerMsg, ['energia', 'consumo', 'costo', 'kwh', 'potencia', 'electri', 'gasto'])) {
    let resp = `⚡ **Análisis Energético**\n\n`;
    resp += `• **Consumo total:** ${energy.totalKWh.toFixed(3)} kWh\n`;
    resp += `• **Costo estimado:** $${energy.totalCost.toFixed(2)} USD\n`;
    resp += `• **Tarifa aplicada:** $${energy.rate}/kWh\n\n`;
    resp += `**Consumo por motor (kWh):**\n`;
    
    const motors = stats.motorKWh;
    Object.entries(motors).forEach(([motor, kwh]) => {
      if (kwh > 0) resp += `  - ${motor}: ${kwh.toFixed(4)} kWh (${stats.motorSeconds[motor].toFixed(0)}s activo)\n`;
    });
    
    if (energy.totalKWh > 0) {
      const topMotor = Object.entries(motors).sort((a,b) => b[1] - a[1])[0];
      resp += `\n📌 **Mayor consumidor:** ${topMotor[0]} con ${topMotor[1].toFixed(4)} kWh`;
    }
    return resp;
  }

  // ─── PRODUCCIÓN ───
  if (match(lowerMsg, ['lote', 'produccion', 'unidades', 'procesado', 'batch', 'producto', 'material'])) {
    let resp = `📦 **Análisis de Producción**\n\n`;
    resp += `• **Lotes completos:** ${kpis.batchesProcessed}\n`;
    resp += `• **Unidades transferidas:** ${kpis.unitsTransferred}\n`;
    resp += `• **Tiempo operativo:** ${formatSeconds(physical.runTimeSeconds)}\n\n`;
    resp += `**Distribución por destino:**\n`;
    resp += `  - Posición 1 (C1): ${stats.batchesByDest[1]} lotes\n`;
    resp += `  - Posición 2 (C2): ${stats.batchesByDest[2]} lotes\n`;
    resp += `  - Posición 3 (C3): ${stats.batchesByDest[3]} lotes\n`;
    
    if (kpis.batchesProcessed > 0) {
      const rate = (kpis.batchesProcessed / (physical.runTimeSeconds / 3600)).toFixed(1);
      resp += `\n📌 **Tasa de producción:** ~${rate} lotes/hora`;
    }
    return resp;
  }

  // ─── SEGURIDAD / CIBERSEGURIDAD ───
  if (match(lowerMsg, ['seguridad', 'ciberseguridad', 'ataque', 'intrusion', 'firewall', 'lockdown', 'bloqueo'])) {
    let resp = `🛡️ **Análisis de Ciberseguridad OT**\n\n`;
    resp += `• **Comandos rechazados:** ${sec.rejections}\n`;
    resp += `• **Bloqueos preventivos (Lockdowns):** ${sec.lockdowns}\n\n`;
    resp += `**Desglose de eventos de seguridad:**\n`;
    Object.entries(stats.securityEvents).forEach(([event, count]) => {
      if (count > 0) resp += `  - ${event}: ${count}\n`;
    });
    
    if (PLC_STATE.control.securityLockdown) {
      resp += `\n🔴 **¡LOCKDOWN ACTIVO!** Razón: ${PLC_STATE.control.securityLockReason}\n`;
      resp += `Acción recomendada: Ir a Ciberseguridad → "Desbloquear Sistema"`;
    } else {
      resp += `\n✅ Sistema operando sin amenazas activas.`;
    }
    return resp;
  }

  // ─── MOTORES / ACTUADORES ───
  if (match(lowerMsg, ['motor', 'actuador', 'cinta', 'tolva', 'giro', 'belt'])) {
    let resp = `⚙️ **Estado de Actuadores**\n\n`;
    resp += `**Motores de Cintas:**\n`;
    resp += `  - MC0 (Cinta 0): ${outputs.MC0 ? '🟢 Activo' : '⚫ Inactivo'}\n`;
    resp += `  - MC1 (Cinta 1): ${outputs.MC1 ? '🟢 Activo' : '⚫ Inactivo'}\n`;
    resp += `  - MC2 (Cinta 2): ${outputs.MC2 ? '🟢 Activo' : '⚫ Inactivo'}\n`;
    resp += `  - MC3 (Cinta 3): ${outputs.MC3 ? '🟢 Activo' : '⚫ Inactivo'}\n\n`;
    resp += `**Motor de Giro:** ${outputs.MGIzq ? '↩️ Girando Izq' : outputs.MGDer ? '↪️ Girando Der' : '⚫ Detenido'}\n`;
    resp += `**Tolva:** ${outputs.MTolAb ? '🔓 Abriendo' : outputs.MTolCe ? '🔒 Cerrando' : '⚫ Detenida'} (${physical.hopperOpenPercent.toFixed(0)}%)\n`;
    resp += `**Ángulo plataforma:** ${physical.currentAngle.toFixed(1)}°\n`;
    resp += `**Posición destino:** ${physical.targetPosition}`;
    return resp;
  }

  // ─── MANTENIMIENTO ───
  if (match(lowerMsg, ['mantenimiento', 'preventivo', 'horas', 'ciclo', 'desgaste', 'vida util'])) {
    let resp = `🔧 **Informe de Mantenimiento Predictivo**\n\n`;
    resp += `**Horas de operación por motor:**\n`;
    Object.entries(stats.motorSeconds).forEach(([motor, secs]) => {
      const hrs = (secs / 3600).toFixed(2);
      const cycles = stats.motorCycles[motor] || 0;
      if (secs > 0) resp += `  - ${motor}: ${hrs}h (${cycles} ciclos)\n`;
    });
    
    resp += `\n**Tiempo total planta:** ${formatSeconds(physical.runTimeSeconds)}\n`;
    
    const maxMotor = Object.entries(stats.motorSeconds).sort((a,b) => b[1] - a[1])[0];
    if (maxMotor && maxMotor[1] > 0) {
      resp += `\n📌 **Motor con mayor desgaste:** ${maxMotor[0]} (${(maxMotor[1]/3600).toFixed(2)}h)`;
      if (maxMotor[1] > 36000) resp += `\n⚠️ Se recomienda inspección preventiva (>10h de operación)`;
    }
    return resp;
  }

  // ─── CONFIGURACIÓN / TEMPORIZADORES ───
  if (match(lowerMsg, ['configuracion', 'temporizador', 'parametro', 'config', 'ajuste', 'tiempo'])) {
    const cfg = PLC_STATE.config;
    let resp = `🔧 **Configuración Actual del PLC**\n\n`;
    resp += `• **Retardo apertura tolva:** ${cfg.hopperOpenDelay}s\n`;
    resp += `• **Tiempo vaciado Cinta 0:** ${cfg.cinta0DischargeTime}s\n`;
    resp += `• **Tiempo vaciado destino:** ${cfg.destDischargeTime}s\n`;
    resp += `• **Período sensor velocidad:** ${cfg.speedSensorPulsePeriod}ms\n\n`;
    resp += `Para modificar estos parámetros, ve a la pestaña **AJUSTES**.`;
    return resp;
  }

  // ─── AYUDA ───
  if (match(lowerMsg, ['ayuda', 'help', 'que puedes', 'como funciona', 'comandos', 'menu', 'opciones'])) {
    return `🤖 **Agente IA OT-Core — Comandos Disponibles**\n\n` +
      `Puedes preguntarme sobre:\n\n` +
      `📊 **"Estado general"** — Resumen completo del sistema\n` +
      `📈 **"OEE"** — Eficiencia global del equipo\n` +
      `🔔 **"Alarmas"** — Análisis de fallas y fiabilidad\n` +
      `⚡ **"Energía"** — Consumo y costos eléctricos\n` +
      `📦 **"Producción"** — Lotes, unidades, tasas\n` +
      `🛡️ **"Seguridad"** — Ciberseguridad y ataques\n` +
      `⚙️ **"Motores"** — Estado de actuadores\n` +
      `🔧 **"Mantenimiento"** — Desgaste y ciclos\n` +
      `⏱️ **"Configuración"** — Parámetros del PLC\n\n` +
      `También puedes usar las preguntas rápidas de abajo. ¡Pregúntame lo que necesites!`;
  }

  // ─── SALUDOS ───
  if (match(lowerMsg, ['hola', 'buenas', 'hey', 'saludos', 'buenos dias', 'buenas tardes', 'buenas noches'])) {
    return `👋 ¡Hola! Soy el **Agente IA OT-Core**, tu asistente inteligente para la planta industrial.\n\n` +
      `La planta está en estado **${status}** con un OEE de **${kpis.oee.toFixed(1)}%**.\n\n` +
      `¿En qué te puedo ayudar? Escribe **"ayuda"** para ver todos los comandos disponibles.`;
  }

  // ─── RESPUESTA POR DEFECTO (inteligente) ───
  let resp = `🤖 Entendí tu consulta: *"${msg}"*\n\n`;
  resp += `Aquí tienes un resumen rápido:\n`;
  resp += `• Estado: **${status}** | OEE: **${kpis.oee.toFixed(1)}%**\n`;
  resp += `• Lotes: **${kpis.batchesProcessed}** | Alarmas: **${rel.alarmSum}**\n`;
  resp += `• Energía: **${energy.totalKWh.toFixed(3)} kWh** ($${energy.totalCost.toFixed(2)})\n\n`;
  resp += `💡 Para respuestas más detalladas, prueba con: **estado**, **OEE**, **alarmas**, **energía**, **producción**, **seguridad**, **motores**, **mantenimiento** o **ayuda**.`;
  return resp;
}

// ─── UTILIDADES ───
function match(text, keywords) {
  return keywords.some(kw => text.includes(kw));
}

function formatSeconds(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
