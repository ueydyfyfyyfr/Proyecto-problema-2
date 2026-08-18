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

  // Reproducir efecto de sonido industrial correspondiente
  if (command === 'PMARCHA') playSound('marcha');
  else if (command === 'PPARO') playSound('paro');
  else if (command === 'PSELEC') playSound('selection');
  else if (command === 'EMERGENCY') playSound('emergency');
  else playSound('click');
  
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
// RENDERIZADOR DEL PROCESO FÍSICO EN CANVAS 2D — COCKPIT INDUSTRIAL (NUEVO DISEÑO 3D-ISH)
// -------------------------------------------------------------

function drawTrapezoid(ctx, x, y, topW, bottomW, h, fillStyle) {
  ctx.beginPath();
  ctx.moveTo(x - topW/2, y);
  ctx.lineTo(x + topW/2, y);
  ctx.lineTo(x + bottomW/2, y + h);
  ctx.lineTo(x - bottomW/2, y + h);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawIsometricBelt(ctx, x, y, width, length, angleRad, isRunning, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  
  // 1. Sombra exterior
  ctx.shadowBlur = 15;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-width/2, 5, width, length);
  ctx.shadowBlur = 0;

  // 2. Chasis Metálico (Base Zinc)
  const chassisGrad = ctx.createLinearGradient(-width/2 - 8, 0, width/2 + 8, 0);
  chassisGrad.addColorStop(0, '#09090b');
  chassisGrad.addColorStop(0.2, '#27272a');
  chassisGrad.addColorStop(0.8, '#27272a');
  chassisGrad.addColorStop(1, '#09090b');
  
  ctx.fillStyle = chassisGrad;
  // Borde redondeado simulado con un path
  ctx.beginPath();
  ctx.roundRect(-width/2 - 6, -6, width + 12, length + 12, 5);
  ctx.fill();
  
  // 3. Rieles laterales Neón (Brillan si está corriendo)
  if (isRunning) {
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#a855f7';
    ctx.strokeStyle = '#a855f7';
  } else {
    ctx.strokeStyle = '#3f3f46';
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-width/2 - 2, -2); ctx.lineTo(-width/2 - 2, length + 2);
  ctx.moveTo(width/2 + 2, -2); ctx.lineTo(width/2 + 2, length + 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 4. Superficie de la banda (Goma oscura)
  const beltGrad = ctx.createLinearGradient(0, 0, 0, length);
  beltGrad.addColorStop(0, '#18181b');
  beltGrad.addColorStop(0.5, '#27272a');
  beltGrad.addColorStop(1, '#18181b');
  ctx.fillStyle = beltGrad;
  ctx.fillRect(-width/2, 0, width, length);

  // 5. Rodillos metálicos con brillo
  const rollerGrad = ctx.createLinearGradient(-width/2, 0, width/2, 0);
  rollerGrad.addColorStop(0, '#18181b');
  rollerGrad.addColorStop(0.5, '#71717a');
  rollerGrad.addColorStop(1, '#18181b');
  
  ctx.fillStyle = rollerGrad;
  for(let dy = 10; dy < length - 10; dy += 20) {
    ctx.fillRect(-width/2 + 2, dy, width - 4, 6);
  }

  // 6. Animación de Flujo (Láseres Púrpura)
  if (isRunning) {
    const shift = (Date.now() / 15) % 40;
    ctx.strokeStyle = 'rgba(216, 180, 254, 0.8)'; // Light Purple
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#d8b4fe';
    ctx.lineWidth = 2;
    for(let dy = shift - 40; dy < length; dy += 40) {
      if (dy > 0 && dy < length) {
        ctx.beginPath();
        // Forma de V para dar efecto de avance
        ctx.moveTo(-width/2 + 10, dy - 5);
        ctx.lineTo(0, dy + 5);
        ctx.lineTo(width/2 - 10, dy - 5);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }
  
  // 7. Etiqueta Holográfica
  ctx.rotate(-angleRad);
  ctx.fillStyle = isRunning ? '#d8b4fe' : '#a1a1aa';
  ctx.font = 'bold 13px "JetBrains Mono"';
  ctx.textAlign = 'center';
  if (isRunning) {
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#a855f7';
  }
  
  // Posicionamiento inteligente del texto según el ángulo
  let textY = length/2 + 40;
  if (Math.abs(angleRad) > 1.5) textY = -length/2 - 30; // Si está boca abajo
  
  ctx.fillText(label, 0, textY);
  ctx.shadowBlur = 0;
  
  ctx.restore();
}

function draw3DHopper(ctx, x, y, openPercent, isRunning) {
  // ==========================================
  // ESTILO TOLVA PREMIUM 3D CYBERPUNK
  // ==========================================
  const hopperTopW = 120;
  const hopperBotW = 40;
  const hopperH = 100;
  const topY = y - hopperH;
  
  // 1. Shadow/Glow base
  ctx.shadowBlur = 20;
  ctx.shadowColor = 'rgba(168, 85, 247, 0.3)';
  
  // 2. Main Body Gradient (Metallic Dark Zinc)
  const bodyGrad = ctx.createLinearGradient(x - hopperTopW/2, 0, x + hopperTopW/2, 0);
  bodyGrad.addColorStop(0, '#18181b'); // Dark edge
  bodyGrad.addColorStop(0.3, '#3f3f46'); // Metallic highlight
  bodyGrad.addColorStop(0.7, '#27272a'); // Mid tone
  bodyGrad.addColorStop(1, '#09090b'); // Shadow
  
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(x - hopperTopW/2, topY);
  ctx.lineTo(x + hopperTopW/2, topY);
  ctx.lineTo(x + hopperBotW/2, y);
  ctx.lineTo(x - hopperBotW/2, y);
  ctx.closePath();
  ctx.fill();
  
  // 3. Metallic Rim (Top)
  ctx.fillStyle = '#71717a';
  ctx.beginPath();
  ctx.ellipse(x, topY, hopperTopW/2, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner dark hole
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(x, topY, hopperTopW/2 - 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // 4. Glass/Window Level Indicator (Centro)
  const windowW = 20;
  const windowTopW = 50;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.moveTo(x - windowTopW/2, topY + 20);
  ctx.lineTo(x + windowTopW/2, topY + 20);
  ctx.lineTo(x + windowW/2, y - 15);
  ctx.lineTo(x - windowW/2, y - 15);
  ctx.closePath();
  ctx.fill();
  
  // Material Level inside window (Glowing Neon)
  const fillLvl = 0.6; 
  const fillTopY = y - 15 - ((hopperH - 35) * fillLvl);
  const fillTopW = windowW + ((windowTopW - windowW) * fillLvl);
  
  const levelGrad = ctx.createLinearGradient(0, fillTopY, 0, y - 15);
  levelGrad.addColorStop(0, 'rgba(168, 85, 247, 0.8)'); // Neon Purple
  levelGrad.addColorStop(1, 'rgba(168, 85, 247, 0.2)');
  
  ctx.fillStyle = levelGrad;
  ctx.beginPath();
  ctx.moveTo(x - fillTopW/2, fillTopY);
  ctx.lineTo(x + fillTopW/2, fillTopY);
  ctx.lineTo(x + windowW/2, y - 15);
  ctx.lineTo(x - windowW/2, y - 15);
  ctx.closePath();
  ctx.fill();
  
  // Window grid/lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - windowTopW/2, topY + 40); ctx.lineTo(x + windowTopW/2, topY + 40);
  ctx.moveTo(x - windowTopW/2 + 5, topY + 60); ctx.lineTo(x + windowTopW/2 - 5, topY + 60);
  ctx.stroke();

  // 5. Discharge Gate Assembly (Bottom)
  ctx.shadowBlur = 0;
  const gateY = y;
  
  // Flange
  ctx.fillStyle = '#52525b'; // Zinc
  ctx.fillRect(x - 25, gateY, 50, 8);
  
  // Animated Valve / Gate
  ctx.fillStyle = openPercent > 10 ? '#22c55e' : '#ef4444'; // Green if open, Red if closed
  ctx.fillRect(x - 20, gateY + 10, 40 * (openPercent / 100), 4);
  ctx.shadowBlur = openPercent > 10 ? 10 : 0;
  ctx.shadowColor = ctx.fillStyle;
  ctx.fillRect(x - 20, gateY + 10, 40 * (openPercent / 100), 4);
  ctx.shadowBlur = 0;
  
  // Valve body
  ctx.fillStyle = '#27272a';
  ctx.fillRect(x - 22, gateY + 8, 44, 12);
  
  // 6. Holographic Text Label
  ctx.fillStyle = '#d8b4fe';
  ctx.font = 'bold 14px "JetBrains Mono"';
  ctx.textAlign = 'center';
  ctx.shadowBlur = 5;
  ctx.shadowColor = '#a855f7';
  ctx.fillText('SILO PRINCIPAL', x, topY - 25);
  
  ctx.shadowBlur = 0;
}

function drawMaterialParticle(ctx, x, y, color) {
  ctx.save();
  ctx.translate(x, y);
  
  // Outer glow
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;
  
  // Sphere base
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  
  // Inner highlight (3D effect)
  ctx.shadowBlur = 0;
  const highlight = ctx.createRadialGradient(-2, -2, 0, 0, 0, 5);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

function drawLimitSwitch(ctx, x, y, isActive, label) {
  ctx.fillStyle = '#111827';
  ctx.fillRect(x - 15, y - 10, 30, 20);
  ctx.strokeStyle = isActive ? '#00f0ff' : '#4b5563';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 15, y - 10, 30, 20);
  
  ctx.fillStyle = isActive ? '#00f0ff' : '#374151';
  ctx.shadowBlur = isActive ? 10 : 0;
  ctx.shadowColor = '#00f0ff';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.fillStyle = '#fff';
  ctx.font = '10px "Share Tech Mono"';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 15);
}

export function drawConveyorSystem(canvas, state) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  
  // Background gradient is now handled by CSS or subtle canvas clear
  ctx.clearRect(0, 0, W, H);
  
  // Draw floor grid for industrial look
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for(let i=0; i<W; i+=50) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
  }
  for(let i=0; i<H; i+=50) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
  }

  const centerX = W / 2;
  const centerY = H / 2;
  
  // Central Turntable (Plataforma Giratoria)
  ctx.save();
  ctx.translate(centerX, centerY);
  
  // Turntable base
  ctx.fillStyle = '#1e293b';
  ctx.beginPath(); ctx.arc(0, 0, 160, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 160, 0, Math.PI*2); ctx.stroke();
  
  // Turntable rotation
  const aRad = (state.physical.currentAngle * Math.PI) / 180;
  ctx.rotate(aRad);
  
  // Cinta 0 (mounted on turntable)
  // Drawn horizontally on the turntable, but center of rotation is at the start of Cinta 0
  ctx.translate(0, 0); // Origin is center of turntable
  // Wait, in previous logic Cinta 0 extends outward from center.
  // Actually, Cinta 0 should bring material FROM hopper TO center.
  // Let's place Hopper at top, Cinta 0 brings it to center. Turntable directs to C1, C2, C3.
  // Original logic: Hopper -> Cinta 0 -> (Angle) -> C1, C2, C3.
  ctx.restore();

  // Let's adjust positions:
  const hopperX = centerX;
  const hopperY = centerY - 300;
  const beltLength = 200;
  const beltWidth = 60;
  
  // CINTA 0 (Hopper to Center)
  drawIsometricBelt(ctx, centerX, centerY - 150, beltWidth, beltLength, 0, state.outputs.MC0, 'CINTA 0 (ALIMENTACIÓN)');
  
  // TURNTABLE (At Center)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.fillStyle = '#0f172a';
  ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2); ctx.stroke();
  
  // Arrow showing rotation direction
  ctx.rotate(aRad);
  ctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-20, 70); ctx.lineTo(20, 70); ctx.fill();
  ctx.restore();

  // DESTINATION BELTS (C1, C2, C3)
  // Pos 1 = 0 deg (Down), Pos 2 = 90 deg (Right), Pos 3 = 180 deg (Up/Left? Wait, previous logic was Left, Right, Down)
  // Let's draw them radially from center.
  // C1 (Left)
  drawIsometricBelt(ctx, centerX - 180, centerY, beltWidth, beltLength, Math.PI/2, state.outputs.MC1, 'CINTA 1');
  // C3 (Right)
  drawIsometricBelt(ctx, centerX + 180, centerY, beltWidth, beltLength, -Math.PI/2, state.outputs.MC3, 'CINTA 3');
  // C2 (Down)
  drawIsometricBelt(ctx, centerX, centerY + 180, beltWidth, beltLength, 0, state.outputs.MC2, 'CINTA 2');

  // HOPPER
  draw3DHopper(ctx, hopperX, hopperY, state.physical.hopperOpenPercent, state.outputs.MTolAb || state.outputs.MTolCe);

  // MATERIAL PARTICLES
  // Cinta 0
  state.physical.materialOnCinta0.forEach(p => {
    // p.x goes from 0 to 1. 0 is at hopper, 1 is at center.
    const px = centerX + (p.y - 15) * 2; // slight scatter
    const py = (centerY - 250) + p.x * beltLength;
    drawMaterialParticle(ctx, px, py, '#f59e0b');
  });
  
  // Destination Belts
  state.physical.materialOnDest.forEach(p => {
    let px = centerX, py = centerY;
    // p.x goes from 0 to 1 (center to edge)
    if (p.cinta === 1) { // Left
      px = (centerX - 80) - p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 3) { // Right
      px = (centerX + 80) + p.x * beltLength;
      py = centerY + (p.y - 15);
    } else if (p.cinta === 2) { // Down
      px = centerX + (p.y - 15);
      py = (centerY + 80) + p.x * beltLength;
    }
    drawMaterialParticle(ctx, px, py, '#10b981');
  });

  // LIMIT SWITCHES
  drawLimitSwitch(ctx, centerX, centerY + 100, state.inputs.FC1, 'FC1 (POS 1)');
  drawLimitSwitch(ctx, centerX + 100, centerY, state.inputs.FC2, 'FC2 (POS 2)');
  drawLimitSwitch(ctx, centerX - 100, centerY, state.inputs.FC3, 'FC3 (POS 3)');
  
  // LOCKDOWN ALERTS
  if (state.control.securityLockdown) {
    ctx.fillStyle = 'rgba(255, 0, 51, 0.2)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff0033';
    ctx.font = 'bold 36px "Share Tech Mono"';
    ctx.textAlign = 'center';
    ctx.fillText('🚨 LOCKDOWN ACTIVO 🚨', W/2, H/2 - 50);
    ctx.font = '20px "Share Tech Mono"';
    ctx.fillText(state.control.securityLockReason, W/2, H/2);
  }
}
