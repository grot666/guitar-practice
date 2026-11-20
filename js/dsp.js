// dsp.js — 纯计算模块（浏览器与 Node 共用，无 DOM 依赖）
// 包含：音名换算、McLeod 音高检测 (MPM)、频谱通量起音检测、节奏匹配与评分、音准练习跟踪器

/** 节拍器“嘀”声参数（浏览器与测试共用）：纯高频正弦 + 平滑包络，频谱集中在 2.3 kHz 以上 */
export const CLICK = { accent: 3520, beat: 2960, sub: 2490, attack: 0.004, decay: 0.035, length: 0.2 };
/** 外放模式：起音检测跳过节拍器“嘀”所在的频段（Hz），其余频段（含高频拨弦瞬态）照常使用 */
export const SPEAKER_BAND = { notchLo: 2100, notchHi: 4300, maxHz: 7000, delta: 0.05 }; // 7 kHz 以上也不看：手机扬声器失真会产生嘀声的 3 次谐波（≥7.4 kHz）
/** 按 CLICK 参数合成一段嘀声（离线测试用，与浏览器里的振荡器包络一致） */
export function synthClick(freq, sr, amp = 0.8) {
  const n = Math.round(CLICK.length * sr), x = new Float32Array(n), a = CLICK.attack * sr;
  for (let i = 0; i < n; i++) {
    const env = i < a ? 0.5 - 0.5 * Math.cos((Math.PI * i) / a) : Math.exp(-(i - a) / (CLICK.decay * sr));
    const tail = Math.min(1, (n - i) / (0.02 * sr)); // 结尾淡出到 0，避免截断产生宽频“咔”
    x[i] = amp * env * tail * Math.sin((2 * Math.PI * freq * i) / sr);
  }
  return x;
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_NAMES_ZH = ['C', '#C', 'D', '#D', 'E', 'F', '#F', 'G', '#G', 'A', '#A', 'B'];

export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}
export function freqToMidiFloat(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}
export function midiName(midi) {
  const n = ((midi % 12) + 12) % 12;
  return NOTE_NAMES[n] + (Math.floor(midi / 12) - 1);
}
export function parseNoteName(s) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)(-?\d)\s*$/.exec(s);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}
/** 频率 → 最近音名与音分偏差 */
export function noteFromFreq(freq, a4 = 440) {
  const mf = freqToMidiFloat(freq, a4);
  const midi = Math.round(mf);
  return {
    midi,
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents: (mf - midi) * 100,
    targetFreq: midiToFreq(midi, a4),
  };
}
export function centsBetween(freq, refFreq) {
  return 1200 * Math.log2(freq / refFreq);
}

export function rms(buf, start = 0, end = buf.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

/** 标准调弦六弦吉他音域下限附近：略低于 E2（82.4 Hz），排除 C2（65.4 Hz） */
export const PITCH_MIN_FREQ = 75;
export const PITCH_MAX_FREQ = 1400;

/** 抛物线插值 NSDF 峰值，得到更精确的周期与峰值高度 */
function interpPeak(nsdf, t) {
  const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1] ?? b;
  const denom = a - 2 * b + c;
  let shift = 0, val = b;
  if (Math.abs(denom) > 1e-12) {
    shift = (0.5 * (a - c)) / denom;
    if (shift > 1 || shift < -1) shift = 0;
    val = b - 0.25 * (a - c) * shift;
  }
  return { tau: t + shift, val };
}

/**
 * McLeod Pitch Method（NSDF + 关键极大值 + 抛物线插值）
 * 额外做次谐波/八度校正：低频嗡声或幅度调制会把 4τ（低两个八度）抬成全局最大，
 * 甚至把第一次负过零推到真周期之后。选出的音如果低于乐器音域，折到域内更高的峰。
 * @returns {{freq:number, clarity:number, rms:number}|null}
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const minFreq = opts.minFreq ?? PITCH_MIN_FREQ;
  const maxFreq = opts.maxFreq ?? PITCH_MAX_FREQ;
  const k = opts.k ?? 0.9;
  const minClarity = opts.minClarity ?? 0.8;
  const gate = opts.rmsGate ?? 0.005;
  const N = buf.length;
  const level = rms(buf);
  if (level < gate) return null;
  // 去直流
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  const x = opts._scratch && opts._scratch.length >= N ? opts._scratch : new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = buf[i] - mean;

  // 分析下限略低于判定下限，以便看到 C2 这类次谐波峰，再折回到乐器音域
  const analysisMinFreq = Math.min(minFreq, 55);
  const maxTau = Math.min(Math.floor(sampleRate / analysisMinFreq), Math.floor(N / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const nsdf = new Float32Array(maxTau + 2);
  // m(tau) 递推：m(0)=2*Σx²，m(tau)=m(tau-1)-x[tau-1]²-x[N-tau]²
  let m = 0;
  for (let i = 0; i < N; i++) m += 2 * x[i] * x[i];
  for (let tau = 0; tau <= maxTau + 1; tau++) {
    if (tau > 0) m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
    let r = 0;
    const lim = N - tau;
    for (let j = 0; j < lim; j++) r += x[j] * x[j + tau];
    nsdf[tau] = m > 1e-12 ? (2 * r) / m : 0;
  }
  // 关键极大值：每段正区间（从第一次负过零之后）取最大
  const keyTaus = [];
  let tau = 1;
  while (tau <= maxTau && nsdf[tau] > 0) tau++; // 跳过 0 附近的正区间
  const firstNeg = tau;
  let inPos = false, bestT = -1, bestV = -Infinity;
  for (; tau <= maxTau; tau++) {
    const v = nsdf[tau];
    if (v > 0) {
      if (!inPos) { inPos = true; bestT = tau; bestV = v; }
      else if (v > bestV) { bestV = v; bestT = tau; }
    } else if (inPos) {
      inPos = false;
      keyTaus.push(bestT);
    }
  }
  if (inPos && bestT > 0) keyTaus.push(bestT);

  const peakAt = (t) => {
    const { tau: pTau, val } = interpPeak(nsdf, t);
    return { t, tau: pTau, val, freq: sampleRate / pTau };
  };
  const keyPeaks = keyTaus.map(peakAt);
  // 局部极大：第一次负过零若晚于真周期，真峰会被算进 lag-0 正区间而漏掉；后面按 2f/4f 补回来
  const localPeaks = [];
  for (let t = minTau; t <= maxTau; t++) {
    const v = nsdf[t];
    if (v > 0 && v > nsdf[t - 1] && v >= nsdf[t + 1]) localPeaks.push(peakAt(t));
  }

  const TAU_TOL = 0.03; // 约 50 音分
  const nearTau = (peaks, target) => {
    let best = null, bestErr = Infinity;
    for (const p of peaks) {
      const err = Math.abs(p.tau - target) / target;
      if (err < TAU_TOL && err < bestErr) { best = p; bestErr = err; }
    }
    return best;
  };
  // 次谐波校正：低频嗡声会把 4τ 抬成最强峰，真峰 NSDF 可能只有 0.3–0.6。
  // 只对「足够强」的低频父峰（低于约 C#3 且 NSDF≥0.8）找 4f，避免把 3τ 旁瓣（如 G4 下的 C3）再抬成 C5。
  const SUB_MAX = 140; // Hz
  const SUB_4F = 0.25; // 干净低音弦的 4f NSDF < 0.18，嗡声下的真峰可低至约 0.29
  const STRONG = 0.8;
  // 4f 校正触发条件（二者满足其一）：
  // - 第一次负过零较晚：嗡声把真周期吞进 lag-0 或紧挨着它（真峰 NSDF 可能只有 0.3–0.5）
  // - 或 4f 峰相对父峰足够强（嗡声较轻时可达 0.73+；干净拨弦的 4f/基频 ≤ 0.47）
  const lateZero = firstNeg > sampleRate / 800;
  const extras = [];
  let hasStrong4f = false;
  for (const kp of keyPeaks) {
    const h2 = nearTau(localPeaks, kp.tau / 2);
    const h4 = nearTau(localPeaks, kp.tau / 4);
    if (kp.freq < SUB_MAX && kp.val >= STRONG) {
      // 2τ 峰（如 A2 的 A1）自身 NSDF 也接近 1，它的 2f 才是真基频；此时不要跳到 4f（A3）
      if (h2 && h2.val >= STRONG) extras.push(h2);
      else if (h4 && h4.val >= SUB_4F && (lateZero || h4.val >= 0.6 * kp.val)) {
        extras.push(h4); hasStrong4f = true;
      }
    } else if (h2 && h2.val >= STRONG) {
      extras.push(h2);
    }
  }

  const seen = new Set();
  const all = [];
  for (const p of keyPeaks.concat(extras)) {
    if (seen.has(p.t)) continue;
    seen.add(p.t);
    all.push(p);
  }
  if (!all.length) return null;

  // 若已按 4f 校正过强低频峰，把整个次谐波频段从候选里拿掉（含 F2 这类 3τ 旁瓣）
  const suppressed = new Set();
  for (const p of all) {
    if (p.freq < SUB_MAX && hasStrong4f) suppressed.add(p.t);
  }
  const inRange = all.filter((p) => p.freq >= minFreq && p.freq <= maxFreq);
  const usable = inRange.filter((p) => !suppressed.has(p.t));
  const pool = (usable.length ? usable : inRange.length ? inRange : all).slice().sort((a, b) => a.tau - b.tau);
  let rangeMax = 0;
  for (const p of pool) if (p.val > rangeMax) rangeMax = p.val;
  const thr = k * rangeMax;
  // 在判定范围内：取超过阈值的最短周期（最高频率）
  let chosen = null;
  for (const p of pool) {
    if (p.val >= thr) { chosen = p; break; }
  }
  if (!chosen) return null;

  // 仍低于乐器音域：按八度上折，优先落到真实存在的更高峰
  if (chosen.freq < minFreq) {
    let folded = null;
    for (const ratio of [4, 2]) {
      const hp = nearTau(localPeaks, chosen.tau / ratio);
      if (hp && hp.freq >= minFreq && hp.freq <= maxFreq && hp.val >= SUB_4F) { folded = hp; break; }
    }
    if (!folded) return null;
    chosen = folded;
  }

  // 周期置信度看相关峰（含被抑制的次谐波）的最大 NSDF，避免真峰因 0.5 左右的 NSDF 被 minClarity 丢掉
  let clarity = chosen.val;
  for (const p of keyPeaks.concat(all)) {
    const ratio = chosen.freq / p.freq;
    if (Math.abs(ratio - 1) < 0.08 || Math.abs(ratio - 2) < 0.08 || Math.abs(ratio - 4) < 0.08)
      clarity = Math.max(clarity, p.val);
  }
  if (clarity < minClarity || chosen.freq < minFreq || chosen.freq > maxFreq) return null;
  return { freq: chosen.freq, clarity, rms: level };
}

// ---------------- FFT（基 2，原地） ----------------
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >>> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

/** 两级 Butterworth 双二阶低通（共 4 阶），返回逐样本处理函数 */
function makeLowpass4(fc, sr) {
  const w = (2 * Math.PI * fc) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + al, b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = (-2 * cw) / a0, a2 = (1 - al) / a0;
  const st = [0, 0, 0, 0, 0, 0, 0, 0];
  const stage = (x, o) => {
    const y = b0 * x + b1 * st[o] + b2 * st[o + 1] - a1 * st[o + 2] - a2 * st[o + 3];
    st[o + 1] = st[o]; st[o] = x; st[o + 3] = st[o + 2]; st[o + 2] = y;
    return y;
  };
  return (x) => stage(stage(x, 0), 4);
}

/**
 * 流式起音检测：对数幅度谱通量 + 自适应阈值 + 峰值拾取 + 去抖，再用子块能量细化时间
 * 用法：const det = new OnsetDetector(sr); det.process(float32Chunk, chunkStartTimeSec) → 新检测到的起音时间数组(秒)
 */
export class OnsetDetector {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.frame = opts.frameSize ?? 1024;
    this.hop = opts.hopSize ?? 256;
    this.mult = opts.thresholdMult ?? 1.6;   // 自适应阈值倍数
    this.delta = opts.delta ?? 0.04;          // 阈值偏置（归一化通量单位）
    this.minInterval = (opts.minIntervalMs ?? 70) / 1000; // 去抖
    this.gate = opts.rmsGate ?? 0.004;        // 帧 RMS 门限，低于则忽略
    this.histLen = opts.historyFrames ?? 16;
    this.fft = makeFFT(this.frame);
    this.win = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (this.frame - 1));
    this.re = new Float64Array(this.frame);
    this.im = new Float64Array(this.frame);
    this.prevMag = new Float32Array(this.frame / 2);
    // 原始样本环形缓冲（保留足够做帧与细化）
    this.bufLen = this.frame * 4;
    this.ring = new Float32Array(this.bufLen);
    this.total = 0;          // 已写入样本总数
    this.t0 = null;          // 样本 0 对应的时间
    this.nextFrameEnd = this.frame;
    this.hist = [];
    this.fluxPrev2 = 0; this.fluxPrev1 = 0; this.frameEndPrev1 = 0; this.thrPrev1 = 0; this.rmsPrev1 = 0;
    this.lastOnset = -Infinity;
    this.frames = 0;
    this.warmup = opts.warmupFrames ?? 4; // 开头几帧（prevMag 从 0 开始）不报
    this.fluxTrace = opts.trace ? [] : null;
    // 频带限制：外放模式下只看 minHz–maxHz（节拍器的高频“嘀”落在频带之外，不会被当成拨弦）
    const binHz = sampleRate / this.frame;
    this.kLo = Math.max(1, Math.round((opts.minHz ?? 0) / binHz));
    this.kHi = Math.min(this.frame / 2, Math.round((opts.maxHz ?? sampleRate / 2) / binHz));
    this.nLo = opts.notchLo ? Math.round(opts.notchLo / binHz) : -1;
    this.nHi = opts.notchHi ? Math.round(opts.notchHi / binHz) : -1;
    // 外放模式：细化起音时间用低通（1.2 kHz，4 阶）后的信号，避免嘀声能量干扰
    this.lp = opts.notchLo ? makeLowpass4(1200, sampleRate) : null;
    this.ringF = this.lp ? new Float32Array(this.frame * 4) : null;
    this.nBins = (this.kHi - this.kLo) - (this.nLo >= 0 ? Math.max(0, Math.min(this.nHi, this.kHi) - Math.max(this.nLo, this.kLo)) : 0);
  }
  reset() {
    this.total = 0; this.t0 = null; this.nextFrameEnd = this.frame; this.hist = [];
    this.prevMag.fill(0); this.fluxPrev1 = this.fluxPrev2 = 0; this.lastOnset = -Infinity; this.frames = 0;
  }
  _sample(idx) { return this.ring[idx % this.bufLen]; }
  _sampleR(idx) { return (this.ringF || this.ring)[idx % this.bufLen]; }
  process(chunk, startTime) {
    if (this.t0 === null) this.t0 = startTime - this.total / this.sr;
    else {
      // 如果时间戳与样本计数不一致（掉帧），以新时间戳重新对齐
      const expected = this.t0 + this.total / this.sr;
      if (Math.abs(expected - startTime) > 0.05) this.t0 = startTime - this.total / this.sr;
    }
    const out = [];
    for (let i = 0; i < chunk.length; i++) {
      this.ring[this.total % this.bufLen] = chunk[i];
      if (this.lp) this.ringF[this.total % this.bufLen] = this.lp(chunk[i]);
      this.total++;
      if (this.total === this.nextFrameEnd) {
        const r = this._analyze(this.total);
        if (r !== null) out.push(r);
        this.nextFrameEnd += this.hop;
      }
    }
    return out;
  }
  _analyze(frameEnd) {
    const F = this.frame, start = frameEnd - F;
    let e = 0;
    for (let i = 0; i < F; i++) {
      const s = this._sample(start + i);
      e += s * s;
      this.re[i] = s * this.win[i];
      this.im[i] = 0;
    }
    const frameRms = Math.sqrt(e / F);
    this.fft(this.re, this.im);
    let flux = 0;
    const H = F / 2;
    for (let k = this.kLo; k < this.kHi; k++) {
      if (k >= this.nLo && k < this.nHi) continue;
      const mag = Math.log1p(100 * Math.hypot(this.re[k], this.im[k]));
      const d = mag - this.prevMag[k];
      if (d > 0) flux += d;
      this.prevMag[k] = mag;
    }
    flux /= Math.max(1, this.nBins);
    // 自适应阈值：历史中位数 * mult + delta
    const sorted = this.hist.slice().sort((a, b) => a - b);
    const med = sorted.length ? sorted[sorted.length >> 1] : 0;
    const thr = med * this.mult + this.delta;
    this.hist.push(flux);
    if (this.hist.length > this.histLen) this.hist.shift();
    if (this.fluxTrace) this.fluxTrace.push({ t: this.t0 + frameEnd / this.sr, flux, thr });

    // 峰值拾取：上一帧是局部极大且超过阈值
    let result = null;
    const p1 = this.fluxPrev1;
    this.frames++;
    if (this.frames > this.warmup && p1 > this.thrPrev1 && p1 > this.fluxPrev2 && p1 >= flux && this.rmsPrev1 > this.gate) {
      const { t, ratio } = this._refine(this.frameEndPrev1);
      // 真正的拨弦会让能量明显上升；手掌止音、音符结束的频谱变化会让通量变大但能量不升，排除
      if (ratio > 1.6 && t - this.lastOnset >= this.minInterval) {
        this.lastOnset = t;
        result = t;
      }
    }
    this.fluxPrev2 = p1; this.fluxPrev1 = flux; this.frameEndPrev1 = frameEnd; this.thrPrev1 = thr; this.rmsPrev1 = frameRms;
    return result;
  }
  // 在峰值帧附近细化：找“之后 128 样本能量 / 之前 512 样本能量”比值最大的位置（步长 16 样本）
  _refine(frameEnd) {
    const A = 128, Bk = 512, step = 16;
    const lo = Math.max(this.total - this.bufLen + Bk, frameEnd - this.frame - this.hop, Bk);
    const hi = this.total - A;
    if (hi <= lo) return { t: this.t0 + (frameEnd - this.frame / 2) / this.sr, ratio: 2 };
    // 前缀能量
    const base = lo - Bk, len = hi + A - base;
    const cum = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) { const v = this._sampleR(base + i); cum[i + 1] = cum[i] + v * v; }
    let best = lo, bestR = -Infinity;
    for (let p = lo; p <= hi; p += step) {
      const q = p - base;
      const after = (cum[q + A] - cum[q]) / A;
      const before = (cum[q] - cum[q - Bk]) / Bk;
      const r = after / (before + 1e-9);
      if (r > bestR) { bestR = r; best = p; }
    }
    // 能量上升检查用更长的窗口（之后最多 1024 / 之前 1024 样本），避免低音一个周期内的起伏造成误判
    const nA = Math.min(1024, this.total - best), nB = Math.min(1024, best - Math.max(0, this.total - this.bufLen));
    let ratio = 2;
    if (nA >= 192 && nB >= 256) {
      let ea = 0, eb = 0;
      for (let i = 0; i < nA; i++) { const v = this._sampleR(best + i); ea += v * v; }
      for (let i = 1; i <= nB; i++) { const v = this._sampleR(best - i); eb += v * v; }
      ratio = (ea / nA) / (eb / nB + 1e-12);
    }
    return { t: this.t0 + best / this.sr, ratio };
  }
}

/** 离线便捷函数：一次性处理整段信号 */
export function detectOnsetsOffline(signal, sampleRate, opts = {}) {
  const det = new OnsetDetector(sampleRate, opts);
  const chunk = 1024, out = [];
  for (let i = 0; i < signal.length; i += chunk) {
    out.push(...det.process(signal.subarray(i, Math.min(signal.length, i + chunk)), i / sampleRate));
  }
  return { onsets: out, trace: det.fluxTrace };
}

/**
 * 把起音与期望拍点匹配（贪心按误差从小到大，一对一）
 * @param {number[]} onsets 秒
 * @param {number[]} expected 秒
 * @param {{latencyMs?:number, windowMs?:number}} opts
 */
export function matchOnsets(onsets, expected, opts = {}) {
  const lat = (opts.latencyMs ?? 0) / 1000;
  let win = (opts.windowMs ?? 150) / 1000;
  if (expected.length > 1) {
    let minGap = Infinity;
    for (let i = 1; i < expected.length; i++) minGap = Math.min(minGap, expected[i] - expected[i - 1]);
    win = Math.min(win, minGap / 2);
  }
  const adj = onsets.map((t) => t - lat);
  const pairs = [];
  // 双指针收集候选
  for (let i = 0; i < adj.length; i++) {
    for (let j = 0; j < expected.length; j++) {
      const d = adj[i] - expected[j];
      if (Math.abs(d) <= win) pairs.push([Math.abs(d), i, j, d]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const usedO = new Set(), usedE = new Set();
  const hits = new Array(expected.length).fill(null);
  for (const [, i, j, d] of pairs) {
    if (usedO.has(i) || usedE.has(j)) continue;
    usedO.add(i); usedE.add(j);
    hits[j] = { expected: expected[j], onset: onsets[i], errorMs: d * 1000 };
  }
  const extras = onsets.filter((_, i) => !usedO.has(i));
  return { hits, extras, windowMs: win * 1000 };
}

/** 单次击打得分：|误差|≤perfect → 1，线性降到 zeroAt → 0 */
export function hitScore(errMs, perfect = 20, zeroAt = 120) {
  const a = Math.abs(errMs);
  if (a <= perfect) return 1;
  if (a >= zeroAt) return 0;
  return 1 - (a - perfect) / (zeroAt - perfect);
}
export function gradeOf(errMs) {
  const a = Math.abs(errMs);
  if (a <= 20) return 'perfect';
  if (a <= 45) return 'good';
  if (a <= 90) return 'ok';
  return 'off';
}

export function summarizeRhythm(match) {
  const hits = match.hits.filter(Boolean);
  const n = match.hits.length;
  const errs = hits.map((h) => h.errorMs);
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
  const absMean = errs.length ? errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length : 0;
  const sd = errs.length > 1 ? Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / (errs.length - 1)) : 0;
  const scoreSum = match.hits.reduce((s, h) => s + (h ? hitScore(h.errorMs) : 0), 0);
  // 多余的拨弦扣分（每个扣半拍分），避免“乱扫全中”
  const penalty = match.extras.length * 0.5;
  const accuracy = n ? Math.max(0, (scoreSum - penalty) / n) : 0;
  const grades = { perfect: 0, good: 0, ok: 0, off: 0 };
  for (const e of errs) grades[gradeOf(e)]++;
  return {
    expected: n,
    hit: hits.length,
    missed: n - hits.length,
    extra: match.extras.length,
    hitRate: n ? hits.length / n : 0,
    meanErrorMs: mean,          // 正 = 偏晚，负 = 偏早
    meanAbsErrorMs: absMean,
    stdMs: sd,
    early: errs.filter((e) => e < -10).length,
    late: errs.filter((e) => e > 10).length,
    accuracy,                   // 0..1
    grades,
  };
}

/** 估计延迟：取匹配误差中位数（ms） */
export function estimateLatency(onsets, expected, windowMs = 250) {
  const m = matchOnsets(onsets, expected, { latencyMs: 0, windowMs });
  const errs = m.hits.filter(Boolean).map((h) => h.errorMs).sort((a, b) => a - b);
  if (errs.length < 4) return null;
  const med = errs[errs.length >> 1];
  const mad = errs.map((e) => Math.abs(e - med)).sort((a, b) => a - b)[errs.length >> 1];
  return { latencyMs: med, spreadMs: mad, n: errs.length };
}

/** 仅音名练习允许忽略八度；严格练习保留有符号的完整音分差。 */
export function snapCents(c, octaveFree = false) {
  return octaveFree ? c - 1200 * Math.round(c / 1200) : c;
}

/** 所有实际观测帧（包括无音高）进入分母，至少两帧支持才判中。 */
export function pitchWindowVerdict(cents, total, tolerance) {
  const good = cents.filter((c) => Math.abs(c) <= tolerance);
  const need = Math.max(2, Math.ceil(total * 0.3));
  const reason = cents.length < need ? 'insufficient' : good.length < need ? 'off_pitch' : 'hit';
  return { good, need, reason };
}

/**
 * 音准练习跟踪器：逐帧喂入音高结果，判断是否按顺序弹中目标音
 * update({freq|null, time, onset:boolean}) → 事件 {type:'hit'|'miss', ...} 或 null
 * tol / a4 / octaveFree 是可变字段，练习中途改设置会立即生效。
 */
export class NoteSequenceTracker {
  constructor(targets, opts = {}) {
    this.targets = targets;            // midi 数组
    this.tol = opts.tolCents ?? 20;
    this.stable = opts.stableFrames ?? 4;
    this.a4 = opts.a4 ?? 440;
    this.octaveFree = opts.octaveFree ?? false;
    this.advanceOnMiss = opts.advanceOnMiss ?? false;
    this.idx = 0;
    this.locked = false; this.lockedMidi = null;
    this.candMidi = null; this.candFreqs = [];
    this.silent = 0;
    this.results = targets.map((m) => ({ midi: m, attempts: 0, hit: false, cents: null, played: [] }));
    this.attempts = 0; this.hits = 0;
  }
  get done() { return this.idx >= this.targets.length; }
  get current() { return this.targets[this.idx]; }
  update(fr) {
    if (this.done) return null;
    if (fr.onset) { this.locked = false; this.candMidi = null; this.candFreqs = []; }
    if (!fr.freq) {
      if (++this.silent >= 2) { this.locked = false; this.candMidi = null; this.candFreqs = []; }
      return null;
    }
    this.silent = 0;
    const midi = Math.round(freqToMidiFloat(fr.freq, this.a4));
    if (this.locked) {
      if (midi === this.lockedMidi) return null;
      this.locked = false; // 换了音（滑音/换品）视为新音
    }
    if (midi !== this.candMidi) { this.candMidi = midi; this.candFreqs = []; }
    this.candFreqs.push(fr.freq);
    if (this.candFreqs.length < this.stable) return null;
    // 判定
    const fs = this.candFreqs.slice().sort((a, b) => a - b);
    const f = fs[fs.length >> 1];
    const target = this.targets[this.idx];
    const c = snapCents(centsBetween(f, midiToFreq(target, this.a4)), this.octaveFree);
    this.locked = true; this.lockedMidi = midi; this.candMidi = null; this.candFreqs = [];
    const r = this.results[this.idx];
    r.attempts++; this.attempts++;
    r.played.push({ freq: f, cents: c, time: fr.time });
    if (Math.abs(c) <= this.tol) {
      r.hit = true; r.cents = c; this.hits++;
      const ev = { type: 'hit', index: this.idx, target, cents: c, freq: f };
      this.idx++;
      return ev;
    }
    const ev = { type: 'miss', index: this.idx, target, cents: c, freq: f, playedMidi: midi };
    if (this.advanceOnMiss) this.idx++;
    return ev;
  }
  summary() {
    const hitR = this.results.filter((r) => r.hit);
    const absC = hitR.map((r) => Math.abs(r.cents));
    const firstTry = this.results.filter((r) => r.hit && r.attempts === 1).length;
    return {
      total: this.targets.length,
      completed: this.idx,
      hits: this.hits,
      attempts: this.attempts,
      accuracy: this.attempts ? this.hits / this.attempts : 0,  // 命中次数 / 判定次数
      firstTryRate: this.targets.length ? firstTry / this.targets.length : 0,
      meanAbsCents: absC.length ? absC.reduce((a, b) => a + b, 0) / absC.length : 0,
      meanCents: hitR.length ? hitR.reduce((a, r) => a + r.cents, 0) / hitR.length : 0,
    };
  }
}
