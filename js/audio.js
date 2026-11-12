// audio.js — 麦克风采集与节拍器（Web Audio API）
export class AudioEngine {
  constructor() {
    this.ctx = null; this.stream = null; this.source = null; this.node = null;
    this.listeners = new Set();
    this.ring = new Float32Array(8192); this.ringPos = 0; this.ringFilled = 0;
    this.lastFrameTime = 0;
  }
  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  get micOn() { return !!this.stream; }
  async startMic() {
    if (this.stream) return;
    if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { code: 'insecure' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    const ctx = this.ensureContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);
    if (ctx.audioWorklet && window.AudioWorkletNode) {
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = (e) => this._onChunk(e.data.data, e.data.frame / ctx.sampleRate);
    } else {
      // 旧浏览器后备：ScriptProcessor
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = (e) => {
        const d = new Float32Array(e.inputBuffer.getChannelData(0));
        const t = (e.playbackTime || ctx.currentTime) - d.length / ctx.sampleRate;
        this._onChunk(d, t);
      };
      this.node = sp;
    }
    this.source.connect(this.node); this.node.connect(sink);
    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.stopMic());
  }
  stopMic() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    try { this.source && this.source.disconnect(); this.node && this.node.disconnect(); } catch {}
    this.stream = null; this.source = null; this.node = null;
  }
  _onChunk(data, startTime) {
    const r = this.ring, L = r.length;
    for (let i = 0; i < data.length; i++) { r[this.ringPos] = data[i]; this.ringPos = (this.ringPos + 1) % L; }
    this.ringFilled = Math.min(L, this.ringFilled + data.length);
    this.lastFrameTime = startTime + data.length / this.ctx.sampleRate;
    for (const fn of this.listeners) fn(data, startTime);
  }
  onChunk(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** 取最近 n 个样本 */
  latest(n, out) {
    const r = this.ring, L = r.length;
    out = out && out.length === n ? out : new Float32Array(n);
    let p = (this.ringPos - n + L) % L;
    for (let i = 0; i < n; i++) { out[i] = r[p]; p = (p + 1) % L; }
    return out;
  }
}

/** 节拍器：lookahead 调度（setInterval 25ms，提前 120ms 排程到 AudioContext 时间轴） */
export class Metronome {
  constructor(engine) {
    this.engine = engine;
    this.bpm = 80; this.beatsPerBar = 4; this.subdiv = 1; this.accent = true; this.sound = true; this.volume = 0.7;
    this.running = false; this.timer = null;
    this.onTick = null; // (time, {bar, beat, sub, index}) 每个细分点触发（已排程时间）
  }
  get tickInterval() { return 60 / this.bpm / this.subdiv; }
  start(startDelay = 0.15) {
    const ctx = this.engine.ensureContext();
    this.running = true;
    this.nextTime = ctx.currentTime + startDelay;
    this.startTime = this.nextTime;
    this.index = 0;
    this._schedule();
    this.timer = setInterval(() => this._schedule(), 25);
    return this.startTime;
  }
  stop() { this.running = false; clearInterval(this.timer); this.timer = null; }
  _schedule() {
    const ctx = this.engine.ctx;
    while (this.running && this.nextTime < ctx.currentTime + 0.12) {
      const perBar = this.beatsPerBar * this.subdiv;
      const inBar = this.index % perBar;
      const info = { index: this.index, bar: Math.floor(this.index / perBar), beat: Math.floor(inBar / this.subdiv), sub: inBar % this.subdiv };
      if (this.sound) this._click(this.nextTime, info);
      this.onTick && this.onTick(this.nextTime, info);
      this.index++;
      this.nextTime = this.startTime + this.index * this.tickInterval; // 用乘法避免累积误差
    }
  }
  _click(t, info) {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    const strong = info.sub === 0 && info.beat === 0 && this.accent;
    const main = info.sub === 0;
    osc.frequency.value = strong ? 1760 : main ? 1320 : 880;
    const v = this.volume * (strong ? 1 : main ? 0.7 : 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.05);
  }
}
