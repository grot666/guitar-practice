// audio.js — 麦克风采集与节拍器（Web Audio API）
import { CLICK } from './dsp.js';
import { renderBass, BASS_TONES } from './bass.js';
export class AudioEngine {
  constructor() {
    this.ctx = null; this.stream = null; this.source = null; this.node = null;
    this.listeners = new Set();
    this.ring = new Float32Array(8192); this.ringPos = 0; this.ringFilled = 0;
    this.lastFrameTime = 0;
  }
  ensureContext() {
    if (!this.ctx) {
      this._setSession(); // iOS：要在创建 AudioContext 之前设好音频会话类型
      const AC = window.AudioContext || window.webkitAudioContext;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.ctx = new AC(); }
      // 输出总线：主音量 → 限幅器 → 输出 → 扬声器。拨弦音色已归一化，限幅器防止多层叠加时爆音
      this.master = this.ctx.createGain(); this.master.gain.value = 1;
      const lim = this.ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.05;
      this.out = this.ctx.createGain(); this.out.gain.value = 1;
      this.master.connect(lim); lim.connect(this.out); this.out.connect(this.ctx.destination);
      this.ctx.onstatechange = () => this._emit();
    }
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') { try { const p = this.ctx.resume(); p && p.catch && p.catch(() => {}); } catch {} }
    return this.ctx;
  }
  /**
   * 同步解锁：必须在用户点按的事件处理里调用（前面不能有 await）。
   * 创建/恢复 AudioContext，播一段 1 样本的静音；keepAlive 时在老 iOS 上再播一个循环的静音 <audio>，
   * 让系统把它当成「媒体播放」，静音拨片打开时 Web Audio 也不会被静音。
   */
  unlockSync(keepAlive = false) {
    this._setSession();
    const ctx = this.ensureContext();
    if (!this._unlocked || ctx.state !== 'running') {
      try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); } catch {}
      this._unlocked = true;
    }
    if (keepAlive) this._keepAlive();
    return ctx;
  }
  /** 播放前调用：同步解锁 + 等待 resume（最多 0.5 秒，iOS 被打断时 resume 可能一直不返回） */
  async unlock() {
    const ctx = this.unlockSync(true);
    if (ctx.state !== 'running') {
      try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]); } catch {}
    }
    this.checkRunning();
    return ctx.state === 'running';
  }
  get isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  _keepAlive() {
    // 只在没有 navigator.audioSession 的老 iOS（≤16）上需要；开着麦克风时不用（会话是 play-and-record）
    if (!this.isIOS || navigator.audioSession || this.stream) return;
    if (!this._silentEl) {
      const sr = 8000, n = sr / 2, b = new DataView(new ArrayBuffer(44 + n * 2));
      const w = (o, str) => [...str].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
      b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
      const el = document.createElement('audio');
      el.src = URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
      el.loop = true; el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny'); el.preload = 'auto';
      this._silentEl = el;
    }
    if (this._silentEl.paused) { try { const p = this._silentEl.play(); p && p.catch && p.catch(() => {}); } catch {} }
  }
  /** 播放后检查：0.6 秒后还没运行，就通知界面显示「点一下开启声音」 */
  checkRunning() {
    if (this._chk) return;
    this._chk = setTimeout(() => { this._chk = 0; this._emit(); }, 600);
  }
  get blocked() { return !!this.ctx && this.ctx.state !== 'running'; }
  onState(fn) { (this._stateFns = this._stateFns || new Set()).add(fn); }
  _emit() { (this._stateFns || []).forEach((f) => f(this.ctx ? this.ctx.state : 'none')); }
  /** iOS 17+：没开麦克风时用 playback，静音拨片打开也能出声；开麦克风时用 play-and-record */
  _setSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = this.stream ? 'play-and-record' : 'playback'; } catch {}
  }
  get sessionType() { try { return navigator.audioSession ? navigator.audioSession.type : ''; } catch { return ''; } }
  get micOn() { return !!this.stream; }
  async startMic(deviceId) {
    if (this.stream) return;
    if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { code: 'insecure' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
    const ctx = this.ensureContext();
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
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
    if (this._silentEl && !this._silentEl.paused) this._silentEl.pause();
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
  async listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }
  get deviceId() { const t = this.stream && this.stream.getAudioTracks()[0]; return t ? (t.getSettings().deviceId || '') : ''; }
  get deviceLabel() { const t = this.stream && this.stream.getAudioTracks()[0]; return t ? t.label : ''; }
  /** 合成一个拨弦音（Karplus-Strong，结果缓存），用于示范演奏和点按指板试听 */
  _pluckBuffer(midi) {
    this._pl = this._pl || new Map();
    if (this._pl.has(midi)) return this._pl.get(midi);
    const ctx = this.ctx, sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
    const n = Math.round(sr * 1.6), buf = ctx.createBuffer(1, n, sr), x = buf.getChannelData(0);
    // 这种环形写法的周期 = L − 0.5（平均滤波读的是下一个样本），再加全通滤波的小数延迟 d，在任何采样率下都调准
    const P = sr / f; let L = Math.floor(P + 0.5), d = P + 0.5 - L;
    if (d < 0.1) { L -= 1; d += 1; }
    L = Math.max(2, L);
    const C = (1 - d) / (1 + d), line = new Float32Array(L);
    // 初始噪声（确定性的 LCG，每个音高固定，结果可缓存）
    let seed = (midi * 7919 + 104729) % 233280;
    for (let i = 0; i < L; i++) { seed = (seed * 9301 + 49297) % 233280; line[i] = (seed / 233280) * 2 - 1; }
    // 先低通一下初始噪声，音色更柔和
    for (let k = 0; k < 2; k++) for (let i = 1; i < L; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
    // 去掉直流分量：随机噪声的均值不为 0，Karplus-Strong 的平均滤波会一直保留它（听不见、却占掉音量和限幅余量）
    { let m = 0; for (let i = 0; i < L; i++) m += line[i]; m /= L; for (let i = 0; i < L; i++) line[i] -= m; }
    let idx = 0;
    const decay = 0.996 - (midi - 50) * 0.0001;
    let apX = 0, apY = 0;
    for (let i = 0; i < n; i++) {
      const a = line[idx], b = line[(idx + 1) % L];
      x[i] = a;
      const avg = decay * 0.5 * (a + b);
      const y = C * avg + apX - C * apY; apX = avg; apY = y; // 一阶全通：小数延迟
      line[idx] = y;
      idx = (idx + 1) % L;
    }
    const fade = Math.round(sr * 0.05);
    for (let i = 0; i < fade; i++) x[n - 1 - i] *= i / fade;
    // 归一化到峰值 0.6：不同音高、不同采样率（44.1k / 48k）响度一致，手机外放也够响
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
    if (pk > 0) { const k = 0.6 / pk; for (let i = 0; i < n; i++) x[i] *= k; }
    this._pl.set(midi, buf);
    return buf;
  }
  /** 在时刻 t 弹一个音；dur 秒后止音 */
  pluck(midi, t, dur = 1.2, vol = 0.8) {
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this._pluckBuffer(midi);
    t = t ?? ctx.currentTime + 0.02;
    g.gain.setValueAtTime(vol, t);
    g.gain.setTargetAtTime(0, t + Math.max(0.05, dur), 0.04);
    src.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + Math.max(0.05, dur) + 0.3);
    if (ctx.state !== 'running') this.checkRunning();
    return src;
  }
  /** 低音音色（见 bass.js），按 音色/音高/长度 缓存 */
  _bassBuffer(tone, midi, seconds) {
    this._bs = this._bs || new Map();
    const key = `${tone}:${midi}:${seconds}`;
    if (this._bs.has(key)) return this._bs.get(key);
    const ctx = this.ctx, data = renderBass(tone, midi, ctx.sampleRate, seconds);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    if (buf.copyToChannel) buf.copyToChannel(data, 0); else buf.getChannelData(0).set(data);
    this._bs.set(key, buf);
    return buf;
  }
  /** 在时刻 t 弹一个低音；dur 秒后 50 ms 内止音（像手指按住弦止音，不会「咔」一声） */
  bass(midi, t, dur = 1, vol = 0.6, tone = 'warm') {
    const ctx = this.ensureContext();
    const seconds = Math.max(2.5, Math.ceil((dur + 0.6) * 2) / 2);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this._bassBuffer(BASS_TONES[tone] ? tone : 'warm', midi, seconds);
    t = t ?? ctx.currentTime + 0.02;
    const v = vol * (BASS_TONES[tone] ? BASS_TONES[tone].gain : 1), end = t + Math.max(0.08, dur);
    g.gain.setValueAtTime(v, t);
    g.gain.setTargetAtTime(0, end, 0.05);
    src.connect(g); g.connect(this.master);
    src.start(t); src.stop(Math.min(t + seconds, end + 0.4));
    if (ctx.state !== 'running') this.checkRunning();
    return src;
  }
  /** 预先算好低音（打开编曲页时在空闲时间调用，第一次播放不卡） */
  warmBass(tone, midis) { if (!this.ctx) return; for (const m of midis) this._bassBuffer(tone, m, 2.5); }
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
    if (ctx.state !== 'running') this.engine.checkRunning();
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
