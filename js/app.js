import { initSimulation, PLC_STATE, handleNetworkMessage } from './plc-simulation.js';
import { sendSecureCommand, drawConveyorSystem, getNetworkTraffic, logNetworkTraffic } from './hmi-controller.js';
import { login, logout, getCurrentUser, checkPermission, createUser, deleteUser, getAllUsers, importUsersJSON } from './auth.js';
import { getLogs, clearLogs } from './audit-log.js';
import { generateNonce, generateHMAC } from './crypto-helper.js';

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
  document.getElementById('state-display').innerText = state.control.status;
  document.getElementById('cinta0-angle').innerText = state.physical.currentAngle.toFixed(0) + '°';
  document.getElementById('hopper-percent').innerText = state.physical.hopperOpenPercent.toFixed(0) + '%';
  document.getElementById('active-pos-lbl').innerText = `Posición ${state.physical.targetPosition}`;
  
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
          ledEl.className = isLit ? 'led-indicator led-red' : 'led-indicator led-off';
        }
      }
    }
  }

  // Actualizar KPIs y reportes
  document.getElementById('kpi-runtime').innerText = formatTime(state.physical.runTimeSeconds);
  document.getElementById('kpi-batches').innerText = state.physical.batchesProcessed;
  document.getElementById('kpi-power').innerText = state.physical.powerConsumptionKWh.toFixed(4) + ' kWh';
  
  // Costo financiero estimado: 0.15 USD por KWh
  const cost = state.physical.powerConsumptionKWh * 0.15;
  document.getElementById('kpi-cost').innerText = '$' + cost.toFixed(4) + ' USD';
  
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
function updateForcedSwitches(state) {
  const switches = [
    { id: 'force-mc0', output: 'MC0' },
    { id: 'force-mc1', output: 'MC1' },
    { id: 'force-mc2', output: 'MC2' },
    { id: 'force-mc3', output: 'MC3' },
    { id: 'force-mgizq', output: 'MGIzq' },
    { id: 'force-mgder', output: 'MGDer' },
    { id: 'force-mtolab', output: 'MTolAb' },
    { id: 'force-mtolce', output: 'MTolCe' },
  ];
  
  switches.forEach(sw => {
    const el = document.getElementById(sw.id);
    if (el) {
      el.checked = state.outputs[sw.output];
    }
  });
  
  const sensors = [
    { id: 'fail-vigc0', sensor: 'VigC0' },
    { id: 'fail-vigc1', sensor: 'VigC1' },
    { id: 'fail-vigc2', sensor: 'VigC2' },
    { id: 'fail-vigc3', sensor: 'VigC3' },
  ];
  
  sensors.forEach(sn => {
    const el = document.getElementById(sn.id);
    if (el) {
      el.checked = !state.inputs[sn.sensor]; // checked = sensor está fallando
    }
  });
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
  const tabEng   = document.getElementById('tab-header-engineer');
  const tabMgr   = document.getElementById('tab-header-manager');
  const tabSec   = document.getElementById('tab-header-security');
  const tabUsers = document.getElementById('tab-header-users');
  
  if (user.role === 'Operador') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'none';
    tabMgr.style.display = 'none';
    tabSec.style.display = 'none';
    tabUsers.style.display = 'none';
    switchTab('dashboard');
  } else if (user.role === 'Gerente') {
    tabDash.style.display = 'none'; // Acceso exclusivo a métricas
    tabEng.style.display = 'none';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'none';
    tabUsers.style.display = 'inline-block'; 
    switchTab('manager');
  } else if (user.role === 'Supervisor' || user.role === 'Ingeniero') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'inline-block';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'inline-block';
    tabUsers.style.display = 'inline-block';
    switchTab('dashboard');
  } else if (user.role === 'Admin') {
    tabDash.style.display = 'inline-block';
    tabEng.style.display = 'inline-block';
    tabMgr.style.display = 'inline-block';
    tabSec.style.display = 'inline-block';
    tabUsers.style.display = 'inline-block';
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
  if (user.role === 'Ingeniero') {
    document.getElementById('cfg-hopper-delay').value = PLC_STATE.config.hopperOpenDelay;
    document.getElementById('cfg-cinta0-time').value = PLC_STATE.config.cinta0DischargeTime;
    document.getElementById('cfg-dest-time').value = PLC_STATE.config.destDischargeTime;
  }
}

// Navegación de pestañas
function switchTab(tabId) {
  const tabs = ['dashboard', 'engineer', 'manager', 'security', 'users'];
  tabs.forEach(t => {
    const pane = document.getElementById(`tab-${t}`);
    const btn  = document.getElementById(`tab-header-${t}`);
    if (pane) pane.classList.toggle('hidden', t !== tabId);
    if (btn)  btn.classList.toggle('tab-active', t === tabId);
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
  
  // Comprobar si hay sesión previa
  applyRBACPermissions();
  
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
  document.getElementById('config-timers-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const hopper = document.getElementById('cfg-hopper-delay').value;
    const c0 = document.getElementById('cfg-cinta0-time').value;
    const dest = document.getElementById('cfg-dest-time').value;
    
    sendSecureCommand('CONFIG_UPDATE', {
      hopperOpenDelay: hopper,
      cinta0DischargeTime: c0,
      destDischargeTime: dest
    });
    alert('Temporizadores del PLC actualizados con éxito por firma digital.');
  });
  
  // 5. Forzado manual de actuadores (Ingeniero)
  const forceSwitches = [
    { id: 'force-mc0', output: 'MC0' },
    { id: 'force-mc1', output: 'MC1' },
    { id: 'force-mc2', output: 'MC2' },
    { id: 'force-mc3', output: 'MC3' },
    { id: 'force-mgizq', output: 'MGIzq' },
    { id: 'force-mgder', output: 'MGDer' },
    { id: 'force-mtolab', output: 'MTolAb' },
    { id: 'force-mtolce', output: 'MTolCe' },
  ];
  
  forceSwitches.forEach(sw => {
    document.getElementById(sw.id).addEventListener('change', (e) => {
      sendSecureCommand('FORCE_ACTUATOR', {
        output: sw.output,
        value: e.target.checked
      });
    });
  });
  
  // 6. Inyección de fallas de velocidad (Ingeniero)
  const failSensors = [
    { id: 'fail-vigc0', sensor: 'VigC0' },
    { id: 'fail-vigc1', sensor: 'VigC1' },
    { id: 'fail-vigc2', sensor: 'VigC2' },
    { id: 'fail-vigc3', sensor: 'VigC3' },
  ];
  
  failSensors.forEach(sn => {
    document.getElementById(sn.id).addEventListener('change', (e) => {
      sendSecureCommand('INJECT_FAULT', {
        sensor: sn.sensor,
        value: e.target.checked // true significa inyectar falla (sensor desactiva señal)
      });
    });
  });
  
  // 7. Enlace de los botones de pestañas
  const tabButtons = ['dashboard', 'engineer', 'manager', 'security', 'users'];
  tabButtons.forEach(t => {
    const btn = document.getElementById(`tab-header-${t}`);
    if (btn) btn.addEventListener('click', () => switchTab(t));
  });

  // 8. GESTIÓN DE USUARIOS INTEGRADA (Pestaña Usuarios)
  // ─── Medidor de fortaleza de contraseña ───
  const iregPass  = document.getElementById('ireg-password');
  const iregPass2 = document.getElementById('ireg-password2');
  const sFill     = document.getElementById('ireg-strength-fill');
  const sLabel    = document.getElementById('ireg-strength-label');
  const matchHint = document.getElementById('ireg-match-hint');

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
    sFill.style.width = pct + '%';
    sFill.style.backgroundColor = p.length ? colors[idx] : 'transparent';
    sLabel.textContent = p.length ? `Fortaleza: ${labels[idx]}` : 'Ingresa una contraseña';
    sLabel.style.color = p.length ? colors[idx] : 'var(--text-secondary)';
    checkPasswordMatch();
  });

  iregPass2.addEventListener('input', checkPasswordMatch);

  function checkPasswordMatch() {
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

  // ─── Toggle visibilidad de contraseña ───
  document.getElementById('ireg-toggle-pass').addEventListener('click', () => {
    const t = iregPass.type === 'password' ? 'text' : 'password';
    iregPass.type = t;
    document.getElementById('ireg-toggle-pass').textContent = t === 'password' ? '👁' : '🙈';
  });

  // ─── Normalizar username a minúsculas ───
  document.getElementById('ireg-username').addEventListener('input', (e) => {
    e.target.value = e.target.value.toLowerCase().replace(/\s+/g, '');
  });

  // ─── Lógica UI: Mostrar checklist solo para Operador ───
  const iregRoleSelect = document.getElementById('ireg-role');
  const opCapBox = document.getElementById('operador-capabilities-box');
  if (iregRoleSelect && opCapBox) {
    iregRoleSelect.addEventListener('change', (e) => {
      if (e.target.value === 'Operador') {
        opCapBox.style.display = 'block';
      } else {
        opCapBox.style.display = 'none';
      }
    });
  }

  // ─── Formulario de creación de usuario con PBKDF2 ───
  document.getElementById('inline-register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('inline-register-error');
    const okEl  = document.getElementById('inline-register-success');
    errEl.innerText = ''; okEl.innerText = '';

    const name  = document.getElementById('ireg-fullname').value;
    const user  = document.getElementById('ireg-username').value;
    const pass  = iregPass.value;
    const pass2 = iregPass2.value;
    const role  = document.getElementById('ireg-role').value;

    if (pass !== pass2) { errEl.innerText = '⚠️ Las contraseñas no coinciden.'; return; }
    
    let capabilities = [];
    if (role === 'Operador') {
      capabilities.push('VIEW_ONLY');
      if (document.getElementById('cap-basic-control').checked) capabilities.push('CONTROL_MANUAL');
      if (document.getElementById('cap-change-setpoints').checked) capabilities.push('CHANGE_SETPOINTS');
    }

    const btn = document.getElementById('btn-ireg-submit');
    btn.disabled = true;
    btn.innerText = '⏳ Generando hash PBKDF2 (100k iteraciones)...';
    try {
      await createUser(user, pass, role, name, capabilities);
      okEl.innerText = `✔ Usuario "${user}" (${role}) creado con éxito.`;
      e.target.reset();
      opCapBox.style.display = 'none';
      sFill.style.width = '0'; sLabel.textContent = 'Ingresa una contraseña';
      matchHint.textContent = '';
      renderUsersTable();
    } catch(err) {
      errEl.innerText = '⚠️ ' + err.message;
    } finally {
      btn.disabled = false;
      btn.innerText = '🔐 Crear Usuario (PBKDF2-SHA256)';
    }
  });

  // ─── Exportar usuarios.json ───
  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const users = await getAllUsers();
    const jsonData = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      generatedBy: 'Sistema OT — HMI Integrado (PBKDF2-SHA256)',
      users: users
    };
    const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'usuarios.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showJsonIOMsg('ok', '✔ Archivo usuarios.json descargado.');
  });

  // ─── Copiar JSON al portapapeles ───
  document.getElementById('btn-copy-json-users').addEventListener('click', async () => {
    const users = await getAllUsers();
    const jsonData = { version: '1.0', generatedAt: new Date().toISOString(), users };
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      showJsonIOMsg('ok', '✔ JSON copiado al portapapeles.');
      // Mostrar preview
      showJsonPreview(jsonData);
    } catch(e) {
      showJsonIOMsg('err', 'No se pudo copiar. Usa HTTPS o localhost.');
    }
  });

  // ─── Importar usuarios.json ───
  document.getElementById('ireg-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = importUsersJSON(text);
      showJsonIOMsg('ok', `✔ ${count} usuario(s) importados desde "${file.name}".`);
      renderUsersTable();
      // Mostrar preview del archivo importado
      showJsonPreview(JSON.parse(text));
    } catch(err) {
      showJsonIOMsg('err', '⚠️ ' + err.message);
    }
    e.target.value = '';
  });

  // ─── Cerrar preview JSON ───
  document.getElementById('btn-json-preview-close').addEventListener('click', () => {
    document.getElementById('json-preview-box').style.display = 'none';
  });

  // ─── Botón actualizar tabla ───
  document.getElementById('btn-refresh-users').addEventListener('click', () => {
    renderUsersTable();
  });

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
  document.getElementById('btn-attack-unsigned').addEventListener('click', async () => {
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
  
  // Ataque de manipulación de datos (Tampering)
  document.getElementById('btn-attack-tampered').addEventListener('click', async () => {
    // El atacante genera un comando legítimo de Parada, pero lo manipula para que sea Marcha sin conocer la clave secreta
    const payload = {
      command: 'PPARO',
      user: 'Hacker (Tampering)',
      timestamp: Date.now(),
      nonce: generateNonce()
    };
    const payloadStr = JSON.stringify(payload);
    // Generar HMAC válido para PPARO
    const correctHmac = await generateHMAC(payloadStr, "PlcSuperSecretKeyOT2026!");
    
    // Manipular el comando en el payload enviado
    payload.command = 'PMARCHA';
    payload.user = 'Hacker (Tampered Payload)';
    
    const packet = { payload, hmac: correctHmac };
    
    logNetworkTraffic('SENT (ATTACK)', packet);
    await handleNetworkMessage(JSON.stringify(packet));
  });
  
  // Ataque de Replay
  document.getElementById('btn-attack-replay').addEventListener('click', async () => {
    if (!lastValidPacket) {
      alert('Primero debes enviar un comando legítimo en el Dashboard (ej. presionar Marcha) para interceptar y registrar una trama válida en tránsito.');
      return;
    }
    
    logNetworkTraffic('SENT (ATTACK - REPLAY)', lastValidPacket);
    await handleNetworkMessage(JSON.stringify(lastValidPacket));
  });
});
