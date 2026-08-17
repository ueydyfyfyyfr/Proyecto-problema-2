import { PLC_STATE } from './plc-simulation.js';

export class HistoryStore {
  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
    this.key = 'plcHistory';
    this.buffer = this.load();
    this.startSampling();
  }

  load() {
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  }

  save() {
    localStorage.setItem(this.key, JSON.stringify(this.buffer));
  }

  push(sample) {
    this.buffer.push(sample);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    this.save();
  }

  range(desde, hasta) {
    return this.buffer.filter(s => s.t >= desde && s.t <= hasta);
  }

  downsample(n) {
    if (this.buffer.length <= n) return this.buffer;
    const result = [];
    const step = this.buffer.length / n;
    for (let i = 0; i < n; i++) {
      result.push(this.buffer[Math.floor(i * step)]);
    }
    return result;
  }

  clear() {
    this.buffer = [];
    this.save();
  }

  sizeBytes() {
    return localStorage.getItem(this.key)?.length || 0;
  }

  getLatest() {
    return this.buffer[this.buffer.length - 1] || null;
  }

  getAll() {
    return this.buffer;
  }

  startSampling() {
    setInterval(() => {
      // Tomar muestra si el PLC ha sido usado
      if (PLC_STATE.physical.runTimeSeconds > 0) {
        let activeMotors = 0;
        ['MC0','MC1','MC2','MC3','MGIzq','MGDer','MTolAb','MTolCe'].forEach(m => {
          if (PLC_STATE.outputs[m]) activeMotors++;
        });
        
        let alarmSum = 0;
        if (PLC_STATE.stats && PLC_STATE.stats.alarmCount) {
          alarmSum = Object.values(PLC_STATE.stats.alarmCount).reduce((a,b) => a+b, 0);
        }

        this.push({
          t: Date.now(),
          status: PLC_STATE.control.status,
          batches: PLC_STATE.physical.batchesProcessed,
          units: PLC_STATE.physical.unitsTransferred || 0,
          scrap: PLC_STATE.stats ? PLC_STATE.stats.scrapCount : 0,
          kWh: PLC_STATE.physical.powerConsumptionKWh,
          activeMotors: activeMotors,
          alarmCount: alarmSum
        });
      }
    }, 5000);
  }
}

export const historyStore = new HistoryStore();
