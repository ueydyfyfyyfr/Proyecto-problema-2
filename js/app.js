import { initSimulation, PLC_STATE, handleNetworkMessage } from './plc-simulation.js';
import { sendSecureCommand, drawConveyorSystem, getNetworkTraffic, logNetworkTraffic } from './hmi-controller.js';
import { login, logout, getCurrentUser, checkPermission, createUser, deleteUser, getAllUsers, importUsersJSON } from './auth.js';
import { getLogs, clearLogs } from './audit-log.js';
import { generateNonce, generateHMAC } from './crypto-helper.js';
import { initDashboard } from './dashboard.js';
import { initChatWidget } from './chat-widget.js';

// Capturar última trama válida para ataque de replay
let lastValidPacket = null;

// Suscribirse a actualizaciones del tráfico de red
window.addEventListener('network-traffic-updated', (e) => {
  const entry = e.detail;
  if (entry.direction === 'SENT' && !entry.data.payload.user.includes('Hacker')) {
    lastValidPacket = entry.data; // Guardar la última trama legítima enviada
  }
  renderNetworkTraffic();
});

// Suscribirse a actualizaciones del log de auditoría
window.addEventListener('audit-log-updated', () => {
  renderAuditLogs();
});

// Función de actualización de la UI invocada en cada ciclo de la simulación
function updateUI(state) {
  const canvas = document.getElementById('plant-canvas');
  if (canvas) {
    drawConveyorSystem(canvas, state);
  }
  
  // Actualizar indicadores digitales y analógicos en la pantalla
  const elStatus = document.getElementById('state-display');
  if (elStatus) elStatus.innerText = state.control.status;
  
  const elAngle = document.getElementById('cinta0-angle');
  if (elAngle) elAngle.innerText = state.physical.currentAngle.toFixed(0);
  
  const elHopper = document.getElementById('hopper-percent');
  if (elHopper) elHopper.innerText = state.physical.hopperOpenPercent.toFixed(0) + '%';
  
  const elPos = document.getElementById('active-pos-lbl');
  if (elPos) elPos.innerText = `Posición ${state.physical.targetPosition}`;
  
  // Actualizar luces indicadoras LED en el panel
  updateLed('led-ls1', state.outputs.LS1, 'yellow');
  updateLed('led-ls2', state.outputs.LS2, 'yellow');
  updateLed('led-ls3', state.outputs.LS3, 'yellow');
  
  updateLed('led-lcon-c0', state.outputs.LConC0, 'green');
  updateLed('led-lcon-c1', state.outputs.LConC1, 'green');
  updateLed('led-lcon-c2', state.outputs.LConC2, 'green');
  updateLed('led-lcon-c3', state.outputs.LConC3, 'green');
  
  updateLed('led-ldes-c0', state.outputs.LDesC0, 'red-blink');
  updateLed('led-ldes-c1', state.outputs.LDesC1, 'red-blink');
  updateLed('led-ldes-c2', state.outputs.LDesC2, 'red-blink');
  updateLed('led-ldes-c3', state.outputs.LDesC3, 'red-blink');
  
  updateLed('led-ldescg-c1', state.outputs.LDescgC1, 'orange-blink');
  updateLed('led-ldescg-c2', state.outputs.LDescgC2, 'orange-blink');
  updateLed('led-ldescg-c3', state.outputs.LDescgC3, 'orange-blink');

  // Si parpadeo está activo, aplicar parpadeo dinámico a LDes
  if (state.control.status === 'ALARM') {
    const isLit = state.control.alarmBlinkState;
    for (let key in state.control.alarms) {
      if (state.control.alarms[key]) {
        const id = key === 'C0' ? 0 : parseInt(key[1]);
        const ledEl = document.getElementById(`led-ldes-c${id}`);
        if (ledEl) {
          ledEl.className = isLit ? 'status-led led-red' : 'status-led led-off';
        }
      }
    }
  }

  // Actualizar KPIs viejos si existen
  const elRt = document.getElementById('kpi-runtime');
  if (elRt) elRt.innerText = formatTime(state.physical.runTimeSeconds);
  
  const elBatches = document.getElementById('kpi-batches');
  if (elBatches) elBatches.innerText = state.physical.batchesProcessed;
  
  const elPwr = document.getElementById('kpi-power');
  if (elPwr) elPwr.innerText = state.physical.powerConsumptionKWh.toFixed(4) + ' kWh';
  
  const elCost = document.getElementById('kpi-cost');
  if (elCost) elCost.innerText = '$' + (state.physical.powerConsumptionKWh * 0.15).toFixed(4) + ' USD';
  
  // Actualizar controles de forzado en el panel del Ingeniero
  if (checkPermission('FORCE_ACTUATOR')) {
    updateForcedSwitches(state);
  }
}

// Auxiliar para actualizar luces LED
function updateLed(id, isActive, color) {
  const el = document.getElementById(id);
  if (!el) return;
  
  if (!isActive) {
    el.className = 'led-indicator led-off';
  } else {
    if (color === 'red-blink') {
      el.className = 'led-indicator led-red';
    } else if (color === 'orange-blink') {
      el.className = 'led-indicator led-orange';
    } else if (color === 'green') {
      el.className = 'led-indicator led-green';
    } else if (color === 'yellow') {
      el.className = 'led-indicator led-yellow';
    }
  }
}

function formatTime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Pintar la lista de logs de red
function renderNetworkTraffic() {
  const tbody = document.getElementById('network-traffic-logs');
  if (!tbody) return;
  
  const traffic = getNetworkTraffic();
  tbody.innerHTML = traffic.map(t => {
    const isSent = t.direction.startsWith('SENT');
    const badgeClass = isSent 
      ? (t.direction.includes('ATTACK') ? 'badge-attack' : 'badge-sent') 
      : 'badge-received';
    
    // Formatear payload de forma legible
    let payloadDesc = '';
    if (isSent) {
      const payload = t.data.payload;
      payloadDesc = `CMD: <strong>${payload.command}</strong> | Nonce: <code>${payload.nonce}</code> | HMAC: <code class="truncate-text">${t.data.hmac.slice(0, 10)}...</code>`;
    } else {
      payloadDesc = t.data.success 
        ? `<span class="text-success">OK: Comando Aceptado</span>`
        : `<span class="text-danger">RECHAZADO: ${t.data.error}</span>`;
    }
    
    return `
      <tr>
        <td>${t.timestamp}</td>
        <td><span class="badge ${badgeClass}">${t.direction}</span></td>
        <td>${payloadDesc}</td>
      </tr>
    `;
  }).join('');
}

// Pintar el registro de auditoría
function renderAuditLogs() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;
  
  if (!checkPermission('VIEW_AUDIT_LOG')) {
    container.innerHTML = `
      <div class="access-denied-message">
        <h3>🔒 Acceso Restringido</h3>
        <p>Solo los usuarios con el rol de **Ingeniero/Supervisor** pueden inspeccionar los registros de auditoría OT/IT.</p>
      </div>
    `;
    return;
  }
  
  const logs = getLogs();
  const tableRows = logs.map(l => {
    let typeClass = 'log-info';
    if (l.type === 'WARNING') typeClass = 'log-warning';
    if (l.type === 'SECURITY_ALERT') typeClass = 'log-security';
    if (l.type === 'CONFIG_CHANGE') typeClass = 'log-config';
    if (l.type === 'OPERATION') typeClass = 'log-op';
    
    return `
      <tr class="${typeClass}">
        <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
        <td><strong>${l.type}</strong></td>
        <td><code>${l.user}</code></td>
        <td>${l.message}</td>
      </tr>
    `;
  }).join('');
  
  container.innerHTML = `
    <div class="table-actions">
      <button class="btn btn-secondary btn-sm" id="btn-clear-logs">Limpiar Auditoría</button>
    </div>
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Usuario</th>
            <th>Descripción del Evento</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows.length > 0 ? tableRows : '<tr><td colspan="4" class="text-center">No hay registros de eventos.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  
  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    if (confirm('¿Está seguro de que desea limpiar todos los registros de auditoría?')) {
      clearLogs();
    }
  });
}

// Sincronizar el panel de forzado con el estado físico real
// Sincronizar el panel de forzado con el estado físico real (Deshabilitado, elementos UI eliminados)
function updateForcedSwitches(state) {
  // Ya no se dibujan estos interruptores en la nueva UI
}


// Configurar permisos de la interfaz basados en el rol activo
function applyRBACPermissions() {
  const user = getCurrentUser();
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const userRoleBadge = document.getElementById('user-role-badge');
  const userWelcome = document.getElementById('user-welcome-name');
  
  if (!user) {
    loginSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    return;
  }
  
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  
  userWelcome.innerText = user.name;
  userRoleBadge.innerText = user.role;
  userRoleBadge.className = `role-badge role-${user.role.toLowerCase()}`;
  
  // UX: Filtrar roles permitidos en el dropdown basado en la Pirámide
  const roleSelect = document.getElementById('ireg-role');
  if (roleSelect) {
    for (let i = 0; i < roleSelect.options.length; i++) {
      const val = roleSelect.options[i].value;
      if (!val) continue;
      
      let allowed = false;
      if (user.role === 'Admin' && val === 'Gerente') allowed = true;
      if (user.role === 'Gerente' && val === 'Supervisor') allowed = true;
      if (user.role === 'Supervisor' && val === 'Operador') allowed = true;
      
      roleSelect.options[i].disabled = !allowed;
      if (!allowed) {
        if (!roleSelect.options[i].text.includes('(Denegado)')) {
          roleSelect.options[i].text = roleSelect.options[i].text.split(' - ')[0] + ' - (Denegado)';
        }
      }
    }
  }
  
  // 1. Mostrar/Ocultar pestañas del panel
  const tabDash  = document.getElementById('tab-header-dashboard');
  const tabAnl   = document.getElementById('tab-header-analytics');
  const tabEng   = document.getElementById('tab-header-engineer');
  const tabMgr   = document.getElementById('tab-header-manager');
  const tabSec   = document.getElementById('tab-header-security');
  const tabUsers = document.getElementById('tab-header-users');
  
  if (user.role === 'Operador') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'none';
    if(tabAnl) tabAnl.style.display = 'none';
    if(tabMgr) tabMgr.style.display = 'none';
    if(tabSec) tabSec.style.display = 'none';
    if(tabUsers) tabUsers.style.display = 'none';
    switchTab('dashboard');
  } else if (user.role === 'Gerente') {
    if(tabDash) tabDash.style.display = 'none';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'none';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'none';
    if(tabUsers) tabUsers.style.display = 'inline-block'; 
    switchTab('analytics');
  } else if (user.role === 'Supervisor' || user.role === 'Ingeniero') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'inline-block';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'inline-block';
    if(tabUsers) tabUsers.style.display = 'inline-block';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    switchTab('dashboard');
  } else if (user.role === 'Admin') {
    if(tabDash) tabDash.style.display = 'inline-block';
    if(tabEng) tabEng.style.display = 'inline-block';
    if(tabMgr) tabMgr.style.display = 'inline-block';
    if(tabSec) tabSec.style.display = 'inline-block';
    if(tabUsers) tabUsers.style.display = 'inline-block';
    if(tabAnl) tabAnl.style.display = 'inline-block';
    switchTab('users');
  }
  
  // Habilitar/Deshabilitar botones de control en el HMI
  const basicControlsEnabled = checkPermission('BASIC_CONTROL');
  document.getElementById('btn-marcha').disabled = !basicControlsEnabled;
  document.getElementById('btn-paro').disabled = !basicControlsEnabled;
  document.getElementById('btn-selec').disabled = !basicControlsEnabled;
  document.getElementById('btn-emer').disabled = !basicControlsEnabled;
  document.getElementById('btn-reset-ci').disabled = !basicControlsEnabled;
  
  // Renderizar registros de auditoría si corresponde
  renderAuditLogs();
  
  // Cargar valores de temporizadores en el panel de Ingeniero
  if (user.role === 'Ingeniero' || user.role === 'Admin') {
    const hopperInput = document.getElementById('cfg-hopper-delay');
    if (hopperInput) hopperInput.value = PLC_STATE.config.hopperOpenDelay;
    const cinta0Input = document.getElementById('cfg-cinta0-time');
    if (cinta0Input) cinta0Input.value = PLC_STATE.config.cinta0DischargeTime;
    const destInput = document.getElementById('cfg-dest-time');
    if (destInput) destInput.value = PLC_STATE.config.destDischargeTime;
    
    // Cargar n8n configs
    const n8nUrlInput = document.getElementById('cfg-n8n-url');
    if (n8nUrlInput) n8nUrlInput.value = localStorage.getItem('n8n_url') || 'http://localhost:5678/webhook/hmi-ask';
    
    const n8nAuthInput = document.getElementById('cfg-n8n-auth-type');
    if (n8nAuthInput) n8nAuthInput.value = localStorage.getItem('n8n_auth_type') || 'basic';
    
    const n8nCredInput = document.getElementById('cfg-n8n-cred');
    if (n8nCredInput) n8nCredInput.value = localStorage.getItem('n8n_cred') || 'miguelalexander.urbina@unet.edu.ve:Madagascar=94';
  }
}

// Navegación de pestañas
function switchTab(tabId) {
  const tabs = ['dashboard', 'engineer', 'analytics', 'security', 'users'];
  tabs.forEach(t => {
    const pane = document.getElementById(`tab-${t}`);
    const btn  = document.getElementById(`tab-header-${t}`);
    if (pane) {
      pane.classList.toggle('hidden', t !== tabId);
      pane.classList.toggle('tab-active', t === tabId);
    }
    if (btn) {
      btn.classList.toggle('tab-active', t === tabId);
      // Ensure the click event is attached
      if (!btn.dataset.bound) {
        btn.addEventListener('click', () => switchTab(t));
        btn.dataset.bound = 'true';
      }
    }
  });
  if (tabId === 'engineer') renderAuditLogs();
  if (tabId === 'users')    renderUsersTable();
}

// -------------------------------------------------------------
// TABLA DE USUARIOS DEL SISTEMA
// -------------------------------------------------------------
async function renderUsersTable() {
  const container = document.getElementById('users-table-container');
  if (!container) return;

  if (!checkPermission('MANAGE_USERS') && getCurrentUser()?.role !== 'Gerente') {
    container.innerHTML = `<div class="access-denied-message">
      <h3>🔒 Acceso Restringido</h3>
      <p>Solo el rol <strong>Gerente</strong> puede gestionar usuarios del sistema.</p>
    </div>`;
    return;
  }

  const users = await getAllUsers();
  const rows = users.map(u => {
    const roleClass = u.role === 'Ingeniero' ? 'log-op' : (u.role === 'Gerente' ? 'log-warning' : 'log-info');
    const lockIcon  = u.isSystem ? '🔒' : '👤';
    const createdAt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('es') : 'Sistema';
    const deleteBtn = u.isSystem
      ? `<span style="font-size:11px;color:var(--text-muted);">Sistema</span>`
      : `<button class="btn btn-secondary btn-sm" style="color:#f87171;border:1px solid rgba(239,68,68,.25);" data-del="${u.username}">Eliminar</button>`;
    return `<tr class="${roleClass}">
      <td>${lockIcon} <strong>${u.username}</strong></td>
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td style="font-size:10px;font-family:monospace;color:var(--text-secondary);">${u.algo || 'PBKDF2-SHA256'}</td>
      <td>${createdAt}</td>
      <td>${deleteBtn}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-scroll">
      <table class="table">
        <thead><tr>
          <th>Usuario</th><th>Nombre</th><th>Rol</th><th>Algoritmo</th><th>Creado</th><th>Acción</th>
        </tr></thead>
        <tbody>${rows.length ? rows : '<tr><td colspan="6" class="text-center">Sin usuarios</td></tr>'}</tbody>
      </table>
    </div>`;

  container.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar al usuario "${btn.dataset.del}"?`)) return;
      try {
        await deleteUser(btn.dataset.del);
        renderUsersTable();
      } catch(e) { alert('Error: ' + e.message); }
    });
  });
}

// -------------------------------------------------------------
// EVENT BINDINGS (INICIALIZACIÓN DE LA APLICACIÓN)
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Inicializar simulación con callback de actualización
  initSimulation(updateUI);
  initDashboard();
  initChatWidget();
  
  // Comprobar si hay sesión previa
  // Control de Efectos de Sonido
  const btnSound = document.getElementById('btn-sound-toggle');
  if (btnSound) {
    const enabled = isSoundEnabled();
    btnSound.classList.toggle('muted', !enabled);
    btnSound.textContent = enabled ? '🔊 AUDIO' : '🔇 AUDIO';
    btnSound.addEventListener('click', () => {
      const newEnabled = !isSoundEnabled();
      setSoundEnabled(newEnabled);
      btnSound.classList.toggle('muted', !newEnabled);
      btnSound.textContent = newEnabled ? '🔊 AUDIO' : '🔇 AUDIO';
      if (newEnabled) playSound('click');
    });
  }
  
  // 1. Manejo del Login
  
  // Auto-completar el formulario por defecto con admin para facilitar el acceso inicial
  document.getElementById('login-username').value = 'admin';
  document.getElementById('login-password').value = 'admin123';
  
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Login form submitted!');
    const userVal  = document.getElementById('login-username').value;
    const passVal  = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');
    errorEl.innerText = 'Autenticando...';
    try {
      console.log('Attempting login for:', userVal);
      await login(userVal, passVal);
      console.log('Login successful, applying permissions...');
      applyRBACPermissions();
    } catch(err) {
      console.error('Login error:', err);
      errorEl.innerText = '⚠️ ' + err.message;
    }
  });

  
  // 2. Manejo de Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    logout();
    applyRBACPermissions();
  });

  // 3. Botones de Control HMI Seguro
  document.getElementById('btn-marcha').addEventListener('click', () => {
    sendSecureCommand('PMARCHA');
  });
  
  document.getElementById('btn-paro').addEventListener('click', () => {
    sendSecureCommand('PPARO');
  });
  
  document.getElementById('btn-selec').addEventListener('click', () => {
    sendSecureCommand('PSELEC');
  });
  
  document.getElementById('btn-emer').addEventListener('click', () => {
    sendSecureCommand('EMERGENCY');
  });
  
  document.getElementById('btn-reset-ci').addEventListener('click', () => {
    sendSecureCommand('RESET_CI');
  });
  
  // Desbloqueo del Firewall OT
  document.getElementById('btn-sec-reset').addEventListener('click', () => {
    sendSecureCommand('SECURITY_RESET');
  });

  // 4. Cambios de Configuración de Temporizadores (Ingeniero)
  const configForm = document.getElementById('config-timers-form');
  if (configForm) {
    configForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const hopperD = parseInt(document.getElementById('cfg-hopper-delay').value);
        const cint0T = parseInt(document.getElementById('cfg-cinta0-time').value);
        const destT = parseInt(document.getElementById('cfg-dest-time').value);
        
        const response = await sendSecureCommand('UPDATE_TIMERS', {
          hopperOpenDelay: hopperD,
          cinta0DischargeTime: cint0T,
          destDischargeTime: destT
        });
        
        if (response.success) {
          alert('Temporizadores actualizados y firmados correctamente.');
        } else {
          alert('Fallo de seguridad al actualizar: ' + response.error);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  // Eventos para Ajustes n8n
  const n8nForm = document.getElementById('config-n8n-form');
  if (n8nForm) {
    n8nForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('cfg-n8n-url').value;
      const type = document.getElementById('cfg-n8n-auth-type').value;
      const cred = document.getElementById('cfg-n8n-cred').value;
      
      localStorage.setItem('n8n_url', url);
      localStorage.setItem('n8n_auth_type', type);
      localStorage.setItem('n8n_cred', cred);
      
      alert('Configuración de n8n guardada localmente.');
    });
  }
  
  // 5. Forzado manual de actuadores (Ingeniero) (ELIMINADOS DE UI)
  // 6. Inyección de fallas de velocidad (Ingeniero) (ELIMINADOS DE UI)
  
  // 7. Enlace de los botones de pestañas
  const tabButtons = ['dashboard', 'engineer', 'manager', 'security', 'users', 'analytics'];
  tabButtons.forEach(t => {
    const btn = document.getElementById(`tab-header-${t}`);
    if (btn) btn.addEventListener('click', () => switchTab(t));
  });

  // 8. GESTIÓN DE USUARIOS INTEGRADA (Pestaña Usuarios)
  // Wrapped in try-catch: these elements may not exist in simplified HTML
  try {
    const iregPass  = document.getElementById('ireg-password');
    const iregPass2 = document.getElementById('ireg-password2');
    const sFill     = document.getElementById('ireg-strength-fill');
    const sLabel    = document.getElementById('ireg-strength-label');
    const matchHint = document.getElementById('ireg-match-hint');

    if (iregPass) {
      iregPass.addEventListener('input', () => {
        const p = iregPass.value;
        let score = 0;
        if (p.length >= 6)  score++;
        if (p.length >= 10) score++;
        if (/[A-Z]/.test(p)) score++;
        if (/[0-9]/.test(p)) score++;
        if (/[^A-Za-z0-9]/.test(p)) score++;
        const pct   = (score / 5) * 100;
        const colors = ['#ef4444','#f97316','#f59e0b','#10b981','#3b82f6'];
        const labels = ['Muy débil','Débil','Moderada','Fuerte','Muy fuerte'];
        const idx = Math.min(score, 4);
        if (sFill) { sFill.style.width = pct + '%'; sFill.style.backgroundColor = p.length ? colors[idx] : 'transparent'; }
        if (sLabel) { sLabel.textContent = p.length ? `Fortaleza: ${labels[idx]}` : 'Ingresa una contraseña'; sLabel.style.color = p.length ? colors[idx] : 'var(--text-secondary)'; }
        checkPasswordMatch();
      });
    }

    if (iregPass2) iregPass2.addEventListener('input', checkPasswordMatch);

    function checkPasswordMatch() {
      if (!iregPass || !iregPass2 || !matchHint) return;
      const p1 = iregPass.value, p2 = iregPass2.value;
      if (!p2) { matchHint.textContent = ''; return; }
      if (p1 === p2) {
        matchHint.textContent = '✔ Las contraseñas coinciden';
        matchHint.style.color = 'var(--accent-green)';
      } else {
        matchHint.textContent = '✕ Las contraseñas no coinciden';
        matchHint.style.color = '#f87171';
      }
    }

    // Toggle visibilidad de contraseña
    const togglePass = document.getElementById('ireg-toggle-pass');
    if (togglePass && iregPass) {
      togglePass.addEventListener('click', () => {
        const t = iregPass.type === 'password' ? 'text' : 'password';
        iregPass.type = t;
        togglePass.textContent = t === 'password' ? '👁' : '🙈';
      });
    }

    // Normalizar username a minúsculas
    const iregUsername = document.getElementById('ireg-username');
    if (iregUsername) {
      iregUsername.addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
      });
    }

    // Mostrar checklist solo para Operador
    const iregRoleSelect = document.getElementById('ireg-role');
    const opCapBox = document.getElementById('operador-capabilities-box');
    if (iregRoleSelect && opCapBox) {
      iregRoleSelect.addEventListener('change', (e) => {
        opCapBox.style.display = e.target.value === 'Operador' ? 'block' : 'none';
      });
    }

    // Formulario de creación de usuario con PBKDF2
    const inlineRegForm = document.getElementById('inline-register-form');
    if (inlineRegForm) {
      inlineRegForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('inline-register-error');
        const okEl  = document.getElementById('inline-register-success');
        if (errEl) errEl.innerText = ''; if (okEl) okEl.innerText = '';

        const name  = document.getElementById('ireg-fullname')?.value || '';
        const user  = document.getElementById('ireg-username')?.value || '';
        const pass  = iregPass ? iregPass.value : '';
        const pass2 = iregPass2 ? iregPass2.value : '';
        const role  = document.getElementById('ireg-role')?.value || 'Operador';

        if (pass !== pass2) { if (errEl) errEl.innerText = '⚠️ Las contraseñas no coinciden.'; return; }
        
        let capabilities = [];
        if (role === 'Operador') {
          capabilities.push('VIEW_ONLY');
          const capBasic = document.getElementById('cap-basic-control');
          const capSetpoints = document.getElementById('cap-change-setpoints');
          if (capBasic && capBasic.checked) capabilities.push('CONTROL_MANUAL');
          if (capSetpoints && capSetpoints.checked) capabilities.push('CHANGE_SETPOINTS');
        }

        const btn = document.getElementById('btn-ireg-submit');
        if (btn) { btn.disabled = true; btn.innerText = '⏳ Generando hash PBKDF2 (100k iteraciones)...'; }
        try {
          await createUser(user, pass, role, name, capabilities);
          if (okEl) okEl.innerText = `✔ Usuario "${user}" (${role}) creado con éxito.`;
          e.target.reset();
          if (opCapBox) opCapBox.style.display = 'none';
          if (sFill) sFill.style.width = '0';
          if (sLabel) sLabel.textContent = 'Ingresa una contraseña';
          if (matchHint) matchHint.textContent = '';
          renderUsersTable();
        } catch(err) {
          if (errEl) errEl.innerText = '⚠️ ' + err.message;
        } finally {
          if (btn) { btn.disabled = false; btn.innerText = '🔐 Crear Usuario (PBKDF2-SHA256)'; }
        }
      });
    }

    // Formulario simple (create-user-form) — el que realmente existe en el HTML
    const simpleForm = document.getElementById('create-user-form');
    if (simpleForm && !inlineRegForm) {
      simpleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const user = document.getElementById('ireg-user')?.value || '';
          const name = document.getElementById('ireg-name')?.value || '';
          const role = document.getElementById('ireg-role')?.value || 'Operador';
          const pass = document.getElementById('ireg-pass')?.value || '';
          await createUser(user, pass, role, name);
          alert(`✔ Usuario "${user}" (${role}) creado con éxito.`);
          e.target.reset();
          renderUsersTable();
        } catch(err) {
          alert('⚠️ ' + err.message);
        }
      });
    }

    // Exportar usuarios.json
    const btnExport = document.getElementById('btn-export-json');
    if (btnExport) {
      btnExport.addEventListener('click', async () => {
        const users = await getAllUsers();
        const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), generatedBy: 'Sistema OT — HMI Integrado (PBKDF2-SHA256)', users };
        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'usuarios.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showJsonIOMsg('ok', '✔ Archivo usuarios.json descargado.');
      });
    }

    // Copiar JSON al portapapeles
    const btnCopy = document.getElementById('btn-copy-json-users');
    if (btnCopy) {
      btnCopy.addEventListener('click', async () => {
        const users = await getAllUsers();
        const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), users };
        try {
          await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
          showJsonIOMsg('ok', '✔ JSON copiado al portapapeles.');
          showJsonPreview(jsonData);
        } catch(e) { showJsonIOMsg('err', 'No se pudo copiar. Usa HTTPS o localhost.'); }
      });
    }

    // Importar usuarios.json
    const btnImport = document.getElementById('ireg-import-file');
    if (btnImport) {
      btnImport.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const count = importUsersJSON(text);
          showJsonIOMsg('ok', `✔ ${count} usuario(s) importados desde "${file.name}".`);
          renderUsersTable();
          showJsonPreview(JSON.parse(text));
        } catch(err) { showJsonIOMsg('err', '⚠️ ' + err.message); }
        e.target.value = '';
      });
    }

    // Cerrar preview JSON
    const btnClosePreview = document.getElementById('btn-json-preview-close');
    if (btnClosePreview) {
      btnClosePreview.addEventListener('click', () => {
        const box = document.getElementById('json-preview-box');
        if (box) box.style.display = 'none';
      });
    }

    // Botón actualizar tabla
    const btnRefresh = document.getElementById('btn-refresh-users');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => { renderUsersTable(); });
    }
  } catch(userSectionError) {
    console.warn('[HMI] Sección de gestión de usuarios no disponible:', userSectionError.message);
  }

  // ─── Helpers de la pestaña Usuarios ───
  function showJsonIOMsg(type, text) {
    const el = document.getElementById('json-io-msg');
    el.style.color = type === 'ok' ? 'var(--accent-green)' : '#f87171';
    el.textContent = text;
    setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function showJsonPreview(data) {
    const box = document.getElementById('json-preview-box');
    const content = document.getElementById('json-preview-content');
    box.style.display = 'block';
    content.innerHTML = syntaxHighlightJSON(JSON.stringify(data, null, 2));
  }

  function syntaxHighlightJSON(json) {
    return json
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
        let cls = 'jn';
        if (/^"/.test(m)) cls = /:$/.test(m) ? 'jk' : 'js';
        else if (/true|false/.test(m)) cls = 'jb';
        return `<span class="${cls}">${m}</span>`;
      });
  }
  
  // -------------------------------------------------------------
  // ATAQUES DE PRUEBA DE VULNERABILIDAD (SANDBOX DE CIBERSEGURIDAD)
  // -------------------------------------------------------------
  
  // Ataque de trama no firmada
  const btnUnsigned = document.getElementById('btn-attack-unsigned');
  if (btnUnsigned) {
    btnUnsigned.addEventListener('click', async () => {
      const payload = {
        command: 'PMARCHA',
        user: 'Hacker (Unsigned Injection)',
        timestamp: Date.now(),
        nonce: generateNonce()
      };
      const packet = { payload }; // Sin hmac
      logNetworkTraffic('SENT (ATTACK)', packet);
      await handleNetworkMessage(JSON.stringify(packet));
    });
  }
  
  // Ataque de manipulación de datos (Tampering)
  const btnTampered = document.getElementById('btn-attack-tampered');
  if (btnTampered) {
    btnTampered.addEventListener('click', async () => {
      const payload = {
        command: 'PPARO',
        user: 'Hacker (Tampering)',
        timestamp: Date.now(),
        nonce: generateNonce()
      };
      const payloadStr = JSON.stringify(payload);
      const correctHmac = await generateHMAC(payloadStr, "PlcSuperSecretKeyOT2026!");
      payload.command = 'PMARCHA';
      payload.user = 'Hacker (Tampered Payload)';
      const packet = { payload, hmac: correctHmac };
      logNetworkTraffic('SENT (ATTACK)', packet);
      await handleNetworkMessage(JSON.stringify(packet));
    });
  }
  
  // Ataque de Replay
  const btnReplay = document.getElementById('btn-attack-replay');
  if (btnReplay) {
    btnReplay.addEventListener('click', async () => {
      if (!lastValidPacket) {
        alert('Primero debes enviar un comando legítimo en el Dashboard (ej. presionar Marcha) para interceptar y registrar una trama válida en tránsito.');
        return;
      }
      logNetworkTraffic('SENT (ATTACK - REPLAY)', lastValidPacket);
      await handleNetworkMessage(JSON.stringify(lastValidPacket));
    });
  }
});
