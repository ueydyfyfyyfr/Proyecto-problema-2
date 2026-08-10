import { verifyHMAC } from './crypto-helper.js';
import { logEvent } from './audit-log.js';

// -------------------------------------------------------------
// INSTRUMENTACIÓN: estructura de acumuladores (contrato TASKS.md §6.1)
// -------------------------------------------------------------

// Actuadores instrumentados de forma individual (8 salidas de motor)
export const MOTOR_KEYS = ['MC0', 'MC1', 'MC2', 'MC3', 'MGIzq', 'MGDer', 'MTolAb', 'MTolCe'];

// Estados contabilizados. 'SECURITY_LOCKDOWN' no pertenece a la máquina de estados
// del PLC: es un modo superpuesto que prevalece mientras el firewall OT mantiene el
// bloqueo, porque durante ese tiempo la planta está parada aunque control.status
// siga marcando otra cosa.
const STATE_KEYS = ['IDLE', 'ROTATING', 'RUNNING', 'DISCHARGING_C0', 'DISCHARGING_DEST', 'ALARM', 'EMERGENCY_LOCK', 'SECURITY_LOCKDOWN'];

// Motivos de rechazo codificados en el firewall OT
const SECURITY_REASONS = ['COMANDO_NO_FIRMADO', 'INTEGRIDAD_COMPROMETIDA', 'ATAQUE_REPLAY_DETECTADO', 'TRAMA_EXPIRADA', 'FORMATO_CORRUPTO'];

function zeroMap(keys) {
  const o = {};
  for (const k of keys) o[k] = 0;
  return o;
}

function createDefaultStats() {
  return {
    totalElapsedSeconds: 0,       // Tiempo de calendario: denominador de disponibilidad
    sessionStartedAt: Date.now(), // Marca de inicio de la sesión actual (no se restaura)

    stateTime: zeroMap(STATE_KEYS),    // Segundos acumulados en cada estado
    stateEntries: zeroMap(STATE_KEYS), // Número de entradas a cada estado

    alarmCount: { C0: 0, C1: 0, C2: 0, C3: 0 }, // Incrementado por flanco
    firstAlarmAt: null,
    lastAlarmAt: null,

    motorSeconds: zeroMap(MOTOR_KEYS), // Horas de servicio por actuador
    motorKWh: zeroMap(MOTOR_KEYS),     // Energía imputada a cada actuador
    motorCycles: zeroMap(MOTOR_KEYS),  // Arranques (flancos de subida)

    unitsTransferred: 0,                 // Partículas entregadas al destino
    batchesByDest: { 1: 0, 2: 0, 3: 0 }, // Ciclos productivos por posición
    scrapCount: 0,                       // Partículas perdidas con el destino parado

    commandCounts: {},                        // Comandos recibidos y verificados, por tipo
    rejectedCommands: {},                     // Comandos rechazados, por comando intentado
    securityEvents: zeroMap(SECURITY_REASONS),// Rechazos por tipo de ataque
    lockdownCount: 0,                         // Entradas en bloqueo del firewall OT

    hopperCycles: 0,        // Aperturas completas de la tolva (flancos de FCTolAb)
    totalDegreesRotated: 0, // Recorrido angular acumulado de MG (desgaste del reductor)

    loop: { ticks: 0, avgDtMs: 0, maxDtMs: 0, jitterMs: 0 } // Salud del bucle (no se restaura)
  };
}

// Restaura los acumulados guardados sobre la estructura por defecto. Toda clave
// ausente, no numérica o corrupta queda en su valor inicial, de modo que ampliar
// el contrato más adelante no rompe la carga de datos antiguos.
function mergeSavedStats(saved) {
  const fresh = createDefaultStats();
  if (!saved || typeof saved !== 'object') return fresh;

  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const intoMap = (target, src) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(target)) target[k] = num(src[k]);
  };

  fresh.totalElapsedSeconds = num(saved.totalElapsedSeconds);
  fresh.unitsTransferred = num(saved.unitsTransferred);
  fresh.scrapCount = num(saved.scrapCount);
  fresh.lockdownCount = num(saved.lockdownCount);
  fresh.hopperCycles = num(saved.hopperCycles);
  fresh.totalDegreesRotated = num(saved.totalDegreesRotated);
  fresh.firstAlarmAt = typeof saved.firstAlarmAt === 'number' ? saved.firstAlarmAt : null;
  fresh.lastAlarmAt = typeof saved.lastAlarmAt === 'number' ? saved.lastAlarmAt : null;

  intoMap(fresh.stateTime, saved.stateTime);
  intoMap(fresh.stateEntries, saved.stateEntries);
  intoMap(fresh.alarmCount, saved.alarmCount);
  intoMap(fresh.motorSeconds, saved.motorSeconds);
  intoMap(fresh.motorKWh, saved.motorKWh);
  intoMap(fresh.motorCycles, saved.motorCycles);
  intoMap(fresh.batchesByDest, saved.batchesByDest);
  intoMap(fresh.securityEvents, saved.securityEvents);

  // Mapas de claves abiertas: se copia únicamente lo que sea numérico
  for (const mapName of ['commandCounts', 'rejectedCommands']) {
    const src = saved[mapName];
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) fresh[mapName][k] = num(src[k]);
    }
  }

  // 'loop' y 'sessionStartedAt' describen la sesión en curso: no se restauran.
  return fresh;
}

// Estado de la iteración anterior, para detectar flancos y transiciones
let prevMotorState = {};
let prevEffectiveState = null;

// Variables de estado internas del PLC
export const PLC_STATE = {
  // Entradas físicas
  inputs: {
    PSelec: false,
    PMarcha: false,
    PParo: false,
    FC1: true,   // Inicialmente en Posición 1
    FC2: false,
    FC3: false,
    FCTolAb: false,
    FCTolCe: true, // Inicialmente cerrada
    VigC0: true,   // Sensores de velocidad OK
    VigC1: true,
    VigC2: true,
    VigC3: true,
  },
  
  // Salidas físicas (motores, luces, etc.)
  outputs: {
    LS1: true,   // Inicialmente seleccionada posición 1
    LS2: false,
    LS3: false,
    LConC0: false,
    LConC1: false,
    LConC2: false,
    LConC3: false,
    LDesC0: true, // Inicialmente desconectadas
    LDesC1: true,
    LDesC2: true,
    LDesC3: true,
    LDescgC1: false,
    LDescgC2: false,
    LDescgC3: false,
    MC0: false,   // Motores apagados
    MC1: false,
    MC2: false,
    MC3: false,
    MTolAb: false,
    MTolCe: false,
    MGIzq: false,
    MGDer: false,
  },
  
  // Variables operativas internas de la planta (física simulada)
  physical: {
    targetPosition: 1,        // Posición deseada (1, 2, 3)
    currentAngle: 0,          // Ángulo físico de Cinta 0 (0° = Pos 1, 90° = Pos 2, 180° = Pos 3)
    hopperOpenPercent: 0,     // 0 = cerrado, 100 = abierto
    materialOnCinta0: [],     // Partículas de material
    materialOnDest: [],
    runTimeSeconds: 0,        // Tiempo con al menos un motor activo (régimen activo)
    batchesProcessed: 0,      // Ciclos productivos completados (un ciclo = una descarga con material entregado)
    powerConsumptionKWh: 0,   // Consumo estimado
  },

  // Acumuladores de estadística (contrato completo en TASKS.md §6.1)
  stats: createDefaultStats(),

  // Configuración de temporizadores (ajustable por Ingeniero)
  config: {
    hopperOpenDelay: 5,       // Tiempo para abrir tolva tras M0 (segundos)
    cinta0DischargeTime: 20,  // Tiempo de vaciado Cinta 0 tras Paro (segundos)
    destDischargeTime: 20,    // Tiempo adicional de vaciado destino (segundos)
    speedSensorPulsePeriod: 100, // ms entre pulsos (10Hz)
  },
  
  // Estado interno del control secuencial del PLC (máquina de estados)
  control: {
    status: 'IDLE',          // 'IDLE', 'ROTATING', 'RUNNING', 'DISCHARGING_C0', 'DISCHARGING_DEST', 'ALARM', 'EMERGENCY_LOCK'
    timer: 0,                // Temporizador de control interno (ms)
    startupTimers: {         // Ventana de 5s sin evaluación de velocidad
      C0: 0,
      C1: 0,
      C2: 0,
      C3: 0
    },
    alarms: {
      C0: false,
      C1: false,
      C2: false,
      C3: false
    },
    alarmBlinkState: false,  // Alternador para el parpadeo
    securityLockdown: false, // Bloqueo por intrusión detectada
    securityLockReason: '',
    cycleProducedMaterial: false // El ciclo en curso ha entregado material al destino
  }
};

// Configuración de negocio (tarifa eléctrica, factor de emisión, potencia nominal).
// Persistida en localStorage['businessConfig']; editable desde la UI a partir de F5.
export const BUSINESS_CONFIG = {
  tariffUSDPerKWh: 0.15,
  co2KgPerKWh: 0.4,
  motorRatedKW: 1.5
};

function loadBusinessConfig() {
  const saved = localStorage.getItem('businessConfig');
  if (saved) {
    try {
      Object.assign(BUSINESS_CONFIG, JSON.parse(saved));
    } catch (e) {}
  }
}

// Clave secreta compartida del PLC (para autenticar comandos HMI)
var PLC_SHARED_SECRET = "PlcSuperSecretKeyOT2026!";

// Registro de Nonces recibidos para prevenir ataques de Replay (nonce → instante de recepción)
const receivedNonces = new Map();
const maxNonceAgeMs = 60000; // Rechazar comandos con timestamps mayores a 60 segundos

// Purga los nonces fuera de la ventana de validez. La ventana es exactamente la misma
// que la de validación de timestamp, así que un nonce purgado ya no puede reutilizarse:
// su trama sería rechazada por 'TRAMA_EXPIRADA'.
function purgeExpiredNonces() {
  const cutoff = Date.now() - maxNonceAgeMs;
  for (const [nonce, seenAt] of receivedNonces) {
    if (seenAt < cutoff) receivedNonces.delete(nonce);
  }
}

// Iniciar simulación física
let simInterval = null;
let flushInterval = null;

// Inicializa o reinicia la simulación
export function initSimulation(onStateUpdate) {
  if (simInterval) clearInterval(simInterval);
  if (flushInterval) clearInterval(flushInterval);

  loadBusinessConfig();

  // Cargar configuraciones guardadas
  const savedConfig = localStorage.getItem('plcConfig');
  if (savedConfig) {
    try {
      PLC_STATE.config = { ...PLC_STATE.config, ...JSON.parse(savedConfig) };
    } catch(e) {}
  }
  
  // Cargar métricas acumuladas
  const savedMetrics = localStorage.getItem('plcMetrics');
  if (savedMetrics) {
    try {
      const m = JSON.parse(savedMetrics);
      PLC_STATE.physical.runTimeSeconds = m.runTimeSeconds || 0;
      PLC_STATE.physical.batchesProcessed = m.batchesProcessed || 0;
      PLC_STATE.physical.powerConsumptionKWh = m.powerConsumptionKWh || 0;
    } catch(e) {}
  }

  // Cargar acumuladores de estadística con merge defensivo
  let parsedStats = null;
  const savedStats = localStorage.getItem('plcStats');
  if (savedStats) {
    try { parsedStats = JSON.parse(savedStats); } catch(e) {}
  }
  PLC_STATE.stats = mergeSavedStats(parsedStats);

  // Reiniciar los detectores de flanco de la sesión anterior
  prevMotorState = {};
  prevEffectiveState = null;

  // Guardado periódico de métricas (sustituye a la escritura por ciclo)
  flushInterval = setInterval(flushMetrics, 5000);

  // Bucle de simulación a 50 FPS (cada 20 ms)
  let lastTime = Date.now();
  simInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000; // Diferencial de tiempo en segundos
    lastTime = now;

    // La estadística se actualiza antes que nada y aislada del control: ninguna
    // salida temprana de la lógica del PLC debe hacerle perder tiempo, y ningún
    // fallo suyo puede llegar a detener la planta.
    try {
      updateStats(dt);
    } catch (e) {
      console.warn('Fallo al acumular estadística (el control continúa):', e.message);
    }

    updatePhysics(dt);
    updatePLCLogic(dt);
    
    if (onStateUpdate) onStateUpdate(PLC_STATE);
  }, 20);
}

// Estado atribuible a efectos de estadística. El bloqueo del firewall OT prevalece
// sobre la máquina de estados: mientras dura, la planta está parada aunque
// control.status conserve el valor que tuviera al producirse la intrusión.
export function effectiveState() {
  return PLC_STATE.control.securityLockdown ? 'SECURITY_LOCKDOWN' : PLC_STATE.control.status;
}

// Acumuladores que deben avanzar en cada ciclo pase lo que pase en la lógica de control.
function updateStats(dt) {
  const s = PLC_STATE.stats;

  // Tiempo de calendario: avanza siempre, haya o no motores activos
  s.totalElapsedSeconds += dt;

  // Tiempo por estado y detección de transición
  const state = effectiveState();
  if (s.stateTime[state] === undefined) s.stateTime[state] = 0;
  s.stateTime[state] += dt;

  if (state !== prevEffectiveState) {
    s.stateEntries[state] = (s.stateEntries[state] || 0) + 1;
    window.dispatchEvent(new CustomEvent('plc-state-change', {
      detail: { from: prevEffectiveState, to: state, at: Date.now() }
    }));
    prevEffectiveState = state;
  }

  // Salud del bucle: media móvil exponencial de dt y desviación respecto a los 20 ms
  // nominales. Solo es representativa con la pestaña en primer plano: en segundo
  // plano el navegador estrangula setInterval y dt se dispara.
  const dtMs = dt * 1000;
  s.loop.ticks++;
  s.loop.avgDtMs = s.loop.ticks === 1 ? dtMs : s.loop.avgDtMs + (dtMs - s.loop.avgDtMs) * 0.05;
  s.loop.jitterMs = Math.abs(s.loop.avgDtMs - 20);
  if (dtMs > s.loop.maxDtMs) s.loop.maxDtMs = dtMs;
}

// Simulación de la física del sistema (movimiento real, tolva, material)
function updatePhysics(dt) {
  const angleBefore = PLC_STATE.physical.currentAngle;
  const hopperFullyOpenBefore = PLC_STATE.inputs.FCTolAb;

  // 1. Simulación del giro de la plataforma (MG)
  const targetAngle = (PLC_STATE.physical.targetPosition - 1) * 90; // Pos1=0, Pos2=90, Pos3=180
  const rotationSpeed = 45; // 45 grados por segundo
  
  if (PLC_STATE.outputs.MGDer) {
    PLC_STATE.physical.currentAngle += rotationSpeed * dt;
    if (PLC_STATE.physical.currentAngle >= targetAngle) {
      PLC_STATE.physical.currentAngle = targetAngle;
    }
  } else if (PLC_STATE.outputs.MGIzq) {
    PLC_STATE.physical.currentAngle -= rotationSpeed * dt;
    if (PLC_STATE.physical.currentAngle <= targetAngle) {
      PLC_STATE.physical.currentAngle = targetAngle;
    }
  }
  
  // Actualizar los finales de carrera físicos según el ángulo
  PLC_STATE.inputs.FC1 = Math.abs(PLC_STATE.physical.currentAngle - 0) < 1;
  PLC_STATE.inputs.FC2 = Math.abs(PLC_STATE.physical.currentAngle - 90) < 1;
  PLC_STATE.inputs.FC3 = Math.abs(PLC_STATE.physical.currentAngle - 180) < 1;

  // Recorrido angular acumulado del motor de giro (base del desgaste del reductor)
  PLC_STATE.stats.totalDegreesRotated += Math.abs(PLC_STATE.physical.currentAngle - angleBefore);

  // 2. Simulación de la compuerta de la Tolva
  const hopperSpeed = 50; // 50% por segundo
  if (PLC_STATE.outputs.MTolAb) {
    PLC_STATE.physical.hopperOpenPercent += hopperSpeed * dt;
    if (PLC_STATE.physical.hopperOpenPercent >= 100) {
      PLC_STATE.physical.hopperOpenPercent = 100;
    }
  } else if (PLC_STATE.outputs.MTolCe) {
    PLC_STATE.physical.hopperOpenPercent -= hopperSpeed * dt;
    if (PLC_STATE.physical.hopperOpenPercent <= 0) {
      PLC_STATE.physical.hopperOpenPercent = 0;
    }
  }
  
  // Finales de carrera de la tolva
  PLC_STATE.inputs.FCTolAb = PLC_STATE.physical.hopperOpenPercent >= 99;
  PLC_STATE.inputs.FCTolCe = PLC_STATE.physical.hopperOpenPercent <= 1;

  // Flanco de apertura completa: un ciclo de tolva
  if (!hopperFullyOpenBefore && PLC_STATE.inputs.FCTolAb) {
    PLC_STATE.stats.hopperCycles++;
  }

  // 3. Simulación de flujo de material en las cintas
  // Generar material desde la tolva si está abierta y las cintas están activas
  if (PLC_STATE.physical.hopperOpenPercent > 10 && PLC_STATE.outputs.MC0) {
    // Generar partículas aleatorias en la entrada de Cinta 0
    if (Math.random() < 0.15) {
      PLC_STATE.physical.materialOnCinta0.push({ x: 0, y: 15 });
    }
  }
  
  // Mover material en Cinta 0
  if (PLC_STATE.outputs.MC0 && PLC_STATE.control.status !== 'ALARM') {
    PLC_STATE.physical.materialOnCinta0.forEach(m => {
      m.x += 1.5 * dt; // velocidad de avance
    });
    
    // Transferencia de Cinta 0 a la cinta de destino correspondiente al ángulo actual
    PLC_STATE.physical.materialOnCinta0 = PLC_STATE.physical.materialOnCinta0.filter(m => {
      if (m.x >= 1.0) { // Fin de Cinta 0
        const activeDest = PLC_STATE.physical.targetPosition;
        const destMotor = PLC_STATE.outputs[`MC${activeDest}`];
        if (destMotor) {
          PLC_STATE.physical.materialOnDest.push({
            cinta: activeDest,
            x: 0,
            y: 10 + Math.random() * 10
          });
          // Unidad física entregada. El lote (evento de negocio) se contabiliza
          // al cerrar el ciclo productivo, no aquí.
          PLC_STATE.stats.unitsTransferred++;
          PLC_STATE.control.cycleProducedMaterial = true;
        } else {
          // La cinta de destino está parada: el material cae al vacío y se pierde
          PLC_STATE.stats.scrapCount++;
        }
        return false; // Remover de Cinta 0
      }
      return true;
    });
  }
  
  // Mover material en las Cintas de Destino (1, 2, 3)
  PLC_STATE.physical.materialOnDest.forEach(m => {
    const motorActive = PLC_STATE.outputs[`MC${m.cinta}`];
    if (motorActive) {
      m.x += 1.2 * dt;
    }
  });
  
  // Eliminar material del final de las cintas de salida
  PLC_STATE.physical.materialOnDest = PLC_STATE.physical.materialOnDest.filter(m => m.x < 1.0);
  
  // 4. Acumular métricas operativas
  // Un único recorrido por los 8 actuadores alimenta a la vez el desglose por motor
  // y el total de planta, de modo que la suma de motorKWh cuadra con
  // powerConsumptionKWh por construcción y no por coincidencia.
  let activeMotorsCount = 0;
  let instantKW = 0;

  for (const key of MOTOR_KEYS) {
    const isOn = !!PLC_STATE.outputs[key];

    if (isOn) {
      activeMotorsCount++;
      instantKW += BUSINESS_CONFIG.motorRatedKW;
      PLC_STATE.stats.motorSeconds[key] += dt;
      PLC_STATE.stats.motorKWh[key] += (BUSINESS_CONFIG.motorRatedKW * dt) / 3600;
    }

    // Flanco de subida: un arranque del actuador
    if (isOn && !prevMotorState[key]) {
      PLC_STATE.stats.motorCycles[key]++;
    }
    prevMotorState[key] = isOn;
  }

  if (activeMotorsCount > 0) {
    PLC_STATE.physical.runTimeSeconds += dt;
    PLC_STATE.physical.powerConsumptionKWh += (instantKW * dt) / 3600;
  }
  // La persistencia NO se hace aquí: ver flushMetrics(), invocado cada 5 s
  // y en eventos clave. Escribir en localStorage a 50 Hz degradaba la UI.
}

// Persiste los acumulados en localStorage. Invocada por temporizador cada 5 s y
// en eventos clave: cierre de ciclo, alarma, bloqueo de seguridad y cierre de sesión.
export function flushMetrics() {
  try {
    localStorage.setItem('plcMetrics', JSON.stringify({
      runTimeSeconds: PLC_STATE.physical.runTimeSeconds,
      batchesProcessed: PLC_STATE.physical.batchesProcessed,
      powerConsumptionKWh: PLC_STATE.physical.powerConsumptionKWh
    }));
    localStorage.setItem('plcStats', JSON.stringify(PLC_STATE.stats));
  } catch (e) {
    console.warn('No se pudieron guardar las métricas:', e.message);
  }
}

// Cierra el ciclo productivo en curso. Cuenta el lote solo si llegó a entregarse
// material a la cinta de destino; un ciclo abortado en vacío no suma.
function finishProductionCycle(destPosition) {
  if (PLC_STATE.control.cycleProducedMaterial) {
    PLC_STATE.physical.batchesProcessed++;
    PLC_STATE.stats.batchesByDest[destPosition] = (PLC_STATE.stats.batchesByDest[destPosition] || 0) + 1;
    PLC_STATE.control.cycleProducedMaterial = false;
  }
  flushMetrics();
}

// Descarta el ciclo en curso sin contabilizarlo (acuse de alarma, retorno a CI).
function discardProductionCycle() {
  PLC_STATE.control.cycleProducedMaterial = false;
}

// Lógica de control secuencial del PLC (Programa de automatización)
function updatePLCLogic(dt) {
  if (PLC_STATE.control.securityLockdown) {
    // Si hay un bloqueo por intrusión cibernética, apagamos todos los motores como medida de seguridad activa
    stopAllMotors();
    return;
  }

  // Manejo de temporizador general
  if (PLC_STATE.control.timer > 0) {
    PLC_STATE.control.timer -= dt * 1000;
  }
  
  // Manejo de parpadeo de alarmas
  const now = Date.now();
  PLC_STATE.control.alarmBlinkState = Math.floor(now / 250) % 2 === 0; // Frecuencia de 2 Hz (ciclo total 500ms)

  // Ventana de 3 segundos sin evaluar velocidad al arrancar motores
  for (let key in PLC_STATE.control.startupTimers) {
    if (PLC_STATE.control.startupTimers[key] > 0) {
      PLC_STATE.control.startupTimers[key] -= dt * 1000;
    }
  }

  // 1. Evaluación de fallas de velocidad (Vigilancia de cintas)
  // Ignoramos durante los primeros 3 segundos de arranque.
  // 'ALARM' queda excluido: la planta ya está detenida y reevaluar allí permitía
  // que un motor forzado sobre un sensor en falla disparase la alarma cada 20 ms.
  if (PLC_STATE.control.status !== 'IDLE' && PLC_STATE.control.status !== 'ROTATING' && PLC_STATE.control.status !== 'ALARM' && PLC_STATE.control.status !== 'EMERGENCY_LOCK') {
    // Verificar Cinta 0
    if (PLC_STATE.outputs.MC0 && PLC_STATE.control.startupTimers.C0 <= 0 && !PLC_STATE.inputs.VigC0) {
      triggerAlarm('C0', 'Pérdida de velocidad en Cinta 0 (VigC0 bajo)');
    }
    // Verificar cinta de destino activa
    const activeDest = PLC_STATE.physical.targetPosition;
    if (PLC_STATE.outputs[`MC${activeDest}`] && PLC_STATE.control.startupTimers[`C${activeDest}`] <= 0 && !PLC_STATE.inputs[`VigC${activeDest}`]) {
      triggerAlarm(`C${activeDest}`, `Pérdida de velocidad en Cinta de Destino ${activeDest}`);
    }
  }

  // 2. Máquina de estados principal del PLC
  switch (PLC_STATE.control.status) {
    case 'IDLE':
      // Asegurar que salidas correspondientes a reposo estén activas
      stopAllMotors();
      updateStatusLamps();
      break;
      
    case 'ROTATING':
      // Se está posicionando la Cinta 0 con MG
      const targetPos = PLC_STATE.physical.targetPosition;
      const currentPosLimit = PLC_STATE.inputs[`FC${targetPos}`];
      
      if (currentPosLimit) {
        // Alcanzó la posición correcta! Detener giro de MG
        PLC_STATE.outputs.MGIzq = false;
        PLC_STATE.outputs.MGDer = false;
        
        // Arrancar Cinta 0 y la cinta de destino activa
        PLC_STATE.outputs.MC0 = true;
        PLC_STATE.outputs[`MC${targetPos}`] = true;
        
        // Activar lámparas de conexión
        PLC_STATE.outputs.LConC0 = true;
        PLC_STATE.outputs[`LConC${targetPos}`] = true;
        PLC_STATE.outputs.LDesC0 = false;
        PLC_STATE.outputs[`LDesC${targetPos}`] = false;
        
        // Iniciar ventanas de 3s para ignorar vigilancia
        PLC_STATE.control.startupTimers.C0 = 3000;
        PLC_STATE.control.startupTimers[`C${targetPos}`] = 3000;
        
        // Iniciar temporizador de 5 segundos para abrir la tolva
        PLC_STATE.control.timer = PLC_STATE.config.hopperOpenDelay * 1000;
        PLC_STATE.control.status = 'RUNNING';
        
        logEvent('INFO', `Cinta 0 alineada en posición ${targetPos}. Motores MC0 y MC${targetPos} iniciados.`, 'PLC');
      } else {
        // Determinar sentido de giro de MG
        const currentAngle = PLC_STATE.physical.currentAngle;
        const targetAngle = (targetPos - 1) * 90;
        if (currentAngle < targetAngle) {
          PLC_STATE.outputs.MGDer = true;
          PLC_STATE.outputs.MGIzq = false;
        } else {
          PLC_STATE.outputs.MGIzq = true;
          PLC_STATE.outputs.MGDer = false;
        }
      }
      break;
      
    case 'RUNNING':
      // Estado normal de funcionamiento
      // Tras 5 segundos, abrir la tolva
      if (PLC_STATE.control.timer <= 0 && !PLC_STATE.outputs.MTolAb && !PLC_STATE.inputs.FCTolAb) {
        PLC_STATE.outputs.MTolAb = true;
        PLC_STATE.outputs.MTolCe = false;
        logEvent('INFO', 'Iniciando apertura de tolva de alimentación.', 'PLC');
      }
      if (PLC_STATE.inputs.FCTolAb) {
        PLC_STATE.outputs.MTolAb = false; // Detener motor tolva al llegar al final
      }
      updateStatusLamps();
      break;
      
    case 'DISCHARGING_C0':
      // Proceso de parada: tolva cerrada, Cinta 0 descargando por 20 segundos
      if (PLC_STATE.inputs.FCTolCe) {
        PLC_STATE.outputs.MTolCe = false;
      }
      
      if (PLC_STATE.control.timer <= 0) {
        // Finalizó descarga de Cinta 0, apagar MC0
        PLC_STATE.outputs.MC0 = false;
        PLC_STATE.outputs.LConC0 = false;
        PLC_STATE.outputs.LDesC0 = true;
        
        // Iniciar temporizador para la cinta de destino activa (20s adicionales)
        PLC_STATE.control.timer = PLC_STATE.config.destDischargeTime * 1000;
        PLC_STATE.control.status = 'DISCHARGING_DEST';
        logEvent('INFO', 'Descarga de Cinta 0 completada. Motor MC0 apagado. Iniciando vaciado de cinta de destino.', 'PLC');
      }
      updateStatusLamps();
      break;
      
    case 'DISCHARGING_DEST':
      // Proceso de parada: cinta de destino activa corriendo por 20s más
      if (PLC_STATE.control.timer <= 0) {
        // Parar el motor de destino y volver a IDLE
        const activeDest = PLC_STATE.physical.targetPosition;
        PLC_STATE.outputs[`MC${activeDest}`] = false;
        PLC_STATE.outputs[`LConC${activeDest}`] = false;
        PLC_STATE.outputs[`LDesC${activeDest}`] = true;
        
        PLC_STATE.control.status = 'IDLE';
        finishProductionCycle(activeDest);
        logEvent('INFO', `Descarga de Cinta de Destino ${activeDest} completada. Proceso en REPOSO.`, 'PLC');
      }
      updateStatusLamps();
      break;
      
    case 'ALARM':
      // Estado de falla de velocidad (Parada automática de la cinta afectada)
      // El acuse de recibo se realiza pulsando "Paro"
      updateAlarmBlinkLamps();
      break;
      
    case 'EMERGENCY_LOCK':
      // Parada de Emergencia: todas las cintas paradas, luces de descarga encendidas
      stopAllMotors();
      // Lámparas de descarga encendidas y el resto apagadas
      PLC_STATE.outputs.LDescgC1 = true;
      PLC_STATE.outputs.LDescgC2 = true;
      PLC_STATE.outputs.LDescgC3 = true;
      
      PLC_STATE.outputs.LConC0 = false;
      PLC_STATE.outputs.LConC1 = false;
      PLC_STATE.outputs.LConC2 = false;
      PLC_STATE.outputs.LConC3 = false;
      
      PLC_STATE.outputs.LDesC0 = false;
      PLC_STATE.outputs.LDesC1 = false;
      PLC_STATE.outputs.LDesC2 = false;
      PLC_STATE.outputs.LDesC3 = false;
      break;
  }
}

// Configura la iluminación de las lámparas de descarga y conexión en funcionamiento normal / descarga
function updateStatusLamps() {
  const activeDest = PLC_STATE.physical.targetPosition;
  
  // Inicialmente apagar todas las lámparas de descarga
  PLC_STATE.outputs.LDescgC1 = false;
  PLC_STATE.outputs.LDescgC2 = false;
  PLC_STATE.outputs.LDescgC3 = false;
  
  if (PLC_STATE.control.status === 'DISCHARGING_C0') {
    // Encender lámparas de descarga correspondientes
    PLC_STATE.outputs[`LDescgC${activeDest}`] = true;
    
    // Luces de conexión: C0 sigue activa, destino sigue activa
    PLC_STATE.outputs.LConC0 = true;
    PLC_STATE.outputs[`LConC${activeDest}`] = true;
  } else if (PLC_STATE.control.status === 'DISCHARGING_DEST') {
    PLC_STATE.outputs[`LDescgC${activeDest}`] = true;
    PLC_STATE.outputs.LConC0 = false;
    PLC_STATE.outputs.LDesC0 = true;
    PLC_STATE.outputs[`LConC${activeDest}`] = true;
  }
}

// Maneja el parpadeo de las lámparas en caso de alarma OT
function updateAlarmBlinkLamps() {
  const blink = PLC_STATE.control.alarmBlinkState;
  
  // Parpadeo a 2 Hz de la lámpara de desconexión de la cinta averiada
  for (let key in PLC_STATE.control.alarms) {
    if (PLC_STATE.control.alarms[key]) {
      const idx = key === 'C0' ? 0 : parseInt(key[1]);
      // Si la falla es en descarga, parpadea LDescg correspondiente
      if (PLC_STATE.outputs[`LDescgC${idx}`]) {
        PLC_STATE.outputs[`LDescgC${idx}`] = blink;
      } else {
        // En normal, parpadea LDes correspondiente
        PLC_STATE.outputs[`LDesC${idx}`] = blink;
      }
    }
  }
}

// Apagar todos los actuadores / motores
function stopAllMotors() {
  PLC_STATE.outputs.MC0 = false;
  PLC_STATE.outputs.MC1 = false;
  PLC_STATE.outputs.MC2 = false;
  PLC_STATE.outputs.MC3 = false;
  PLC_STATE.outputs.MTolAb = false;
  PLC_STATE.outputs.MTolCe = false;
  PLC_STATE.outputs.MGIzq = false;
  PLC_STATE.outputs.MGDer = false;
}

// Activar alarma OT de velocidad
function triggerAlarm(beltKey, msg) {
  // Idempotente: si la alarma de esa cinta ya está activa no se repite el evento.
  // Sin esto, el contador de alarmas y el MTBF/MTTR quedarían falseados.
  if (PLC_STATE.control.alarms[beltKey]) return;

  PLC_STATE.control.status = 'ALARM';
  PLC_STATE.control.alarms[beltKey] = true;

  // Contabilización por flanco: base de MTBF, MTTR y "alarmas por cinta"
  const alarmAt = Date.now();
  PLC_STATE.stats.alarmCount[beltKey] = (PLC_STATE.stats.alarmCount[beltKey] || 0) + 1;
  if (PLC_STATE.stats.firstAlarmAt === null) PLC_STATE.stats.firstAlarmAt = alarmAt;
  PLC_STATE.stats.lastAlarmAt = alarmAt;
  window.dispatchEvent(new CustomEvent('plc-alarm', {
    detail: { belt: beltKey, message: msg, at: alarmAt }
  }));
  
  // Detener la cinta fallida de inmediato
  if (beltKey === 'C0') {
    PLC_STATE.outputs.MC0 = false;
  } else {
    const idx = parseInt(beltKey[1]);
    PLC_STATE.outputs[`MC${idx}`] = false;
  }
  
  // Si la otra sigue activa, sigue en proceso de descarga si procede.
  // Cerrar tolva de forma preventiva
  PLC_STATE.outputs.MTolAb = false;
  if (!PLC_STATE.inputs.FCTolCe) {
    PLC_STATE.outputs.MTolCe = true;
  }
  
  logEvent('WARNING', `ALERTA VIGILANCIA: ${msg}. Deteniendo motor ${beltKey === 'C0' ? 'MC0' : 'MC' + beltKey[1]}.`, 'PLC');
  flushMetrics();
}

// Aceptar / Limpiar alarma (Acuse de recibo con Paro)
function clearAlarms() {
  PLC_STATE.control.alarms = { C0: false, C1: false, C2: false, C3: false };
  // Apagar todos los motores y restaurar lámparas
  stopAllMotors();
  PLC_STATE.outputs.LConC0 = false;
  PLC_STATE.outputs.LConC1 = false;
  PLC_STATE.outputs.LConC2 = false;
  PLC_STATE.outputs.LConC3 = false;
  PLC_STATE.outputs.LDesC0 = true;
  PLC_STATE.outputs.LDesC1 = true;
  PLC_STATE.outputs.LDesC2 = true;
  PLC_STATE.outputs.LDesC3 = true;
  
  PLC_STATE.outputs.LDescgC1 = false;
  PLC_STATE.outputs.LDescgC2 = false;
  PLC_STATE.outputs.LDescgC3 = false;
  
  PLC_STATE.control.status = 'IDLE';
  // El ciclo se interrumpió por alarma o retorno a CI: no se contabiliza como lote
  discardProductionCycle();
  flushMetrics();
  logEvent('INFO', 'Alarma acusada y reseteada por operador. Sistema en REPOSO.', 'PLC');
}

// -------------------------------------------------------------
// CONTROLADOR DE RED DEL PLC (Validación de Comandos Firmados)
// -------------------------------------------------------------

export async function handleNetworkMessage(encryptedOrSignedMessageStr) {
  try {
    // Descartar los nonces que ya han salido de la ventana de validez
    purgeExpiredNonces();

    const packet = JSON.parse(encryptedOrSignedMessageStr);

    // Verificación de integridad: el paquete debe tener payload y hmac
    if (!packet.payload || !packet.hmac) {
      triggerSecurityLockdown('COMANDO_NO_FIRMADO', 'Se recibió un comando sin firma digital HMAC. Posible manipulación de red.', packet.payload && packet.payload.command);
      return { success: false, error: 'Comando no firmado' };
    }
    
    const payloadStr = JSON.stringify(packet.payload);
    
    // 1. Validar HMAC con la clave secreta
    const isValidHMAC = await verifyHMAC(payloadStr, packet.hmac, PLC_SHARED_SECRET);
    if (!isValidHMAC) {
      triggerSecurityLockdown('INTEGRIDAD_COMPROMETIDA', `Firma HMAC inválida. Se intentó ejecutar: ${packet.payload.command || 'unknown'}.`, packet.payload.command);
      return { success: false, error: 'Firma digital no coincide (Tampering bloqueado)' };
    }
    
    // 2. Validar Nonce para evitar ataques de Replay
    const nonce = packet.payload.nonce;
    if (receivedNonces.has(nonce)) {
      triggerSecurityLockdown('ATAQUE_REPLAY_DETECTADO', `Ataque de Replay: Nonce '${nonce}' ya fue procesado previamente.`, packet.payload.command);
      return { success: false, error: 'Replay Attack detectado y bloqueado' };
    }
    
    // 3. Validar Timestamp para evitar que tramas extremadamente antiguas sean enviadas
    const timestamp = packet.payload.timestamp;
    const now = Date.now();
    if (Math.abs(now - timestamp) > maxNonceAgeMs) {
      triggerSecurityLockdown('TRAMA_EXPIRADA', `Trama expirada por retardo temporal: Delta de ${Math.abs(now - timestamp)}ms.`, packet.payload.command);
      return { success: false, error: 'Comando expirado por tiempo' };
    }
    
    // Registrar el Nonce como utilizado, con el instante de recepción para poder purgarlo
    receivedNonces.set(nonce, Date.now());
    
    // Ejecutar el comando aprobado por seguridad
    const result = executeCommand(packet.payload);
    return { success: true, result };
    
  } catch (e) {
    triggerSecurityLockdown('FORMATO_CORRUPTO', `Error al deserializar paquete de red: ${e.message}`);
    return { success: false, error: 'Error de protocolo de red' };
  }
}

// Ejecución de comandos del PLC
function executeCommand(payload) {
  const { command, args, user } = payload;
  
  // Cuenta comandos RECIBIDOS y verificados, no comandos con efecto: un PMARCHA
  // enviado fuera de IDLE se contabiliza aunque la máquina de estados lo ignore.
  PLC_STATE.stats.commandCounts[command] = (PLC_STATE.stats.commandCounts[command] || 0) + 1;

  logEvent('OPERATION', `Comando '${command}' recibido y verificado por firma HMAC (Nonce: ${payload.nonce}).`, user);
  
  switch (command) {
    case 'PMARCHA':
      if (PLC_STATE.control.status === 'IDLE') {
        PLC_STATE.control.status = 'ROTATING';
        logEvent('INFO', `Iniciando secuencia de Marcha. Posicionando plataforma a Posición ${PLC_STATE.physical.targetPosition}.`, 'PLC');
      }
      break;
      
    case 'PPARO':
      if (PLC_STATE.control.status === 'ALARM') {
        clearAlarms();
      } else if (PLC_STATE.control.status === 'RUNNING') {
        // Iniciar secuencia de parada temporizada
        PLC_STATE.outputs.MTolAb = false;
        PLC_STATE.outputs.MTolCe = true; // Cerrar tolva
        
        // Iniciar temporizador de 20s para descargar Cinta 0
        PLC_STATE.control.timer = PLC_STATE.config.cinta0DischargeTime * 1000;
        PLC_STATE.control.status = 'DISCHARGING_C0';
        logEvent('INFO', `Iniciando secuencia de Parada. Cerrando tolva y descargando material de Cinta 0 (Vaciado: ${PLC_STATE.config.cinta0DischargeTime}s).`, 'PLC');
      } else if (PLC_STATE.control.status === 'DISCHARGING_C0' || PLC_STATE.control.status === 'DISCHARGING_DEST') {
        // Parada forzada inmediata de todo el proceso
        stopAllMotors();
        PLC_STATE.control.status = 'IDLE';
        // El ciclo se aborta, pero si llegó a entregar material cuenta como lote
        finishProductionCycle(PLC_STATE.physical.targetPosition);
        logEvent('INFO', 'Secuencia de parada abortada por operador. Motores apagados inmediatamente.', 'PLC');
      }
      break;
      
    case 'PSELEC':
      // Solo cambiar posición si está inactivo (IDLE o ALARM)
      if (PLC_STATE.control.status === 'IDLE' || PLC_STATE.control.status === 'ALARM') {
        PLC_STATE.physical.targetPosition = (PLC_STATE.physical.targetPosition % 3) + 1;
        // Cambiar lámparas de selección LS
        PLC_STATE.outputs.LS1 = PLC_STATE.physical.targetPosition === 1;
        PLC_STATE.outputs.LS2 = PLC_STATE.physical.targetPosition === 2;
        PLC_STATE.outputs.LS3 = PLC_STATE.physical.targetPosition === 3;
        logEvent('INFO', `Posición de destino seleccionada: Posición ${PLC_STATE.physical.targetPosition}.`, 'PLC');
      }
      break;
      
    case 'EMERGENCY':
      PLC_STATE.control.status = 'EMERGENCY_LOCK';
      logEvent('WARNING', 'PARADA DE EMERGENCIA ACTIVA. Motores apagados. Luces de descarga encendidas.', 'PLC');
      break;
      
    case 'RESET_CI':
      if (PLC_STATE.control.status === 'EMERGENCY_LOCK' || PLC_STATE.control.status === 'ALARM') {
        // Volver a condiciones iniciales
        clearAlarms();
        PLC_STATE.physical.hopperOpenPercent = 0;
        PLC_STATE.physical.currentAngle = 0;
        PLC_STATE.physical.targetPosition = 1;
        PLC_STATE.outputs.LS1 = true;
        PLC_STATE.outputs.LS2 = false;
        PLC_STATE.outputs.LS3 = false;
        PLC_STATE.inputs.FC1 = true;
        PLC_STATE.inputs.FC2 = false;
        PLC_STATE.inputs.FC3 = false;
        PLC_STATE.inputs.FCTolCe = true;
        PLC_STATE.inputs.FCTolAb = false;
        
        logEvent('INFO', 'Retorno a Condiciones Iniciales (CI) completado.', 'PLC');
      }
      break;

    case 'CONFIG_UPDATE':
      // Configuración de tiempos (Solo Ingeniero)
      if (args) {
        PLC_STATE.config.hopperOpenDelay = Number(args.hopperOpenDelay || PLC_STATE.config.hopperOpenDelay);
        PLC_STATE.config.cinta0DischargeTime = Number(args.cinta0DischargeTime || PLC_STATE.config.cinta0DischargeTime);
        PLC_STATE.config.destDischargeTime = Number(args.destDischargeTime || PLC_STATE.config.destDischargeTime);
        
        localStorage.setItem('plcConfig', JSON.stringify(PLC_STATE.config));
        logEvent('CONFIG_CHANGE', `Temporizadores actualizados: Tolva=${PLC_STATE.config.hopperOpenDelay}s, Vaciado C0=${PLC_STATE.config.cinta0DischargeTime}s, Vaciado Destino=${PLC_STATE.config.destDischargeTime}s.`, user);
      }
      break;
      
    case 'FORCE_ACTUATOR':
      // Forzado manual de salidas (Ingeniero)
      if (args && args.output !== undefined && args.value !== undefined) {
        PLC_STATE.outputs[args.output] = !!args.value;
        logEvent('CONFIG_CHANGE', `Forzado de Actuador: ${args.output} = ${args.value}`, user);
      }
      break;
      
    case 'INJECT_FAULT':
      // Inyección de falla de velocidad (Ingeniero)
      if (args && args.sensor !== undefined) {
        PLC_STATE.inputs[args.sensor] = !args.value; // false = falla de velocidad
        logEvent('CONFIG_CHANGE', `Simulación de sensor de velocidad alterada: ${args.sensor} = ${PLC_STATE.inputs[args.sensor] ? 'OK' : 'FALLA (Deslizamiento)'}`, user);
      }
      break;
      
    case 'SECURITY_RESET':
      // Desbloqueo tras ataque cibernético
      PLC_STATE.control.securityLockdown = false;
      PLC_STATE.control.securityLockReason = '';
      clearAlarms();
      logEvent('INFO', 'Bloqueo de ciberseguridad restablecido por el ingeniero.', user);
      break;
  }
  
  return true;
}

// Disparar bloqueo por intrusión (Lockdown de Seguridad OT)
function triggerSecurityLockdown(reason, detailMsg, attemptedCommand) {
  // El contador de lockdowns cuenta ENTRADAS en bloqueo, no rechazos: los intentos
  // sucesivos con el firewall ya cerrado suman en securityEvents, no aquí.
  if (!PLC_STATE.control.securityLockdown) {
    PLC_STATE.stats.lockdownCount++;
  }
  PLC_STATE.stats.securityEvents[reason] = (PLC_STATE.stats.securityEvents[reason] || 0) + 1;

  const rejectedKey = attemptedCommand || 'DESCONOCIDO';
  PLC_STATE.stats.rejectedCommands[rejectedKey] = (PLC_STATE.stats.rejectedCommands[rejectedKey] || 0) + 1;

  PLC_STATE.control.securityLockdown = true;
  PLC_STATE.control.securityLockReason = reason;
  stopAllMotors();

  const at = Date.now();
  logEvent('SECURITY_ALERT', `ALERTA DE SEGURIDAD OT: ${detailMsg}`, 'PLC_FIREWALL', { reason, detailMsg });
  window.dispatchEvent(new CustomEvent('plc-lockdown', {
    detail: { reason, message: detailMsg, command: rejectedKey, at }
  }));
  flushMetrics();
}
