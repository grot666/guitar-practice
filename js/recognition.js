// 单声道 PCM + 音频时钟 → 音高观测。麦克风和离线回放使用同一入口。
import { centsBetween, detectPitch, rms } from './dsp.js';

export class PitchRecognizer {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.window = new Float32Array(sampleRate > 60000 ? 4096 : 2048);
    this.scratch = new Float32Array(this.window.length);
    this.hop = Math.min(this.window.length, Math.round(sampleRate * 0.04));
    this.reset();
  }

  reset() {
    this.filled = 0;
    this.nextTime = null;
    this.history = [];
    this.lastPitch = null;
  }

  process(samples, startTime, gate, emit) {
    // 断流后的第一帧必须全部来自新输入。
    if (this.nextTime !== null && Math.abs(startTime - this.nextTime) > 2 / this.sampleRate) this.reset();
    this.nextTime = startTime + samples.length / this.sampleRate;
    let offset = 0;
    while (offset < samples.length) {
      const count = Math.min(samples.length - offset, this.window.length - this.filled);
      this.window.set(samples.subarray(offset, offset + count), this.filled);
      this.filled += count;
      offset += count;
      if (this.filled < this.window.length) continue;
      const time = startTime + (offset - this.window.length / 2) / this.sampleRate;
      emit(this.observe(time, gate));
      this.window.copyWithin(0, this.hop);
      this.filled = this.window.length - this.hop;
    }
  }

  observe(time, gate) {
    const result = detectPitch(this.window, this.sampleRate, { rmsGate: gate, _scratch: this.scratch });
    const level = result?.rms ?? rms(this.window);
    const raw = result?.freq ?? null;
    let freq = null;
    if (raw !== null) {
      if (this.history.length && Math.abs(centsBetween(raw, this.lastPitch.freq)) > 80) this.history = [];
      this.history.push(raw);
      if (this.history.length > 5) this.history.shift();
      const sorted = [...this.history].sort((a, b) => a - b);
      freq = sorted[sorted.length >> 1];
      this.lastPitch = { freq, time };
    } else this.history = [];
    const held = !freq && !!this.lastPitch && time - this.lastPitch.time < 0.8;
    return { time, raw, freq, held, show: held ? this.lastPitch.freq : freq,
      rms: level, db: level > 0 ? 20 * Math.log10(level) : -100, clarity: result?.clarity ?? null,
      gate, status: raw ? 'voiced' : level < gate ? 'below_gate' : 'unresolved' };
  }
}
