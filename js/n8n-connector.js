import { computeKPIs, computeReliability, computeEnergy, computeSecurity } from './stats-engine.js';
import { getLogsSince, getLogsByType } from './audit-log.js';
import { PLC_STATE } from './plc-simulation.js';

const N8N_WEBHOOK_URL = 'https://agentes.henkki.co/webhook/hmi-ask'; // Configurable URL
let connectorActive = false;

export async function askAgent(message, history) {
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
  const cfgUrl = localStorage.getItem('n8n_url') || 'https://agentes.henkki.co/webhook/hmi-ask';
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
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
    
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

export function isAgentConnected() {
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
