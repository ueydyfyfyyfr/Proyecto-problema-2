import { generateNonce, generateHMAC } from './crypto-helper.js';
import { handleNetworkMessage } from './plc-simulation.js';
import { getCurrentUser } from './auth.js';

// Clave secreta compartida (debe coincidir con la del PLC)
var PLC_SHARED_SECRET = "PlcSuperSecretKeyOT2026!";

// Registro de tráfico de red virtual para visualización
let networkTraffic = [];

export function logNetworkTraffic(direction, packet) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toLocaleTimeString(),
    direction, // 'SENT' o 'RECEIVED'
    data: packet
  };
  
  networkTraffic.unshift(entry);
  if (networkTraffic.length > 30) {
    networkTraffic.pop();
  }
  
  window.dispatchEvent(new CustomEvent('network-traffic-updated', { detail: entry }));
}

export function getNetworkTraffic() {
  return networkTraffic;
}

// Enviar comando seguro al PLC (firmado con HMAC y Nonce)
export async function sendSecureCommand(command, args = null) {
  const user = getCurrentUser();
  const userName = user ? `${user.name} (${user.role})` : 'ANONYMOUS';
  
  const payload = {
    command,
    args,
    user: userName,
    timestamp: Date.now(),
    nonce: generateNonce()
  };
  
  const payloadStr = JSON.stringify(payload);
  const hmac = await generateHMAC(payloadStr, PLC_SHARED_SECRET);
  
  const packet = {
    payload,
    hmac
  };
  
  logNetworkTraffic('SENT', packet);
  
  const response = await handleNetworkMessage(JSON.stringify(packet));
  
  logNetworkTraffic('RECEIVED', response);
  return response;
}

// -------------------------------------------------------------
// RENDERIZADOR DEL PROCESO FÍSICO EN CANVAS 2D — PREMIUM HMI
// -------------------------------------------------------------

// Utilidades de dibujo
function createMetalGradient(ctx, x, y, w, h, baseColor, highlightColor) {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, highlightColor);
  grad.addColorStop(0.3, baseColor);
  grad.addColorStop(0.7, baseColor);
  grad.addColorStop(1, highlightColor);
  return grad;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawConveyorSystem(canvas, state) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  
  // === FONDO INDUSTRIAL PREMIUM ===
  // Gradiente oscuro profundo
  const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
  bgGrad.addColorStop(0, '#1a1a2e');
  bgGrad.addColorStop(1, '#0a0a14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  
  // Rejilla de fondo premium (puntos en lugar de líneas)
  const gridSize = 30;
  ctx.fillStyle = 'rgba(100, 120, 180, 0.08)';
  for (let x = gridSize; x < W; x += gridSize) {
    for (let y = gridSize; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Líneas de guía sutiles (ejes principales)
  ctx.strokeStyle = 'rgba(100, 120, 180, 0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2 + 50); ctx.lineTo(W, H / 2 + 50);
  ctx.stroke();
  ctx.setLineDash([]);
  
  const centerX = W / 2;
  const centerY = H / 2 + 50;
  
  // === 1. CINTAS DE DESTINO (C1, C2, C3) ===
  const beltLength = 170;
  const beltThickness = 28;
  
  // Cinta 1 (Izquierda)
  drawPremiumBelt(ctx, centerX - beltLength - 65, centerY - beltThickness / 2, beltLength, beltThickness, 'LEFT', state.outputs.MC1, state, 'C1');
  
  // Cinta 3 (Derecha)
  drawPremiumBelt(ctx, centerX + 65, centerY - beltThickness / 2, beltLength, beltThickness, 'RIGHT', state.outputs.MC3, state, 'C3');
  
  // Cinta 2 (Abajo)
  drawPremiumBelt(ctx, centerX - beltThickness / 2, centerY + 65, beltThickness, beltLength, 'DOWN', state.outputs.MC2, state, 'C2');
  
  // === 2. PLATAFORMA GIRATORIA (MG) — Efecto 3D ===
  ctx.save();
  ctx.translate(centerX, centerY);
  
  // Sombra exterior
  ctx.beginPath();
  ctx.arc(0, 5, 78, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  
  // Anillo exterior metálico
  const outerRingGrad = ctx.createRadialGradient(0, 0, 60, 0, 0, 82);
  outerRingGrad.addColorStop(0, '#3a3a50');
  outerRingGrad.addColorStop(0.5, '#52526e');
  outerRingGrad.addColorStop(1, '#2a2a3e');
  ctx.beginPath();
  ctx.arc(0, 0, 80, 0, Math.PI * 2);
  ctx.fillStyle = outerRingGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // Base de la plataforma (gradiente metálico)
  const platformGrad = ctx.createRadialGradient(-15, -15, 0, 0, 0, 70);
  platformGrad.addColorStop(0, '#5a5a7a');
  platformGrad.addColorStop(0.5, '#3e3e58');
  platformGrad.addColorStop(1, '#2a2a42');
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.fillStyle = platformGrad;
  ctx.fill();
  
  // Borde interior iluminado
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Anillo de tornillos decorativos
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const bx = Math.cos(angle) * 74;
    const by = Math.sin(angle) * 74;
    ctx.beginPath();
    ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#6a6a88';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  
  // Anillo dentado animado
  const gearAnimAngle = (Date.now() / 2000) * Math.PI * 2;
  ctx.save();
  ctx.rotate(state.outputs.MG ? gearAnimAngle : 0);
  ctx.beginPath();
  ctx.arc(0, 0, 67, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(160, 170, 200, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  
  // LED de estado del motor MG (centro)
  const mgLedColor = state.outputs.MG ? '#10b981' : '#f43f5e';
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  const ledGrad = ctx.createRadialGradient(0, -2, 0, 0, 0, 6);
  ledGrad.addColorStop(0, state.outputs.MG ? '#6ee7b7' : '#fda4af');
  ledGrad.addColorStop(1, mgLedColor);
  ctx.fillStyle = ledGrad;
  ctx.fill();
  // Resplandor del LED
  if (state.outputs.MG) {
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.fill();
  }
  
  // Rotar para Cinta 0
  const angleRad = (state.physical.currentAngle * Math.PI) / 180;
  ctx.rotate(angleRad);
  
  // Cinta 0 sobre la plataforma
  const c0Length = 115;
  const c0Thick = 22;
  
  // Sombra de la cinta
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.fillRect(-c0Length / 2 + 2, -c0Thick / 2 + 2, c0Length, c0Thick);
  
  // Cuerpo de la cinta con gradiente metálico
  const c0Grad = createMetalGradient(ctx, 0, -c0Thick / 2, c0Length, c0Thick, '#2a2a42', '#3e3e58');
  ctx.fillStyle = c0Grad;
  ctx.fillRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
  
  // Borde de la cinta (color según estado)
  const c0BorderColor = state.outputs.MC0 ? '#10b981' : '#f43f5e';
  ctx.strokeStyle = c0BorderColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
  
  // Resplandor sutil de la cinta si activa
  if (state.outputs.MC0) {
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 8;
    ctx.strokeRect(-c0Length / 2, -c0Thick / 2, c0Length, c0Thick);
    ctx.shadowBlur = 0;
  }
  
  // Rodillos metálicos 3D
  [-c0Length / 2 + 12, c0Length / 2 - 12].forEach(rx => {
    const rollerGrad = ctx.createRadialGradient(rx - 2, -2, 0, rx, 0, 9);
    rollerGrad.addColorStop(0, '#8888aa');
    rollerGrad.addColorStop(1, '#2a2a42');
    ctx.beginPath();
    ctx.arc(rx, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = rollerGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Eje del rodillo
    ctx.beginPath();
    ctx.arc(rx, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
  });
  
  // Patrón animado de banda rodante
  if (state.outputs.MC0 && state.control.status !== 'ALARM') {
    const shift = (Date.now() / 6) % 15;
    ctx.strokeStyle = 'rgba(150, 160, 200, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let lx = -c0Length / 2 + 18 + shift; lx < c0Length / 2 - 18; lx += 15) {
      ctx.moveTo(lx, -c0Thick / 2 + 1);
      ctx.lineTo(lx - 4, c0Thick / 2 - 1);
    }
    ctx.stroke();
  }
  
  // Flecha de dirección de flujo
  ctx.fillStyle = 'rgba(150, 170, 220, 0.5)';
  ctx.beginPath();
  ctx.moveTo(18, -5);
  ctx.lineTo(30, 0);
  ctx.lineTo(18, 5);
  ctx.fill();
  
  ctx.restore();
  
  // === 3. FINALES DE CARRERA (FC1, FC2, FC3) ===
  drawPremiumLimitSwitch(ctx, centerX - 85, centerY, 'FC1', state.inputs.FC1);
  drawPremiumLimitSwitch(ctx, centerX, centerY + 85, 'FC2', state.inputs.FC2);
  drawPremiumLimitSwitch(ctx, centerX + 85, centerY, 'FC3', state.inputs.FC3);
  
  // === 4. TOLVA DE ALIMENTACIÓN — Efecto 3D Premium ===
  const hopperTopY = 20;
  const hopperHeight = 90;
  const hopperWidthTop = 150;
  const hopperWidthBot = 45;
  
  // Sombra de la tolva
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2 + 4, hopperTopY + 4);
  ctx.lineTo(centerX + hopperWidthTop / 2 + 4, hopperTopY + 4);
  ctx.lineTo(centerX + hopperWidthBot / 2 + 4, hopperTopY + hopperHeight + 4);
  ctx.lineTo(centerX - hopperWidthBot / 2 + 4, hopperTopY + hopperHeight + 4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();
  
  // Cuerpo de la tolva con gradiente metálico
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2, hopperTopY);
  ctx.lineTo(centerX + hopperWidthTop / 2, hopperTopY);
  ctx.lineTo(centerX + hopperWidthBot / 2, hopperTopY + hopperHeight);
  ctx.lineTo(centerX - hopperWidthBot / 2, hopperTopY + hopperHeight);
  ctx.closePath();
  
  const hopperGrad = ctx.createLinearGradient(centerX - hopperWidthTop / 2, hopperTopY, centerX + hopperWidthTop / 2, hopperTopY);
  hopperGrad.addColorStop(0, '#7c4a1e');
  hopperGrad.addColorStop(0.2, '#c2711e');
  hopperGrad.addColorStop(0.5, '#e8922a');
  hopperGrad.addColorStop(0.8, '#c2711e');
  hopperGrad.addColorStop(1, '#7c4a1e');
  ctx.fillStyle = hopperGrad;
  ctx.fill();
  
  // Borde de la tolva
  ctx.strokeStyle = '#5c3310';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Reflejo superior (brillo metálico)
  ctx.beginPath();
  ctx.moveTo(centerX - hopperWidthTop / 2 + 10, hopperTopY + 3);
  ctx.lineTo(centerX + hopperWidthTop / 2 - 10, hopperTopY + 3);
  ctx.strokeStyle = 'rgba(255, 200, 120, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Remaches decorativos en la tolva
  const remachePositions = [
    [centerX - hopperWidthTop / 2 + 12, hopperTopY + 10],
    [centerX + hopperWidthTop / 2 - 12, hopperTopY + 10],
    [centerX - hopperWidthTop / 2 + 20, hopperTopY + 25],
    [centerX + hopperWidthTop / 2 - 20, hopperTopY + 25],
    [centerX - 30, hopperTopY + hopperHeight - 8],
    [centerX + 30, hopperTopY + hopperHeight - 8],
  ];
  remachePositions.forEach(([rx, ry]) => {
    ctx.beginPath();
    ctx.arc(rx, ry, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#8a5a28';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Brillo del remache
    ctx.beginPath();
    ctx.arc(rx - 0.8, ry - 0.8, 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 220, 150, 0.4)';
    ctx.fill();
  });
  
  // Material dentro de la tolva
  if (state.physical.hopperOpenPercent < 100 || state.control.status !== 'IDLE') {
    ctx.beginPath();
    ctx.moveTo(centerX - 55, hopperTopY + 28);
    ctx.lineTo(centerX + 55, hopperTopY + 28);
    ctx.lineTo(centerX + hopperWidthBot / 2 - 2, hopperTopY + hopperHeight - 2);
    ctx.lineTo(centerX - hopperWidthBot / 2 + 2, hopperTopY + hopperHeight - 2);
    ctx.closePath();
    const matGrad = ctx.createLinearGradient(centerX, hopperTopY + 28, centerX, hopperTopY + hopperHeight);
    matGrad.addColorStop(0, '#a0522d');
    matGrad.addColorStop(0.5, '#8b4513');
    matGrad.addColorStop(1, '#6b3410');
    ctx.fillStyle = matGrad;
    ctx.fill();
  }
  
  // Compuerta de la tolva (deslizante metálica)
  const gateOpenOffset = (state.physical.hopperOpenPercent / 100) * 28;
  const gateX = centerX - 22 + gateOpenOffset;
  const gateY = hopperTopY + hopperHeight;
  const gateGrad = createMetalGradient(ctx, gateX, gateY, 44, 8, '#4a4a60', '#6a6a80');
  ctx.fillStyle = gateGrad;
  ctx.fillRect(gateX, gateY, 44, 8);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(gateX, gateY, 44, 8);
  
  // FCTolCe y FCTolAb
  drawPremiumLimitSwitch(ctx, centerX - 40, hopperTopY + hopperHeight + 4, 'FCTolCe', state.inputs.FCTolCe);
  drawPremiumLimitSwitch(ctx, centerX + 30, hopperTopY + hopperHeight + 4, 'FCTolAb', state.inputs.FCTolAb);
  
  // Caída de material (partículas animadas realistas)
  if (state.physical.hopperOpenPercent > 10 && state.outputs.MC0) {
    const time = Date.now();
    for (let i = 0; i < 8; i++) {
      const seed = (time / 50 + i * 137) % 1000;
      const px = centerX - 8 + (Math.sin(seed) * 0.5 + 0.5) * 16;
      const py = hopperTopY + hopperHeight + 8 + ((seed % 100) / 100) * (centerY - (hopperTopY + hopperHeight) - 25);
      const size = 2 + (Math.sin(seed * 3.7) * 0.5 + 0.5) * 4;
      
      const particleGrad = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, size);
      particleGrad.addColorStop(0, '#f97316');
      particleGrad.addColorStop(1, '#c2410c');
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fillStyle = particleGrad;
      ctx.fill();
    }
  }
  
  // === 5. PARTÍCULAS DE MATERIAL EN CINTAS ===
  // Partículas en Cinta 0
  state.physical.materialOnCinta0.forEach(p => {
    const c0Len = 115;
    const startX = -c0Len / 2 + 12;
    const endX = c0Len / 2 - 12;
    const relX = startX + p.x * (endX - startX);
    
    const aRad = (state.physical.currentAngle * Math.PI) / 180;
    const px = centerX + relX * Math.cos(aRad) - p.y * Math.sin(aRad);
    const py = centerY + relX * Math.sin(aRad) + p.y * Math.cos(aRad);
    
    const matParticle = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, 7);
    matParticle.addColorStop(0, '#fb923c');
    matParticle.addColorStop(1, '#c2410c');
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = matParticle;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 50, 10, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  
  // Partículas en Cintas de Destino
  state.physical.materialOnDest.forEach(p => {
    let px = 0, py = 0;
    
    if (p.cinta === 1) {
      px = (centerX - 65) - p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 3) {
      px = (centerX + 65) + p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 2) {
      px = centerX + (p.y - 15);
      py = (centerY + 65) + p.x * beltLength;
    }
    
    const matParticle = ctx.createRadialGradient(px - 1, py - 1, 0, px, py, 7);
    matParticle.addColorStop(0, '#fdba74');
    matParticle.addColorStop(1, '#ea580c');
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fillStyle = matParticle;
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 60, 10, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  
  // === 6. SENSORES DE VELOCIDAD (VIGILANCIA) ===
  drawPremiumSpeedSensor(ctx, centerX, centerY - 28, 'VigC0', state.inputs.VigC0, state.outputs.MC0);
  drawPremiumSpeedSensor(ctx, centerX - 150, centerY - 32, 'VigC1', state.inputs.VigC1, state.outputs.MC1);
  drawPremiumSpeedSensor(ctx, centerX + 150, centerY - 32, 'VigC3', state.inputs.VigC3, state.outputs.MC3);
  drawPremiumSpeedSensor(ctx, centerX - 32, centerY + 150, 'VigC2', state.inputs.VigC2, state.outputs.MC2);
  
  // === 7. ETIQUETAS DE LAS CINTAS ===
  ctx.font = 'bold 11px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(150, 170, 220, 0.6)';
  ctx.fillText('← C1', centerX - beltLength / 2 - 65, centerY - 22);
  ctx.fillText('C3 →', centerX + beltLength / 2 + 65, centerY - 22);
  ctx.fillText('C2 ↓', centerX + 28, centerY + beltLength / 2 + 85);
  ctx.fillText('TOLVA', centerX, hopperTopY - 6);
  
  // === 8. ALERTA DE CIBERSEGURIDAD ===
  if (state.control.securityLockdown) {
    // Fondo de alerta con gradiente
    const alertGrad = ctx.createLinearGradient(0, 0, 0, H);
    alertGrad.addColorStop(0, 'rgba(244, 63, 94, 0.92)');
    alertGrad.addColorStop(1, 'rgba(180, 30, 50, 0.92)');
    ctx.fillStyle = alertGrad;
    ctx.fillRect(10, 10, W - 20, H - 20);
    
    // Icono y texto
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🚨 ALERTA DE SEGURIDAD INDUSTRIAL OT 🚨', W / 2, H / 2 - 45);
    
    ctx.font = '600 16px "Inter", monospace';
    ctx.fillText('PLC LOCKDOWN ACTIVO — Comando Rechazado', W / 2, H / 2);
    
    ctx.font = '14px "Inter", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`Causa: ${state.control.securityLockReason}`, W / 2, H / 2 + 28);
    ctx.fillText('Desbloqueo requerido por Supervisor', W / 2, H / 2 + 52);
  }
  
  // === 9. BARRA DE ESTADO INFERIOR ===
  const barY = H - 32;
  ctx.fillStyle = 'rgba(10, 10, 20, 0.7)';
  ctx.fillRect(0, barY, W, 32);
  ctx.strokeStyle = 'rgba(100, 120, 180, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barY); ctx.lineTo(W, barY);
  ctx.stroke();
  
  ctx.font = '11px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(160, 175, 210, 0.7)';
  ctx.fillText(`Física: 4 Cintas, Plataforma Giratoria y Tolva de Alimentación`, 16, barY + 20);
  ctx.textAlign = 'right';
  ctx.fillText(`Modo: Simulación de Planta Ciberfísica ${Math.round(1000/20)} FPS`, W - 16, barY + 20);
  
  // LED de estado del sistema en la barra
  const sysLedColor = state.control.status === 'ALARM' ? '#f43f5e' : 
                       state.control.status === 'RUNNING' ? '#10b981' : '#f59e0b';
  ctx.beginPath();
  ctx.arc(W / 2, barY + 16, 4, 0, Math.PI * 2);
  ctx.fillStyle = sysLedColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W / 2, barY + 16, 8, 0, Math.PI * 2);
  ctx.fillStyle = sysLedColor.replace(')', ', 0.2)').replace('rgb', 'rgba');
  ctx.fill();
  
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(200, 210, 240, 0.6)';
  ctx.font = '10px "Inter", sans-serif';
  ctx.fillText(state.control.status, W / 2 + 16, barY + 20);
}

// === CINTA TRANSPORTADORA PREMIUM ===
function drawPremiumBelt(ctx, x, y, w, h, dir, isRunning, state, label) {
  const isHorizontal = (dir === 'LEFT' || dir === 'RIGHT');
  
  // Sombra
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  if (isHorizontal) {
    ctx.fillRect(x + 3, y + 3, w, h);
  } else {
    ctx.fillRect(x + 3, y + 3, w, h);
  }
  
  // Cuerpo de la cinta (gradiente metálico)
  const beltGrad = isHorizontal 
    ? createMetalGradient(ctx, x, y, w, h, '#1a1a2e', '#2a2a42')
    : ctx.createLinearGradient(x, y, x + w, y);
  if (!isHorizontal) {
    beltGrad.addColorStop(0, '#2a2a42');
    beltGrad.addColorStop(0.3, '#1a1a2e');
    beltGrad.addColorStop(0.7, '#1a1a2e');
    beltGrad.addColorStop(1, '#2a2a42');
  }
  ctx.fillStyle = beltGrad;
  ctx.fillRect(x, y, w, h);
  
  // Borde con color de estado
  const borderColor = isRunning ? '#10b981' : '#4a4a60';
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
  
  // Resplandor si activa
  if (isRunning) {
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 6;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;
  }
  
  // Rodillos metálicos 3D
  ctx.save();
  if (isHorizontal) {
    [x + 12, x + w - 12].forEach(rx => {
      const rollerGrad = ctx.createRadialGradient(rx - 2, y + h / 2 - 2, 0, rx, y + h / 2, 9);
      rollerGrad.addColorStop(0, '#7a7a9a');
      rollerGrad.addColorStop(1, '#2a2a42');
      ctx.beginPath();
      ctx.arc(rx, y + h / 2, 9, 0, Math.PI * 2);
      ctx.fillStyle = rollerGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rx, y + h / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    });
  } else {
    [y + 12, y + h - 12].forEach(ry => {
      const rollerGrad = ctx.createRadialGradient(x + w / 2 - 2, ry - 2, 0, x + w / 2, ry, 9);
      rollerGrad.addColorStop(0, '#7a7a9a');
      rollerGrad.addColorStop(1, '#2a2a42');
      ctx.beginPath();
      ctx.arc(x + w / 2, ry, 9, 0, Math.PI * 2);
      ctx.fillStyle = rollerGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + w / 2, ry, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a2e';
      ctx.fill();
    });
  }
  ctx.restore();
  
  // Patrón animado de bandas
  if (isRunning && state.control.status !== 'ALARM') {
    const shift = (Date.now() / 5) % 15;
    ctx.strokeStyle = 'rgba(150, 160, 200, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    
    if (dir === 'LEFT') {
      for (let lx = x + w - 18 - shift; lx > x + 18; lx -= 15) {
        ctx.moveTo(lx, y + 1);
        ctx.lineTo(lx - 4, y + h - 1);
      }
    } else if (dir === 'RIGHT') {
      for (let lx = x + 18 + shift; lx < x + w - 18; lx += 15) {
        ctx.moveTo(lx, y + 1);
        ctx.lineTo(lx - 4, y + h - 1);
      }
    } else if (dir === 'DOWN') {
      for (let ly = y + 18 + shift; ly < y + h - 18; ly += 15) {
        ctx.moveTo(x + 1, ly);
        ctx.lineTo(x + w - 1, ly - 4);
      }
    }
    ctx.stroke();
  }
  
  // Etiqueta de la cinta
  ctx.font = 'bold 10px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = isRunning ? 'rgba(16, 185, 129, 0.8)' : 'rgba(160, 170, 200, 0.4)';
  if (isHorizontal) {
    ctx.fillText(label, x + w / 2, y - 6);
  } else {
    ctx.fillText(label, x - 14, y + h / 2 + 4);
  }
}

// === FINAL DE CARRERA PREMIUM ===
function drawPremiumLimitSwitch(ctx, x, y, name, isActive) {
  // Carcasa del switch con gradiente
  drawRoundedRect(ctx, x - 8, y - 8, 16, 16, 3);
  const swGrad = createMetalGradient(ctx, x - 8, y - 8, 16, 16, '#2a2a42', '#3e3e58');
  ctx.fillStyle = swGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // LED del switch con resplandor
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  const swLedColor = isActive ? '#10b981' : '#4a4a60';
  const swLedGrad = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
  swLedGrad.addColorStop(0, isActive ? '#6ee7b7' : '#5a5a70');
  swLedGrad.addColorStop(1, swLedColor);
  ctx.fillStyle = swLedGrad;
  ctx.fill();
  
  // Resplandor exterior
  if (isActive) {
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.fill();
  }
  
  // Etiqueta
  ctx.fillStyle = isActive ? 'rgba(110, 231, 183, 0.9)' : 'rgba(160, 170, 200, 0.5)';
  ctx.font = '8px "Space Grotesk", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y - 12);
}

// === SENSOR DE VELOCIDAD PREMIUM ===
function drawPremiumSpeedSensor(ctx, x, y, name, isOk, motorRunning) {
  // Carcasa con efecto 3D
  drawRoundedRect(ctx, x - 22, y - 12, 44, 20, 4);
  const sGrad = createMetalGradient(ctx, x - 22, y - 12, 44, 20, '#1a1a2e', '#2e2e48');
  ctx.fillStyle = sGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();
  
  // LED de estado con resplandor
  let ledColor, ledHighlight;
  if (!isOk) {
    ledColor = '#f43f5e';
    ledHighlight = '#fda4af';
  } else if (motorRunning) {
    const pulse = Math.floor(Date.now() / 100) % 2 === 0;
    ledColor = pulse ? '#10b981' : '#047857';
    ledHighlight = pulse ? '#6ee7b7' : '#34d399';
  } else {
    ledColor = '#4a4a60';
    ledHighlight = '#6a6a80';
  }
  
  ctx.beginPath();
  ctx.arc(x - 10, y - 2, 5, 0, Math.PI * 2);
  const sLedGrad = ctx.createRadialGradient(x - 11, y - 3, 0, x - 10, y - 2, 5);
  sLedGrad.addColorStop(0, ledHighlight);
  sLedGrad.addColorStop(1, ledColor);
  ctx.fillStyle = sLedGrad;
  ctx.fill();
  
  // Resplandor exterior del LED
  if (motorRunning && isOk) {
    ctx.beginPath();
    ctx.arc(x - 10, y - 2, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.fill();
  }
  
  // Nombre del sensor
  ctx.fillStyle = '#c0c8e0';
  ctx.font = 'bold 8px "Space Grotesk", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(name.slice(3), x + 1, y + 2);
}

