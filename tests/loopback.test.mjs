// 回环延迟测量 + 外部节拍器（全部用合成信号）
import { makeChirp, calibSchedule, estimateLoopback, fitGrid, GridTracker, ExternalClickTracker, fft } from '../js/rhythm.js';
import { pluck, addNoise, mixAt, rng } from './synth.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const gauss = (r) => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / Math.sqrt(0.5); };

console.log('== 0. FFT 正反变换');
{
  const n = 64, re = new Float64Array(n), im = new Float64Array(n), r = rng(1);
  for (let i = 0; i < n; i++) re[i] = r() - 0.5;
  const keep = re.slice(); fft(re, im); fft(re, im, true);
  ok(keep.every((v, i) => Math.abs(v - re[i]) < 1e-12), 'FFT 往返误差');
}

// 模拟「喇叭 → 房间 → 麦克风」：延迟 + 衰减 + 一次反射 + 手机喇叭的高通 + 底噪
function loopbackSignal({ sr = 48000, latencyMs = 137.4, amp = 0.05, echo = 0.5, noise = 0.01, jitterMs = 0.3, n = 8, seed = 7, sigStart = 12.345, chirp = true, guitar = false }) {
  const r = rng(seed), sched = calibSchedule(n, seed), first = sigStart + 0.4;
  const times = sched.map((o) => first + o), dur = times[n - 1] - sigStart + 1.2;
  const sig = new Float32Array(Math.round(dur * sr)), { c } = makeChirp(sr);
  if (chirp) for (const t of times) {
    const at = (t - sigStart + (latencyMs + gauss(r) * jitterMs) / 1000) * sr, i0 = Math.floor(at), fr = at - i0;
    for (let i = 0; i < c.length; i++) {
      const v = amp * c[i];
      sig[i0 + i] += v * (1 - fr); sig[i0 + i + 1] += v * fr; // 小数延迟（线性插值）
      const ie = i0 + i + Math.round(0.0041 * sr); sig[ie] += v * echo;
    }
  }
  if (guitar) times.forEach((t, k) => mixAt(sig, pluck(165, 0.6, sr, 0.3, 30 + k).x, Math.round((t - sigStart + 0.18 + (r() - 0.5) * 0.06) * sr)));
  // 喇叭高通（一阶 300 Hz）
  let y = 0, xp = 0; const a = Math.exp((-2 * Math.PI * 300) / sr);
  for (let i = 0; i < sig.length; i++) { const x = sig[i]; y = a * (y + x - xp); xp = x; sig[i] = y; }
  addNoise(sig, noise, seed + 1);
  return { sig, sr, sigStart, times };
}

console.log('== 1. 回环延迟：手机外放（137 ms，有反射、底噪，信噪比很低）');
{
  const s = loopbackSignal({});
  const t0 = performance.now(), est = estimateLoopback(s.sig, s.sr, s.sigStart, s.times), ms = performance.now() - t0;
  console.log(`  估计 ${est.latencyMs?.toFixed(2)} ms（真值 137.4），离散 ±${est.spreadMs?.toFixed(2)} ms，${est.n}/${est.total} 下，信噪比 ${est.snrDb?.toFixed(1)} dB，可信度 ${est.confidence}，用时 ${ms.toFixed(0)} ms`);
  ok(est.ok && Math.abs(est.latencyMs - 137.4) < 0.6, '误差 < 0.6 ms');
  ok(est.n === 8 && est.spreadMs < 1 && est.confidence === 'high', '8 下全部检出、离散 < 1ms、高可信');
}
console.log('== 2. 蓝牙耳机级别的大延迟（260 ms）、44.1 kHz');
{
  const s = loopbackSignal({ sr: 44100, latencyMs: 262.7, amp: 0.03, seed: 11, sigStart: 0.5 });
  const est = estimateLoopback(s.sig, s.sr, s.sigStart, s.times);
  console.log(`  估计 ${est.latencyMs?.toFixed(2)} ms（真值 262.7），${est.n}/8 下`);
  ok(est.ok && Math.abs(est.latencyMs - 262.7) < 0.8, '44.1k、260ms 也准');
}
console.log('== 3. 抖动大的设备 → 可信度下降');
{
  const s = loopbackSignal({ jitterMs: 6, seed: 3 });
  const est = estimateLoopback(s.sig, s.sr, s.sigStart, s.times);
  console.log(`  估计 ${est.latencyMs?.toFixed(1)} ms，离散 ±${est.spreadMs?.toFixed(1)}，可信度 ${est.confidence}，相关 ${est.ncc?.toFixed(2)}`);
  ok(est.ok && Math.abs(est.latencyMs - 137.4) < 6 && est.confidence !== 'high', '±6ms 抖动：结果仍接近、但不标「高可信」');
}
console.log('== 4. 麦克风听不到喇叭（戴耳机 / 音量 0）→ 失败，不乱给数');
{
  const s = loopbackSignal({ chirp: false });
  const est = estimateLoopback(s.sig, s.sr, s.sigStart, s.times);
  ok(!est.ok && est.reason === 'weak', '只有底噪 → weak：' + JSON.stringify({ ok: est.ok, n: est.n }));
  const g = loopbackSignal({ chirp: false, guitar: true, seed: 5 });
  const e2 = estimateLoopback(g.sig, g.sr, g.sigStart, g.times);
  ok(!e2.ok, '只有人在「跟着拨弦」、没有测试音 → 不采用（人的反应不算设备延迟）');
  const short = estimateLoopback(new Float32Array(1000), 48000, 0, [0.1, 0.6, 1.2, 1.9]);
  ok(!short.ok && short.reason === 'nodata', '录音太短 → nodata');
}
console.log('== 5. 测试音 + 同时有人在弹琴（干扰）');
{
  const s = loopbackSignal({ guitar: true, seed: 9, amp: 0.06 });
  const est = estimateLoopback(s.sig, s.sr, s.sigStart, s.times);
  console.log(`  估计 ${est.latencyMs?.toFixed(2)} ms，${est.n}/8 下`);
  ok(est.ok && Math.abs(est.latencyMs - 137.4) < 1, '有琴声干扰也准');
}

console.log('== 6. 拟合网格：速度、相位、抖动、漏点、离群点');
{
  const r = rng(4), P = 60 / 96, ts = [];
  for (let k = 0; k < 24; k++) if (![5, 6, 13].includes(k)) ts.push(3.21 + k * P + gauss(r) * 0.004);
  ts.push(3.21 + 2.3 * P, 3.21 + 9.6 * P); // 两个不在拍上的（比如碰到琴弦）
  const f = fitGrid(ts);
  console.log(`  ${f.bpm.toFixed(3)} BPM，抖动 ${f.jitterMs.toFixed(2)} ms，离群 ${f.outliers}`);
  ok(Math.abs(f.bpm - 96) < 0.15, '自动速度误差 < 0.15 BPM');
  ok(f.outliers === 2 && f.inliers === 21, '离群点被剔除');
  ok(Math.abs(f.jitterMs - 4) < 1.6, '抖动估计 ≈ 4ms');
  const fh = fitGrid(ts, { bpm: 96 });
  ok(Math.abs(((fh.phase - 3.21) / P) - Math.round((fh.phase - 3.21) / P)) * P < 0.003, '给定 BPM：只拟合相位');
  ok(fitGrid([1, 2]) === null && fitGrid([1, 1.01, 1.02, 5]) === null, '数据不够 → null');
}
console.log('== 7. 锁相：外部节拍器实际比设定快 0.4%（100 vs 100.4 BPM）');
{
  const P = 60 / 100.4, g = new GridTracker(60 / 100, 0, 0);
  let worst = 0;
  for (let k = 1; k < 200; k++) { const t = k * P; const { k: kk, resid } = g.nearest(t); if (k > 30) worst = Math.max(worst, Math.abs(resid)); g.update(t, kk); }
  ok(worst < 0.002 && Math.abs(g.bpm - 100.4) < 0.05, `锁相后残差 ${(worst * 1000).toFixed(2)} ms，速度 ${g.bpm.toFixed(2)}`);
}

// 外部节拍器的「嗒」：3.2 kHz + 1.1 kHz 快速衰减
function extClick(sr, amp) {
  const n = Math.round(0.03 * sr), x = new Float32Array(n), r = rng(2);
  for (let i = 0; i < n; i++) { const t = i / sr; x[i] = amp * (Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t / 0.003) + 0.3 * Math.sin(2 * Math.PI * 1100 * t) * Math.exp(-t / 0.004) + 0.2 * (r() - 0.5) * Math.exp(-t / 0.001)); }
  return x;
}
console.log('== 8. 外部节拍器 + 弹琴：锁定、区分「嗒」和拨弦、按网格打分');
{
  const sr = 48000, bpm = 96, P = 60 / bpm, dur = 26, sig = new Float32Array(dur * sr), r = rng(8), t0 = 0.37;
  const clicks = [];
  for (let k = 0; t0 + k * P < dur - 0.2; k++) { const t = t0 + k * P + gauss(r) * 0.0005; clicks.push(t); mixAt(sig, extClick(sr, 0.22), Math.round(t * sr)); }
  // 6 秒后开始弹：拍上 + 后半拍，带已知偏差；有的正好和「嗒」重合
  const offs = [0, -0.025, 0.045, -0.04, 0.07, 0, -0.015, 0.05];
  const plucks = [];
  let j = 0;
  for (let k = 12; t0 + k * P < dur - 1.5; k++) for (const half of [0, 0.5]) {
    const off = offs[j++ % offs.length], t = t0 + (k + half) * P + off;
    plucks.push({ t, off, grid: t0 + (k + half) * P });
    mixAt(sig, pluck([165, 196, 220][j % 3], 1.0, sr, 0.35, 40 + j).x, Math.round(t * sr));
  }
  addNoise(sig, 0.003, 4);
  const tr = new ExternalClickTracker(sr, { gate: 0.004 });
  const ev = [];
  for (let i = 0; i < sig.length; i += 128) ev.push(...tr.process(sig.subarray(i, i + 128), i / sr));
  const lock = ev.find((e) => e.type === 'lock');
  console.log(`  锁定：${lock && lock.bpm.toFixed(2)} BPM，抖动 ${lock && lock.jitterMs.toFixed(2)} ms，在 ${lock && lock.t.toFixed(2)} s`);
  ok(lock && Math.abs(lock.bpm - 96) < 0.3 && lock.jitterMs < 2 && lock.t < 6, '弹琴之前就锁定、速度准');
  const hits = ev.filter((e) => e.type === 'hit'), cls = ev.filter((e) => e.type === 'click');
  let found = 0, worstErr = 0;
  for (const p of plucks) {
    const h = hits.find((e) => Math.abs(e.t - p.t) < 0.012);
    if (h) { found++; worstErr = Math.max(worstErr, Math.abs(h.t - p.t)); }
  }
  const fake = hits.filter((e) => !plucks.some((p) => Math.abs(e.t - p.t) < 0.03)).length;
  console.log(`  拨弦 ${plucks.length}：找到 ${found}，最大时间误差 ${(worstErr * 1000).toFixed(1)} ms；节拍器 ${clicks.length} 下，认成节拍器 ${cls.length}，误当成拨弦 ${fake}；跟踪抖动 ${tr.jitterMs.toFixed(2)} ms`);
  ok(found >= plucks.length * 0.9, '≥ 90% 的拨弦被识别为拨弦');
  ok(fake <= 2, '节拍器的「嗒」几乎不会被当成拨弦');
  ok(cls.length >= (clicks.length - 6) * 0.6, '弹琴时仍能持续锁相（多数「嗒」被认出来）');
  // 按网格打分：偏差应当还原
  const errs = plucks.map((p) => { const h = hits.find((e) => Math.abs(e.t - p.t) < 0.012); if (!h) return null; const g = tr.grid; const kk = Math.round(((h.t - g.anchorT) / g.period) * 2) / 2 + g.anchorK; return { want: p.off * 1000, got: (h.t - (g.anchorT + (kk - g.anchorK) * g.period)) * 1000 }; }).filter(Boolean);
  const bad = errs.filter((e) => Math.abs(e.want - e.got) > 8).length;
  ok(bad <= errs.length * 0.1, `按外部网格还原偏差：${errs.length - bad}/${errs.length} 在 8ms 内`);
}
console.log('== 9. 外部节拍器测试（不弹琴）：速度 + 抖动');
{
  const sr = 44100, P = 60 / 132, sig = new Float32Array(9 * sr), r = rng(12), ts = [];
  for (let k = 0; 0.2 + k * P < 8.8; k++) { const t = 0.2 + k * P + gauss(r) * 0.002; ts.push(t); mixAt(sig, extClick(sr, 0.1), Math.round(t * sr)); }
  addNoise(sig, 0.002, 1);
  const tr = new ExternalClickTracker(sr, { gate: 0.003 }), on = [];
  for (let i = 0; i < sig.length; i += 512) for (const e of tr.process(sig.subarray(i, i + 512), i / sr)) if (e.type !== 'lock') on.push(e.t);
  const f = fitGrid(on);
  console.log(`  听到 ${on.length}/${ts.length} 下 → ${f.bpm.toFixed(2)} BPM，抖动 ${f.jitterMs.toFixed(2)} ms（真值 132 BPM、±2 ms）`);
  ok(on.length >= ts.length - 1 && Math.abs(f.bpm - 132) < 0.3 && f.jitterMs > 1 && f.jitterMs < 3.5, '速度和抖动都测得出来');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 回环延迟 + 外部节拍器全部通过');
process.exit(fails ? 1 : 0);
