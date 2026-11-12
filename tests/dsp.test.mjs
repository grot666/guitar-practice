import { detectPitch, noteFromFreq, midiToFreq, detectOnsetsOffline, matchOnsets, summarizeRhythm, estimateLatency, NoteSequenceTracker, parseNoteName } from '../js/dsp.js';
import { sine, harmonic, pluck, addNoise, mixAt, click, rng } from './synth.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };
const SR = 48000, WIN = 2048;
const cents = (a, b) => 1200 * Math.log2(a / b);

function pitchAt(sig, offset = 4800) { return detectPitch(sig.subarray(offset, offset + WIN), SR); }

console.log('== 1. 音高检测：正弦（E2..E5 半音全覆盖，82–659 Hz）');
{
  let worst = 0, n = 0, wrong = 0;
  for (let m = 40; m <= 76; m++) {
    const f = midiToFreq(m) * (1 + (rng(m)() - 0.5) * 0.02); // 随机 ±17 音分
    const r = pitchAt(sine(f, 0.3, SR));
    n++;
    if (!r) { wrong++; continue; }
    const c = Math.abs(cents(r.freq, f));
    worst = Math.max(worst, c);
    if (c > 5) wrong++;
  }
  console.log(`  ${n} 个音，失败 ${wrong}，最大误差 ${worst.toFixed(2)} 音分`);
  ok(wrong === 0 && worst < 2, '正弦误差应 < 2 音分');
}

console.log('== 2. 音高检测：强谐波/基频偏弱 + 噪声（6 根空弦 + 第 12 品）');
{
  const strings = [40, 45, 50, 55, 59, 64];
  let worst = 0, octaveErr = 0, n = 0;
  for (const s of strings) for (const fret of [0, 5, 12]) {
    const f = midiToFreq(s + fret);
    const sig = addNoise(harmonic(f, 0.5, SR), 0.01, s + fret);
    for (const off of [2400, 9600, 16800]) {
      const r = pitchAt(sig, off); n++;
      if (!r) { octaveErr++; continue; }
      const c = cents(r.freq, f);
      if (Math.abs(c) > 50) octaveErr++; else worst = Math.max(worst, Math.abs(c));
    }
  }
  console.log(`  ${n} 帧，八度/错误 ${octaveErr}，最大误差 ${worst.toFixed(2)} 音分（含 0.04% 非谐性）`);
  ok(octaveErr === 0 && worst < 5, '谐波音应无八度错误且 < 5 音分');
}

console.log('== 3. 音高检测：Karplus-Strong 拨弦，衰减过程中逐帧检测');
{
  let frames = 0, good = 0, worst = 0;
  for (const m of [40, 45, 50, 52, 55, 57, 59, 62, 64, 67, 69, 72]) {
    const { x, f } = pluck(midiToFreq(m), 1.2, SR, 0.6, m);
    addNoise(x, 0.005, m);
    for (let off = 2048; off + WIN < x.length; off += 2400) {
      const r = detectPitch(x.subarray(off, off + WIN), SR);
      if (!r) continue; // 衰减到门限下返回 null 是正常的
      frames++;
      const c = Math.abs(cents(r.freq, f));
      if (c <= 10) good++;
      worst = Math.max(worst, c);
    }
  }
  console.log(`  有声帧 ${frames}，±10 音分内 ${good} (${(100 * good / frames).toFixed(1)}%)，最大 ${worst.toFixed(1)} 音分`);
  ok(good / frames > 0.97, '拨弦 ±10 音分命中率应 > 97%');
}

console.log('== 4. 静音/噪声不应报音高');
{
  const z = new Float32Array(WIN);
  ok(detectPitch(z, SR) === null, '静音');
  const nz = addNoise(new Float32Array(WIN), 0.2, 9);
  const r = detectPitch(nz, SR);
  console.log('  白噪声结果：', r ? r.freq.toFixed(1) + 'Hz clarity ' + r.clarity.toFixed(2) : 'null');
  ok(r === null, '白噪声应返回 null');
}

console.log('== 5. 音名换算');
{
  const n = noteFromFreq(440 * Math.pow(2, 12 / 1200));
  ok(n.name === 'A' && n.octave === 4 && Math.abs(n.cents - 12) < 0.01, 'A4+12c');
  ok(parseNoteName('E2') === 40 && parseNoteName('F#3') === 54 && parseNoteName('Bb3') === 58, '解析音名');
}

function onsetReport(name, sig, truth, opts = {}) {
  const { onsets } = detectOnsetsOffline(sig, SR, opts);
  const m = matchOnsets(onsets, truth, { windowMs: 60 });
  const s = summarizeRhythm(m);
  const errs = m.hits.filter(Boolean).map((h) => h.errorMs);
  const maxAbs = errs.length ? Math.max(...errs.map(Math.abs)) : 0;
  console.log(`  ${name}: 真值 ${truth.length}，检出 ${onsets.length}，命中 ${s.hit}，漏 ${s.missed}，误报 ${s.extra}，平均误差 ${s.meanErrorMs.toFixed(1)}ms，平均绝对 ${s.meanAbsErrorMs.toFixed(1)}ms，最大 ${maxAbs.toFixed(1)}ms`);
  return { s, maxAbs, onsets, m };
}

console.log('== 6. 起音检测：不同音高的拨弦序列（音符相互重叠，含噪声）');
{
  const dur = 12, sig = new Float32Array(dur * SR);
  const r = rng(42), truth = [];
  let t = 0.5;
  const notes = [40, 45, 50, 55, 59, 64, 62, 57, 52, 47, 43, 48, 53, 60, 67, 72];
  let k = 0;
  while (t < dur - 1) {
    const m = notes[k % notes.length];
    const { x } = pluck(midiToFreq(m), 1.5, SR, 0.3 + 0.4 * r(), 100 + k);
    mixAt(sig, x, Math.round(t * SR));
    truth.push(t); k++;
    t += 0.18 + r() * 0.5; // 间隔 180–680ms
  }
  addNoise(sig, 0.003, 5);
  const { s, maxAbs } = onsetReport('拨弦', sig, truth);
  ok(s.missed === 0 && s.extra === 0 && maxAbs < 15, '拨弦起音应全中，误差 < 15ms');
}

console.log('== 7. 起音检测：同一音高重复拨弦（16 分音符 @120 BPM = 125ms）');
{
  const sig = new Float32Array(6 * SR), truth = [];
  for (let i = 0; i < 40; i++) {
    const t = 0.5 + i * 0.125;
    const { x } = pluck(midiToFreq(52), 0.6, SR, 0.5, 300 + i);
    mixAt(sig, x, Math.round(t * SR)); truth.push(t);
  }
  addNoise(sig, 0.003, 6);
  const { s, maxAbs } = onsetReport('同音 16 分', sig, truth);
  ok(s.missed <= 1 && s.extra <= 1 && maxAbs < 15, '同音快速重复应几乎全中');
}

console.log('== 8. 起音检测：短促敲击声（模拟敲面板/闷音），较强噪声');
{
  const sig = new Float32Array(8 * SR), truth = [];
  for (let i = 0; i < 16; i++) { const t = 0.4 + i * 0.45; mixAt(sig, click(SR, 0.5), Math.round(t * SR)); truth.push(t); }
  addNoise(sig, 0.02, 8);
  const { s, maxAbs } = onsetReport('敲击', sig, truth);
  ok(s.missed === 0 && s.extra === 0 && maxAbs < 10, '敲击应全中');
}

console.log('== 9. 持续长音 + 噪声，不应误报');
{
  const sig = addNoise(harmonic(110, 4, SR, [0.4, 0.5, 0.3]), 0.01, 11);
  const { onsets } = detectOnsetsOffline(sig, SR);
  console.log(`  检出 ${onsets.length} 个（期望 1，即开头）`);
  ok(onsets.length <= 1, '长音不应重复触发');
}

console.log('== 10. 节奏评分：已知偏差 + 延迟补偿 + 延迟估计');
{
  const bpm = 100, beat = 60 / bpm, expected = [];
  for (let i = 0; i < 16; i++) expected.push(1 + i * beat);
  const latency = 0.085; // 模拟 85ms 系统延迟
  const dev = [0, 10, -15, 30, -40, 5, 0, 60, -8, 12, 0, -25, 150, 0, 3, -3]; // ms，第 13 个太离谱视为漏
  const onsets = expected.map((t, i) => t + latency + dev[i] / 1000);
  onsets.push(expected[3] + latency + beat / 2); // 一个多余的
  const est = estimateLatency(onsets, expected);
  console.log(`  延迟估计 ${est.latencyMs.toFixed(1)}ms（真值 85ms），离散度 ${est.spreadMs.toFixed(1)}ms`);
  ok(Math.abs(est.latencyMs - 85) < 6, '延迟估计误差 < 6ms');
  const m = matchOnsets(onsets, expected, { latencyMs: 85, windowMs: 120 });
  const s = summarizeRhythm(m);
  console.log(`  命中 ${s.hit}/${s.expected}，漏 ${s.missed}，多余 ${s.extra}，平均 ${s.meanErrorMs.toFixed(1)}ms，平均绝对 ${s.meanAbsErrorMs.toFixed(1)}ms，准确率 ${(s.accuracy * 100).toFixed(1)}%`);
  const errs = m.hits.map((h) => (h ? Math.round(h.errorMs) : null));
  ok(errs[1] === 10 && errs[4] === -40 && errs[12] === null, '每拍误差应还原');
  ok(s.hit === 15 && s.missed === 1 && s.extra === 2, '命中/漏/多余计数'); // 150ms 那拍变成多余
}

console.log('== 11. 端到端：合成“演奏”（带抖动和延迟）→ 起音检测 → 评分');
{
  const bpm = 90, beat = 60 / bpm, sig = new Float32Array(12 * SR), expected = [], played = [];
  const r = rng(77), lat = 0.06;
  for (let i = 0; i < 16; i++) {
    const t = 1 + i * beat; expected.push(t);
    const jit = (r() - 0.5) * 0.06; // ±30ms 人为抖动
    const tp = t + lat + jit; played.push(jit * 1000);
    const { x } = pluck(midiToFreq([45, 52, 57, 60][i % 4]), 1, SR, 0.5, 500 + i);
    mixAt(sig, x, Math.round(tp * SR));
  }
  addNoise(sig, 0.004, 12);
  const { onsets } = detectOnsetsOffline(sig, SR);
  const m = matchOnsets(onsets, expected, { latencyMs: 60, windowMs: 150 });
  const s = summarizeRhythm(m);
  let maxDiff = 0;
  m.hits.forEach((h, i) => { if (h) maxDiff = Math.max(maxDiff, Math.abs(h.errorMs - played[i])); });
  console.log(`  命中 ${s.hit}/16，测得每拍误差与真实抖动最大差 ${maxDiff.toFixed(1)}ms，准确率 ${(s.accuracy * 100).toFixed(1)}%`);
  ok(s.hit === 16 && maxDiff < 12, '端到端每拍误差还原 < 12ms');
}

console.log('== 12. 音准练习跟踪器：E 小调五声音阶');
{
  const targets = [40, 43, 45, 47, 50, 52];
  const tr = new NoteSequenceTracker(targets, { tolCents: 20, stableFrames: 3 });
  const feed = (freq, frames) => { const evs = []; for (let i = 0; i < frames; i++) { const e = tr.update({ freq, time: 0 }); if (e) evs.push(e); } return evs; };
  const sil = () => feed(null, 3);
  const evs = [];
  evs.push(...feed(midiToFreq(40) * Math.pow(2, 5 / 1200), 6)); sil();  // E2 +5c → 中
  evs.push(...feed(midiToFreq(44), 6)); sil();                          // 弹错 G#2 → 错
  evs.push(...feed(midiToFreq(43) * Math.pow(2, 35 / 1200), 6)); sil(); // G2 +35c → 不准
  evs.push(...feed(midiToFreq(43) * Math.pow(2, -8 / 1200), 6)); sil(); // G2 -8c → 中
  evs.push(...feed(midiToFreq(57), 6)); sil();                          // A3（高八度）→ 允许八度 → 中
  for (const m of [47, 50, 52]) { evs.push(...feed(midiToFreq(m), 6)); sil(); }
  const sum = tr.summary();
  console.log('  事件：', evs.map((e) => e.type + '(' + e.cents.toFixed(0) + 'c)').join(' '));
  console.log(`  完成 ${sum.completed}/${sum.total}，命中 ${sum.hits}/${sum.attempts} = ${(sum.accuracy * 100).toFixed(0)}%，一次命中率 ${(sum.firstTryRate * 100).toFixed(0)}%，平均偏差 ${sum.meanAbsCents.toFixed(1)} 音分`);
  ok(tr.done && sum.hits === 6 && sum.attempts === 8, '跟踪器计数');
}


console.log('== 13. 起音检测：扫弦（6 弦 25ms 内依次发声）应只算 1 次 + 弱拨（-30dB）');
{
  const sig = new Float32Array(10 * SR), truth = [];
  for (let i = 0; i < 12; i++) {
    const t = 0.5 + i * 0.7; truth.push(t);
    [40, 47, 52, 55, 59, 64].forEach((m, j) => { const { x } = pluck(midiToFreq(m), 0.9, SR, 0.15, 900 + i * 6 + j); mixAt(sig, x, Math.round((t + j * 0.005) * SR)); });
  }
  addNoise(sig, 0.003, 13);
  const { s, maxAbs } = onsetReport('扫弦', sig, truth);
  ok(s.missed === 0 && s.extra === 0 && maxAbs < 15, '扫弦每次只算一次');
  const sig2 = new Float32Array(6 * SR), truth2 = [];
  for (let i = 0; i < 10; i++) { const t = 0.5 + i * 0.5; truth2.push(t); const { x } = pluck(midiToFreq(50 + (i % 3) * 2), 0.8, SR, 0.02, 1000 + i); mixAt(sig2, x, Math.round(t * SR)); }
  addNoise(sig2, 0.0005, 14);
  const r2 = onsetReport('弱拨', sig2, truth2);
  ok(r2.s.missed === 0 && r2.s.extra === 0, '弱拨应检出');
}

console.log(fails ? `\n失败 ${fails} 项` : '\n全部通过');
process.exit(fails ? 1 : 0);
