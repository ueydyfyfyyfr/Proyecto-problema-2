import { computeKPIs, computeReliability, computeEnergy } from './stats-engine.js';
import { renderBarChart, renderHorizontalBar, renderDonut } from './charts.js';
import { PLC_STATE } from './plc-simulation.js';

let updateInterval = null;

export function initDashboard() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(refreshDashboard, 1000); // 1 Hz
  
  // Render inicial para que no se vea vacío el primer segundo
  setTimeout(refreshDashboard, 100);
}

function refreshDashboard() {
  const tabAnalytics = document.getElementById('tab-analytics');
  if (!tabAnalytics) return;
  
  const isAnalyticsVisible = !tabAnalytics.classList.contains('hidden');
  if (!isAnalyticsVisible) return;

  const kpis = computeKPIs();
  const rel = computeReliability();
  const energy = computeEnergy();
  
  if (isAnalyticsVisible) {
    const elPower = document.getElementById('kpi-power');
    const elCost = document.getElementById('kpi-cost');
    if (elPower) elPower.innerText = `${energy.totalKWh.toFixed(3)} kWh`;
    if (elCost) elCost.innerText = `$${energy.totalCost.toFixed(3)} USD`;
    
    const labels = ['C0', 'C1', 'C2', 'C3', 'Tolva/MG'];
    const data = [
      energy.motorKWh['MC0'] || 0,
      energy.motorKWh['MC1'] || 0,
      energy.motorKWh['MC2'] || 0,
      energy.motorKWh['MC3'] || 0,
      (energy.motorKWh['MTolAb'] || 0) + (energy.motorKWh['MTolCe'] || 0) + (energy.motorKWh['MGIzq'] || 0) + (energy.motorKWh['MGDer'] || 0)
    ];
    renderBarChart('chart-energy', data, labels, '');

    const cintasHours = [
      ((energy.motorKWh['MC0'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC1'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC2'] || 0) / 1.5).toFixed(2),
      ((energy.motorKWh['MC3'] || 0) / 1.5).toFixed(2)
    ].map(Number);
    renderHorizontalBar('chart-maintenance', cintasHours, ['C0', 'C1', 'C2', 'C3'], 'Horas de uso por cinta (Simulado)');
  
    const elOee = document.getElementById('kpi-oee');
    const elAvail = document.getElementById('kpi-avail');
    const elPerf = document.getElementById('kpi-perf');
    const elMtbf = document.getElementById('kpi-mtbf');
    
    if (elOee) elOee.innerText = `${kpis.oee.toFixed(1)}%`;
    if (elAvail) elAvail.innerText = `${kpis.availability.toFixed(1)}%`;
    if (elPerf) elPerf.innerText = `${kpis.performance.toFixed(1)}%`;
    if (elMtbf) elMtbf.innerText = `${rel.mtbf.toFixed(0)}s`;
    
    const alarms = [
      rel.alarmCountByBelt['C0'] || 0,
      rel.alarmCountByBelt['C1'] || 0,
      rel.alarmCountByBelt['C2'] || 0,
      rel.alarmCountByBelt['C3'] || 0
    ];
    renderBarChart('chart-alarms', alarms, ['C0', 'C1', 'C2', 'C3'], '');
    
    const dest = PLC_STATE?.stats?.batchesByDest || {1:0, 2:0, 3:0};
    const destData = [dest[1] || 0, dest[2] || 0, dest[3] || 0];
    if (destData.some(d => d > 0)) {
        renderDonut('chart-destinations', destData, ['Dest 1', 'Dest 2', 'Dest 3'], ['#00e676', '#ff9100', '#00e5ff']);
    } else {
        renderDonut('chart-destinations', [1], ['Sin Lotes'], ['#333']);
    }
  }
}
