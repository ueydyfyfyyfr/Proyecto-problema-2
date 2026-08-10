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
export function logEvent(type, message, user = 'SYSTEM', details = null) {
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
export function getLogs() {
  if (!loaded) loadLogs();
  return auditLogs;
}

// Entradas posteriores a un instante dado. Acepta epoch en ms o fecha ISO.
export function getLogsSince(since) {
  if (!loaded) loadLogs();
  const cutoff = typeof since === 'number' ? since : new Date(since).getTime();
  if (isNaN(cutoff)) return [];
  return auditLogs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
}

// Entradas de un tipo concreto ('SECURITY_ALERT', 'OPERATION', 'CONFIG_CHANGE'...)
export function getLogsByType(type) {
  if (!loaded) loadLogs();
  return auditLogs.filter(l => l.type === type);
}

// Limpiar el registro de auditoría (solo accesible por Administrador / Ingeniero en simulación)
export function clearLogs() {
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
