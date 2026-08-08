/**
 * ai-dashboard.js — Dashboard de Analítica e IA Agéntica (§5.3, §5.4)
 *
 * Es el elemento visualmente más destacado de la Fase 2 (RF-IA-12): renderiza
 * los KPIs deterministas de `stats-engine.js` mediante gráficos en Canvas
 * (gauge, barras, líneas, anillo y barra apilada) y presenta las
 * recomendaciones del agente en tarjetas priorizadas por severidad.
 *
 * Degradación elegante (RF-IA-09): si el agente no responde, se muestran las
 * recomendaciones deterministas locales y un aviso de "agente sin conexión".
 * Los gráficos nunca dependen de la red.
 */

import { computeStatistics, computeLocalRecommendations, prioritize, formatSeconds, BASELINE } from './stats-engine.js';
import { requestAnalysis, askAgent, getConnectionState, isConfigured, CONNECTION } from './n8n-connector.js';

const PALETTE = {
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#10b981',
  red: '#f43f5e',
  yellow: '#f59e0b',
  orange: '#f97316',
  violet: '#8b5cf6',
  grid: 'rgba(255,255,255,0.06)',
  text: '#a1a1aa',
  textStrong: '#fafafa'
};

const SEVERITY_STYLE = {
  'Crítica':     { color: PALETTE.red,    icon: '⛔' },
  'Alta':        { color: PALETTE.orange, icon: '⚠️' },
  'Media':       { color: PALETTE.yellow, icon: '🔎' },
  'Informativa': { color: PALETTE.cyan,   icon: 'ℹ️' }
};

// Últimas recomendaciones recibidas del agente (se conservan entre refrescos)
let agentRecommendations = [];
let agentAvailable = false;

// ============================================================
// PUNTO DE ENTRADA — refresco completo del dashboard
// ============================================================

export function renderAIDashboard() {
  const stats = computeStatistics();

  renderKpiCards(stats);
  renderConnectionIndicator();

  drawAvailabilityGauge(document.getElementById('chart-availability'), stats.availability);
  drawBarChart(document.getElementById('chart-alarms'), {
    labels: Object.keys(stats.alarmsByBelt),
    values: Object.values(stats.alarmsByBelt),
    color: PALETTE.red,
    emptyText: 'Sin alarmas registradas'
  });
  drawDonutChart(document.getElementById('chart-destinations'), {
    labels: Object.keys(stats.batchesByDestination).map(p => `Posición ${p}`),
    values: Object.values(stats.batchesByDestination),
    colors: [PALETTE.blue, PALETTE.green, PALETTE.violet],
    emptyText: 'Sin lotes evacuados'
  });
  drawLineChart(document.getElementById('chart-energy'), stats.samples);
  drawStackedStateBar(document.getElementById('chart-states'), stats.timeInState);
  drawBarChart(document.getElementById('chart-security'), {
    labels: Object.keys(stats.securityEvents),
    values: Object.values(stats.securityEvents),
    color: PALETTE.orange,
    emptyText: 'Sin incidentes de seguridad'
  });

  renderRecommendations(stats);
}

// ============================================================
// TARJETAS DE KPI
// ============================================================

function renderKpiCards(stats) {
  setText('ai-kpi-availability', (stats.availability * 100).toFixed(1) + ' %');
  setText('ai-kpi-mtbf', formatSeconds(stats.mtbfSeconds));
  setText('ai-kpi-mttr', formatSeconds(stats.mttrSeconds));
  setText('ai-kpi-kwh-batch', stats.kwhPerBatch.toFixed(4) + ' kWh');
  setText('ai-kpi-throughput', stats.throughputPerHour.toFixed(1) + ' /h');
  setText('ai-kpi-cost', '$' + stats.operatingCostUSD.toFixed(4));

  // Semáforo de la disponibilidad frente al objetivo
  const availEl = document.getElementById('ai-kpi-availability');
  if (availEl) {
    availEl.style.color = stats.availability >= BASELINE.availabilityTarget
      ? PALETTE.green
      : (stats.availability >= 0.6 ? PALETTE.yellow : PALETTE.red);
  }

  // Tendencia del consumo por lote
  const trendEl = document.getElementById('ai-kpi-trend');
  if (trendEl) {
    if (!stats.trends.enoughData) {
      trendEl.textContent = 'Recopilando datos…';
      trendEl.style.color = PALETTE.text;
    } else {
      const d = stats.trends.energyPerBatchDeltaPct;
      const arrow = d > 2 ? '▲' : (d < -2 ? '▼' : '▬');
      trendEl.textContent = `${arrow} ${Math.abs(d).toFixed(1)} % vs. primera mitad`;
      trendEl.style.color = d > 10 ? PALETTE.red : (d < -5 ? PALETTE.green : PALETTE.text);
    }
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ============================================================
// INDICADOR DE ESTADO DEL AGENTE (RF-IA-11)
// ============================================================

export function renderConnectionIndicator() {
  const led = document.getElementById('ai-agent-led');
  const label = document.getElementById('ai-agent-status-label');
  if (!led || !label) return;

  const { state, lastError } = getConnectionState();
  const map = {
    [CONNECTION.CONNECTED]:  { cls: 'led-green',  txt: 'Agente conectado' },
    [CONNECTION.PROCESSING]: { cls: 'led-yellow', txt: 'Agente procesando…' },
    [CONNECTION.ERROR]:      { cls: 'led-red',    txt: 'Error del agente: ' + lastError },
    [CONNECTION.OFFLINE]:    { cls: 'led-off',    txt: isConfigured() ? 'Agente en espera' : 'Agente sin configurar' }
  };
  const cfg = map[state] || map[CONNECTION.OFFLINE];
  led.className = 'led-indicator ' + cfg.cls;
  label.textContent = cfg.txt;
}

// ============================================================
// RECOMENDACIONES (RF-IA-04, RF-IA-05, RF-IA-06, RF-IA-09)
// ============================================================

function renderRecommendations(stats) {
  const container = document.getElementById('ai-recommendations');
  if (!container) return;

  const local = computeLocalRecommendations(stats);
  const all = prioritize([...agentRecommendations, ...local]);

  const banner = agentAvailable
    ? `<div class="ai-source-banner ai-source-agent">🤖 Recomendaciones enriquecidas por el agente de IA (n8n) sobre la analítica local.</div>`
    : `<div class="ai-source-banner ai-source-local">📊 Agente sin conexión — se muestran las recomendaciones deterministas calculadas localmente.</div>`;

  container.innerHTML = banner + all.map(r => {
    const s = SEVERITY_STYLE[r.severity] || SEVERITY_STYLE['Informativa'];
    const origin = r.fromAgent
      ? '<span class="ai-rec-origin ai-origin-agent">Agente IA</span>'
      : '<span class="ai-rec-origin ai-origin-local">Cálculo local</span>';
    return `
      <div class="ai-rec-card" style="border-left-color:${s.color};">
        <div class="ai-rec-head">
          <span class="ai-rec-severity" style="background:${s.color}22;color:${s.color};">
            ${s.icon} ${escapeHtml(r.severity)}
          </span>
          <span class="ai-rec-category">${escapeHtml(r.category)}</span>
          ${origin}
        </div>
        <p class="ai-rec-finding">${escapeHtml(r.finding)}</p>
        <p class="ai-rec-evidence"><strong>Evidencia:</strong> ${escapeHtml(r.evidence)}</p>
        <p class="ai-rec-action"><strong>Acción sugerida:</strong> ${escapeHtml(r.action)}</p>
      </div>`;
  }).join('');
}

/** Solicita el análisis al agente y refresca el panel */
export async function refreshAgentAnalysis() {
  const btn = document.getElementById('btn-ai-analyze');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Consultando al agente…'; }
  renderConnectionIndicator();

  const result = await requestAnalysis();
  agentAvailable = result.ok;
  agentRecommendations = result.ok ? result.recommendations : [];

  if (btn) { btn.disabled = false; btn.textContent = '🤖 Analizar con IA'; }
  renderAIDashboard();
  return result;
}

/** Consulta en lenguaje natural (RF-IA-08) */
export async function submitAgentQuestion(question) {
  const out = document.getElementById('ai-answer-box');
  if (out) {
    out.style.display = 'block';
    out.innerHTML = '<em>Consultando al agente…</em>';
  }
  renderConnectionIndicator();

  const result = await askAgent(question);
  if (out) {
    out.innerHTML = result.ok
      ? `<strong>Respuesta del agente:</strong><br>${escapeHtml(result.answer)}`
      : `<span class="ai-answer-error">El agente no está disponible (${escapeHtml(result.error)}). Consulta las estadísticas locales del panel superior.</span>`;
  }
  renderConnectionIndicator();
  return result;
}

// ============================================================
// GRÁFICOS EN CANVAS (sin dependencias externas)
// ============================================================

/** Prepara el contexto y devuelve las dimensiones lógicas del canvas */
function setupCanvas(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return { ctx, W: canvas.width, H: canvas.height };
}

function drawEmptyState(ctx, W, H, text) {
  ctx.fillStyle = PALETTE.text;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
}

/** Indicador tipo gauge para la disponibilidad */
export function drawAvailabilityGauge(canvas, value) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, W, H } = s;

  const cx = W / 2;
  const cy = H * 0.72;
  const radius = Math.min(W * 0.38, H * 0.6);
  const start = Math.PI;
  const end = 2 * Math.PI;

  // Arco de fondo
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  // Arco de valor con degradado según el rendimiento
  const color = value >= BASELINE.availabilityTarget ? PALETTE.green
              : (value >= 0.6 ? PALETTE.yellow : PALETTE.red);
  const grad = ctx.createLinearGradient(cx - radius, 0, cx + radius, 0);
  grad.addColorStop(0, color + '66');
  grad.addColorStop(1, color);

  ctx.strokeStyle = grad;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, start + Math.PI * Math.min(Math.max(value, 0), 1));
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Marca del objetivo
  const targetAngle = start + Math.PI * BASELINE.availabilityTarget;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(targetAngle) * (radius - 12), cy + Math.sin(targetAngle) * (radius - 12));
  ctx.lineTo(cx + Math.cos(targetAngle) * (radius + 12), cy + Math.sin(targetAngle) * (radius + 12));
  ctx.stroke();

  // Valor central
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.textStrong;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText((value * 100).toFixed(1) + '%', cx, cy - 6);

  ctx.fillStyle = PALETTE.text;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`Objetivo ${(BASELINE.availabilityTarget * 100).toFixed(0)}%`, cx, cy + 16);
}

/** Gráfico de barras verticales */
export function drawBarChart(canvas, { labels, values, color, emptyText }) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, W, H } = s;

  const total = values.reduce((a, b) => a + b, 0);
  if (!labels.length || total === 0) {
    drawEmptyState(ctx, W, H, emptyText || 'Sin datos');
    return;
  }

  const padL = 34, padR = 12, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...values, 1);

  // Rejilla horizontal con escala
  ctx.strokeStyle = PALETTE.grid;
  ctx.fillStyle = PALETTE.text;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(Math.round(max * i / 4), padL - 6, y + 3);
  }

  const slot = plotW / labels.length;
  const barW = Math.min(slot * 0.55, 48);

  labels.forEach((label, i) => {
    const v = values[i];
    const h = (v / max) * plotH;
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + plotH - h;

    const grad = ctx.createLinearGradient(0, y, 0, padT + plotH);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + '33');
    ctx.fillStyle = grad;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    roundRect(ctx, x, y, barW, Math.max(h, 2), 4);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Valor sobre la barra
    ctx.fillStyle = PALETTE.textStrong;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    if (v > 0) ctx.fillText(v, x + barW / 2, y - 5);

    // Etiqueta
    ctx.fillStyle = PALETTE.text;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(shorten(label, 12), x + barW / 2, H - 9);
  });
}

/** Gráfico de anillo (dona) con leyenda */
export function drawDonutChart(canvas, { labels, values, colors, emptyText }) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, W, H } = s;

  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    drawEmptyState(ctx, W, H, emptyText || 'Sin datos');
    return;
  }

  const cx = W * 0.34;
  const cy = H / 2;
  const outer = Math.min(W * 0.28, H * 0.40);
  const inner = outer * 0.6;

  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    if (v === 0) return;
    const slice = (v / total) * Math.PI * 2;
    const color = colors[i % colors.length];

    ctx.beginPath();
    ctx.arc(cx, cy, outer, angle, angle + slice);
    ctx.arc(cx, cy, inner, angle + slice, angle, true);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    angle += slice;
  });

  // Total en el centro
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.textStrong;
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(total, cx, cy + 2);
  ctx.fillStyle = PALETTE.text;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('lotes', cx, cy + 17);

  // Leyenda
  ctx.textAlign = 'left';
  const lx = W * 0.62;
  let ly = cy - (labels.length * 20) / 2 + 8;
  labels.forEach((label, i) => {
    const pct = total > 0 ? (values[i] / total) * 100 : 0;
    ctx.fillStyle = colors[i % colors.length];
    roundRect(ctx, lx, ly - 8, 10, 10, 3);
    ctx.fill();
    ctx.fillStyle = PALETTE.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${label} — ${pct.toFixed(0)} %`, lx + 16, ly + 1);
    ly += 20;
  });
}

/** Serie temporal de consumo energético y lotes acumulados */
export function drawLineChart(canvas, samples) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, W, H } = s;

  if (!samples || samples.length < 2) {
    drawEmptyState(ctx, W, H, 'Recopilando serie histórica…');
    return;
  }

  const padL = 40, padR = 40, padT = 16, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const kwhValues = samples.map(p => p.kwh);
  const batchValues = samples.map(p => p.batches);
  const maxKwh = Math.max(...kwhValues, 0.0001);
  const maxBatch = Math.max(...batchValues, 1);

  // Rejilla
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }

  const xAt = i => padL + (plotW * i) / (samples.length - 1);

  // Área + línea de energía
  const yKwh = v => padT + plotH - (v / maxKwh) * plotH;
  const areaGrad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  areaGrad.addColorStop(0, PALETTE.cyan + '55');
  areaGrad.addColorStop(1, PALETTE.cyan + '00');
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  samples.forEach((p, i) => ctx.lineTo(xAt(i), yKwh(p.kwh)));
  ctx.lineTo(W - padR, padT + plotH);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  ctx.beginPath();
  samples.forEach((p, i) => (i === 0 ? ctx.moveTo(xAt(i), yKwh(p.kwh)) : ctx.lineTo(xAt(i), yKwh(p.kwh))));
  ctx.strokeStyle = PALETTE.cyan;
  ctx.lineWidth = 2;
  ctx.shadowColor = PALETTE.cyan;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Línea de lotes acumulados (eje derecho)
  const yBatch = v => padT + plotH - (v / maxBatch) * plotH;
  ctx.beginPath();
  samples.forEach((p, i) => (i === 0 ? ctx.moveTo(xAt(i), yBatch(p.batches)) : ctx.lineTo(xAt(i), yBatch(p.batches))));
  ctx.strokeStyle = PALETTE.green;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ejes y leyenda
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.cyan;
  ctx.fillText(maxKwh.toFixed(3) + ' kWh', padL - 4, padT + 8);
  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.green;
  ctx.fillText(maxBatch + ' lotes', W - padR + 4, padT + 8);

  ctx.fillStyle = PALETTE.text;
  ctx.textAlign = 'center';
  ctx.fillText('— Energía acumulada   ┄ Lotes acumulados', W / 2, H - 7);
}

/** Barra apilada horizontal del tiempo en cada estado */
export function drawStackedStateBar(canvas, timeInState) {
  const s = setupCanvas(canvas);
  if (!s) return;
  const { ctx, W, H } = s;

  const stateColors = {
    IDLE: '#52525b',
    ROTATING: PALETTE.blue,
    RUNNING: PALETTE.green,
    DISCHARGING_C0: PALETTE.cyan,
    DISCHARGING_DEST: PALETTE.violet,
    ALARM: PALETTE.red,
    EMERGENCY_LOCK: PALETTE.orange
  };

  const entries = Object.entries(timeInState).filter(([, v]) => v > 0.5);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total === 0) {
    drawEmptyState(ctx, W, H, 'Sin tiempo de operación acumulado');
    return;
  }

  const barX = 12, barY = 18, barW = W - 24, barH = 30;
  let x = barX;

  ctx.save();
  roundRect(ctx, barX, barY, barW, barH, 6);
  ctx.clip();
  entries.forEach(([state, secs]) => {
    const w = (secs / total) * barW;
    ctx.fillStyle = stateColors[state] || PALETTE.text;
    ctx.fillRect(x, barY, w, barH);
    // Porcentaje dentro del segmento si cabe
    const pct = (secs / total) * 100;
    if (w > 42) {
      ctx.fillStyle = '#0a0a14';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pct.toFixed(0) + '%', x + w / 2, barY + barH / 2 + 4);
    }
    x += w;
  });
  ctx.restore();

  // Leyenda en dos filas
  ctx.textAlign = 'left';
  ctx.font = '10px system-ui, sans-serif';
  let lx = barX, ly = barY + barH + 20;
  entries.forEach(([state, secs]) => {
    const label = `${state} ${formatSeconds(secs)}`;
    const w = ctx.measureText(label).width + 22;
    if (lx + w > W - 8) { lx = barX; ly += 16; }
    ctx.fillStyle = stateColors[state] || PALETTE.text;
    roundRect(ctx, lx, ly - 8, 9, 9, 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(label, lx + 14, ly);
    lx += w;
  });
}

// ============================================================
// UTILIDADES
// ============================================================

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shorten(text, max) {
  const t = String(text);
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Escapado obligatorio: el texto del agente jamás se inyecta como HTML (S-2) */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mantener el LED de conexión sincronizado con el conector
window.addEventListener('n8n-connection-changed', renderConnectionIndicator);
