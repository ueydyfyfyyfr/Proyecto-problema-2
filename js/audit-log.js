// Registro de auditoría para auditorías OT/IT y de seguridad

let auditLogs = [];

// Cargar logs guardados en localStorage para persistencia
function loadLogs() {
  const saved = localStorage.getItem('auditLogs');
  if (saved) {
    try {
      auditLogs = JSON.parse(saved);
    } catch (e) {
      auditLogs = [];
    }
  }
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
  loadLogs();
  return auditLogs;
}

// Limpiar el registro de auditoría (solo accesible por Administrador / Ingeniero en simulación)
export function clearLogs() {
  auditLogs = [];
  saveLogs();
  window.dispatchEvent(new CustomEvent('audit-log-updated', { detail: null }));
}

// Cargar logs iniciales
loadLogs();
