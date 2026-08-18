export function renderGauge(containerId, value, min = 0, max = 100, title = '', suffix = '%') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const angle = (pct / 100) * 180 - 90;
  let color = '#00f0ff';
  if (pct < 50) color = '#d8b4fe';
  if (pct < 20) color = '#ef4444';
  
  const svg = `
    <svg viewBox="0 0 200 120" style="width:100%; height:100%;">
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#333" stroke-width="20" stroke-linecap="round"/>
      <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="${color}" stroke-width="20" stroke-linecap="round" stroke-dasharray="251.2" stroke-dashoffset="${251.2 * (1 - pct/100)}"/>
      <text x="100" y="90" text-anchor="middle" fill="white" font-size="28" font-weight="bold">${Math.round(value)}${suffix}</text>
      <text x="100" y="115" text-anchor="middle" fill="#aaa" font-size="12">${title}</text>
    </svg>
  `;
  container.innerHTML = svg;
}

export function renderBarChart(containerId, data, labels, title = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const maxVal = Math.max(...data, 1);
  const barWidth = 40;
  const spacing = 20;
  const w = Math.max(data.length * (barWidth + spacing) + spacing, 300);
  
  let bars = '';
  data.forEach((val, i) => {
    const h = (val / maxVal) * 80;
    const x = spacing + i * (barWidth + spacing);
    bars += `
      <rect x="${x}" y="${100 - h}" width="${barWidth}" height="${h}" fill="#00f0ff" rx="2" />
      <text x="${x + barWidth/2}" y="115" text-anchor="middle" fill="#aaa" font-size="10">${labels[i]}</text>
      <text x="${x + barWidth/2}" y="${95 - h}" text-anchor="middle" fill="white" font-size="10">${val.toFixed(1)}</text>
    `;
  });
  
  const svg = `
    <svg viewBox="0 0 ${w} 130" style="width:100%; height:100%;">
      ${title ? `<text x="${w/2}" y="15" text-anchor="middle" fill="#ccc" font-size="12">${title}</text>` : ''}
      <line x1="0" y1="100" x2="${w}" y2="100" stroke="#555" stroke-width="1" />
      ${bars}
    </svg>
  `;
  container.innerHTML = svg;
}

export function renderSparkline(containerId, data, color = '#00f0ff') {
  const container = document.getElementById(containerId);
  if (!container || data.length < 2) return;
  
  const w = 100, h = 30;
  const maxVal = Math.max(...data, 0.01);
  const minVal = Math.min(...data);
  const range = maxVal - minVal || 1;
  
  const dx = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * dx;
    const y = h - ((v - minVal) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:100%;" preserveAspectRatio="none">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" />
    </svg>
  `;
  container.innerHTML = svg;
}

export function renderDonut(containerId, data, labels, colors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const total = data.reduce((a,b)=>a+b,0) || 1;
  let acc = 0;
  let paths = '';
  let legend = '';
  
  data.forEach((val, i) => {
    const pct = val / total;
    const angle1 = acc * Math.PI * 2;
    acc += pct;
    const angle2 = acc * Math.PI * 2;
    
    const x1 = 50 + 40 * Math.sin(angle1);
    const y1 = 50 - 40 * Math.cos(angle1);
    const x2 = 50 + 40 * Math.sin(angle2);
    const y2 = 50 - 40 * Math.cos(angle2);
    
    const largeArc = pct > 0.5 ? 1 : 0;
    if (pct >= 1) { 
      paths += `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i]}" stroke-width="15" />`;
    } else if (pct > 0) {
      paths += `<path d="M ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2}" fill="none" stroke="${colors[i]}" stroke-width="15" />`;
    }
    
    legend += `
      <div style="display:flex; align-items:center; font-size:10px; color:#aaa; margin-top:4px;">
        <div style="width:10px; height:10px; background:${colors[i]}; margin-right:5px; border-radius:2px;"></div>
        ${labels[i]}: ${val}
      </div>
    `;
  });
  
  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; height:100%;">
      <svg viewBox="0 0 100 100" style="width:120px; height:120px;">
        ${paths}
        <text x="50" y="55" text-anchor="middle" fill="white" font-size="14" font-weight="bold">${total}</text>
      </svg>
      <div style="margin-left: 20px;">
        ${legend}
      </div>
    </div>
  `;
}

export function renderHorizontalBar(containerId, data, labels, title = '') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  const maxVal = Math.max(...data, 1);
  const barHeight = 20;
  const spacing = 10;
  const h = data.length * (barHeight + spacing) + spacing + 20;
  const w = 300;
  
  let bars = '';
  data.forEach((val, i) => {
    const width = (val / maxVal) * (w - 100);
    const y = spacing + i * (barHeight + spacing) + 20;
    bars += `
      <text x="5" y="${y + 14}" fill="#aaa" font-size="10">${labels[i]}</text>
      <rect x="80" y="${y}" width="${width}" height="${barHeight}" fill="#00f0ff" rx="2" />
      <text x="${80 + width + 5}" y="${y + 14}" fill="white" font-size="10">${val.toFixed(1)}</text>
    `;
  });
  
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:100%;">
      ${title ? `<text x="${w/2}" y="15" text-anchor="middle" fill="#ccc" font-size="12">${title}</text>` : ''}
      ${bars}
    </svg>
  `;
  container.innerHTML = svg;
}

export function renderLineChart(containerId, dataArray, labelsArray, color = '#00f0ff') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (!dataArray || dataArray.length < 2) {
    container.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#666; font-family:monospace; font-size:12px;">Esperando datos de tendencia...</div>`;
    return;
  }
  
  const w = 320, h = 130;
  const padL = 35, padR = 15, padT = 20, padB = 25;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  
  const maxVal = Math.max(...dataArray, 1);
  const minVal = 0;
  const range = maxVal - minVal || 1;
  
  const dx = chartW / (dataArray.length - 1);
  const points = dataArray.map((v, i) => {
    const x = padL + i * dx;
    const y = padT + chartH - ((v - minVal) / range) * chartH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  
  const fillPoints = `${padL},${padT + chartH} ${points} ${padL + chartW},${padT + chartH}`;
  
  const svg = `
    <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:100%;">
      <!-- Grid lines -->
      <line x1="${padL}" y1="${padT}" x2="${padL + chartW}" y2="${padT}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" />
      <line x1="${padL}" y1="${padT + chartH/2}" x2="${padL + chartW}" y2="${padT + chartH/2}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" />
      <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      
      <!-- Area fill -->
      <polygon points="${fillPoints}" fill="${color}" opacity="0.15" />
      
      <!-- Line -->
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      
      <!-- Y-Axis labels -->
      <text x="${padL - 5}" y="${padT + 4}" text-anchor="end" fill="#888" font-size="9" font-family="monospace">${maxVal.toFixed(1)}</text>
      <text x="${padL - 5}" y="${padT + chartH + 3}" text-anchor="end" fill="#888" font-size="9" font-family="monospace">0.0</text>
      
      <!-- Current value badge -->
      <text x="${w - padR}" y="${padT}" text-anchor="end" fill="${color}" font-size="11" font-weight="bold" font-family="monospace">${dataArray[dataArray.length - 1].toFixed(2)}</text>
    </svg>
  `;
  container.innerHTML = svg;
}

