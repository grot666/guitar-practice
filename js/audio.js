// audio.js — 麦克风采集与节拍器（Web Audio API）
import { CLICK } from './dsp.js';
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
      // 输出总线：主音量 → 限幅器 → 扬声器，开大音量也不会爆音
      this.master = this.ctx.createGain(); this.master.gain.value = 1;
      const lim = this.ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.05;
      this.master.connect(lim); lim.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
  /** 必须在用户点击里调用：等 AudioContext 真正运行，再播一段静音“解锁”iOS 的声音输出 */
  async unlock() {
    const ctx = this.ensureContext();
    this._setSession();
    try { if (ctx.state !== 'running') await ctx.resume(); } catch {}
    if (!this._unlocked) {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource();
      src.buffer = b; src.connect(ctx.destination); src.start();
      this._unlocked = true;
    }
    return ctx.state === 'running';
  }
  /** iOS 17+：没开麦克风时用 playback，静音拨片打开也能出声；开麦克风时用 play-and-record */
  _setSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = this.stream ? 'play-and-record' : 'playback'; } catch {}
  }
  get micOn() { return !!this.stream; }
  async startMic() {
    if (this.stream) return;
    if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { code: 'insecure' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    const ctx = this.ensureContext();
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
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
    this._setSession();
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
  /** 运行中改速度/细分：以下一拍为基准重新对齐，避免时间轴跳变 */
  set(params) {
    const run = this.running;
    Object.assign(this, params);
    if (run) {
      const perBar = this.beatsPerBar * this.subdiv;
      this.index = Math.ceil(this.index / perBar) * perBar; // 新小节开始
      this.startTime = this.nextTime - this.index * this.tickInterval;
    }
  }
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
    const strong = info.sub === 0 && info.beat === 0 && this.accent;
    const main = info.sub === 0;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = strong ? CLICK.accent : main ? CLICK.beat : CLICK.sub;
    const v = Math.max(0.0002, this.volume * (strong ? 1 : main ? 0.75 : 0.45));
    // 平滑包络（4ms 起音、指数衰减），频谱集中在 2.4–3.6 kHz，外放模式可以把它和拨弦分开
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + CLICK.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + CLICK.attack + CLICK.decay * 5);
    osc.connect(g); g.connect(this.engine.master);
    osc.start(t); osc.stop(t + CLICK.length + 0.02);
  }
  /** 试听：立刻响 4 下（第一下重音） */
  async test() {
    await this.engine.unlock();
    const t0 = this.engine.ctx.currentTime + 0.08, iv = 0.5;
    for (let i = 0; i < 4; i++) this._click(t0 + i * iv, { beat: i, sub: 0 });
    return t0;
  }
}
