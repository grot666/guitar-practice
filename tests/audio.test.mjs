// 合成拨弦音（示范、试听、编曲伴奏都用它）的离线测试：node tests/audio.test.mjs
// 曾经的 bug：随机数公式写错，初始「噪声」其实是常数 → 输出只是一段慢慢衰减的直流，手机上完全听不到。
import { AudioEngine } from '../js/audio.js';
import { detectPitch, midiToFreq, centsBetween } from '../js/dsp.js';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
console.log('== 拨弦合成：音高、直流、响度（三种采样率）');
for (const sr of [22050, 44100, 48000]) {
  const e = new AudioEngine();
  e.ctx = { sampleRate: sr, createBuffer: (c, n, r) => { const d = new Float32Array(n); return { getChannelData: () => d, length: n, sampleRate: r, duration: n / r }; } };
  const row = [];
  for (const m of [36, 40, 45, 50, 55, 59, 64, 67, 72, 76]) {
    const x = e._pluckBuffer(m).getChannelData(0), N = sr > 30000 ? 4096 : 2048;
    const seg = x.subarray(N, 2 * N);
    const r = detectPitch(seg, sr, { rmsGate: 0.001, minFreq: 50, maxFreq: 1400 });
    const c = r ? centsBetween(r.freq, midiToFreq(m)) : NaN;
    let pk = 0, mean = 0, rmsv = 0; for (const v of x) { pk = Math.max(pk, Math.abs(v)); mean += v; } mean /= x.length;
    for (const v of seg) rmsv += v * v; rmsv = Math.sqrt(rmsv / seg.length);
    ok(r && Math.abs(c) < 3, `${sr} Hz MIDI ${m}: 音高偏 ${c.toFixed(1)} 音分`);
    ok(Math.abs(mean) < 0.01, `${sr} Hz MIDI ${m}: 直流 ${mean.toFixed(3)}`);
    ok(Math.abs(pk - 0.6) < 0.01, `${sr} Hz MIDI ${m}: 峰值 ${pk.toFixed(2)}，应归一化到 0.6`);
    ok(rmsv > 0.03, `${sr} Hz MIDI ${m}: 0.1 秒后太弱（RMS ${rmsv.toFixed(3)}）`);
    row.push(`${m}:${c >= 0 ? '+' : ''}${c.toFixed(1)}c`);
  }
  console.log(`  ${sr} Hz  ${row.join(' ')}`);
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
