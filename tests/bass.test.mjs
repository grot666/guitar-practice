// 低音音色与混音的离线测试：node tests/bass.test.mjs
//   每种音色：音高准、有基频也有 2、3 次谐波（手机上听得到）、高频不刺耳、起音柔和不爆音、峰值不超；
//   整首编曲（旋律 + 和弦 + 低音 + 鼓）离线混音：限幅器之前的峰值 < 1（不削波），各层响度平衡。
import { renderBass, BASS_TONES, bassRegister } from '../js/bass.js';
import { AudioEngine } from '../js/audio.js';
import { detectPitch, midiToFreq, centsBetween } from '../js/dsp.js';
import { ARRANGE, ARRANGE_SONGS, buildSchedule, PATTERNS } from '../js/harmony.js';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
/** 汉宁窗 Goertzel：频率 f 的幅度 */
function mag(x, f, sr, a, b) {
  const w = 2 * Math.PI * f / sr; let re = 0, im = 0;
  for (let i = a; i < b; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)); re += x[i] * h * Math.cos(w * i); im -= x[i] * h * Math.sin(w * i); }
  return Math.hypot(re, im) / (b - a) * 4;
}
function biquad(x, sr, type, fc) {
  const Q = Math.SQRT1_2, w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
  const [b0, b1, b2] = type === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al, y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const rms = (x, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)); };
/** 手机扬声器的粗略模型：250 Hz 以下 4 阶滚降 */
const phone = (x, sr) => biquad(biquad(x, sr, 'hp', 250), sr, 'hp', 250);

console.log('== 低音音色（E2–D#3，三种采样率）');
for (const sr of [22050, 44100, 48000]) {
  for (const tone of Object.keys(BASS_TONES)) {
    const row = [];
    for (let m = 40; m <= 51; m++) {
      const x = renderBass(tone, m, sr, 2.5);
      const f = midiToFreq(m), a = Math.round(0.03 * sr), b = Math.round(0.45 * sr);
      const H = [1, 2, 3, 4, 5].map((k) => mag(x, f * k, sr, a, b));
      let pk = 0, mean = 0, nan = false;
      for (const v of x) { pk = Math.max(pk, Math.abs(v)); mean += v; if (!Number.isFinite(v)) nan = true; }
      mean /= x.length;
      const N = 4096 * (sr / 48000) | 0, seg = x.subarray(Math.round(0.1 * sr), Math.round(0.1 * sr) + Math.max(2048, N));
      const r = detectPitch(seg, sr, { rmsGate: 0.001, minFreq: 50, maxFreq: 600 });
      const cents = r ? centsBetween(r.freq, f) : NaN;
      let atk = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.5 * pk) { atk = i / sr * 1000; break; }
      // 2 kHz 以上的能量占比（刺耳程度）
      const hi = rms(biquad(biquad(x, sr, 'hp', 2000), sr, 'hp', 2000), a, b) / rms(x, a, b);
      const ph = rms(phone(x, sr), 0, Math.round(0.6 * sr));
      ok(!nan && pk <= 0.6 + 1e-6 && pk > 0.59, `${tone} ${m} @${sr}: 峰值 ${pk}`);
      ok(Math.abs(x[0]) < 1e-3 && Math.abs(mean) < 0.01, `${tone} ${m} @${sr}: 开头 ${x[0]} / 直流 ${mean}`);
      ok(r && Math.abs(cents) < 5, `${tone} ${m} @${sr}: 音高偏 ${cents.toFixed(1)} 音分`);
      ok(db(H[0] / Math.max(...H)) > -10, `${tone} ${m} @${sr}: 基频太弱`);
      ok(db(H[1] / H[0]) > -18 || db(H[2] / H[0]) > -18, `${tone} ${m} @${sr}: 2、3 次谐波太弱（${db(H[1] / H[0]).toFixed(0)} / ${db(H[2] / H[0]).toFixed(0)} dB），手机上听不到音高`);
      ok(atk >= 1.5 && atk <= 15, `${tone} ${m} @${sr}: 起音 ${atk.toFixed(1)} ms（应 1.5–15 ms：不爆音也不拖）`);
      ok(db(hi) < (tone === 'guitar' ? -14 : -28), `${tone} ${m} @${sr}: 2 kHz 以上 ${db(hi).toFixed(0)} dB，太刺`);
      ok(ph > 0.025, `${tone} ${m} @${sr}: 手机扬声器模型下 RMS ${ph.toFixed(3)}，太小`);
      if (sr === 48000 && (m === 40 || m === 45 || m === 50)) row.push(`${m}: H1-H5 ${H.map((h) => db(h / H[0]).toFixed(0)).join('/')} dB, >2k ${db(hi).toFixed(0)} dB, 手机 ${ph.toFixed(3)}, 起音 ${atk.toFixed(1)}ms, ${cents.toFixed(1)}c`);
    }
    if (row.length) console.log(`  ${BASS_TONES[tone].name}  ` + row.join(' | '));
  }
}
ok(bassRegister(4) === 40 && bassRegister(3) === 51 && bassRegister(0) === 48 && bassRegister(7) === 43, '低音音区 E2–D#3');

console.log('== 整首离线混音（限幅前峰值、各层响度）');
{
  const sr = 22050, e = new AudioEngine();
  e.ctx = { sampleRate: sr, createBuffer: (c, n) => { const d = new Float32Array(n); return { getChannelData: () => d }; } };
  const kick = (() => { const n = Math.round(0.3 * sr), x = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr, f = 130 * Math.pow(45 / 130, Math.min(1, t / 0.12)); ph += 2 * Math.PI * f / sr; x[i] = Math.sin(ph) * Math.exp(-t / 0.05); } return x; })();
  const hat = (() => { let s = 1; const n = Math.round(0.05 * sr), x = new Float32Array(n); for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; x[i] = (s / 233280 * 2 - 1) * Math.exp(-i / sr / 0.01); } return biquad(x, sr, 'hp', 7000); })();
  // 播放时的增益：和 arrange.js scheduleEvents / audio.js 一致
  const mixOf = (song, pattern, tone) => {
    const { events, total } = buildSchedule(song, { chords: ARRANGE[song.id].chords, bpm: song.bpm, pattern, layers: { melody: true, chords: true, bass: true, drums: true } });
    const n = Math.ceil((total + 3) * sr), layers = { melody: new Float32Array(n), chord: new Float32Array(n), bass: new Float32Array(n), drums: new Float32Array(n) };
    for (const ev of events) {
      const vol = ev.vol * 0.7, i0 = Math.round(ev.t * sr);
      let buf, gain, out, tc = 0.04;
      if (ev.kind === 'kick' || ev.kind === 'hat') { buf = ev.kind === 'kick' ? kick : hat; gain = vol; out = layers.drums; }
      else if (ev.kind === 'bass') { buf = renderBass(tone, ev.midi, sr, 2.5); gain = vol * BASS_TONES[tone].gain; out = layers.bass; tc = 0.05; }
      else { buf = e._pluckBuffer(ev.midi).getChannelData(0); gain = vol; out = ev.kind === 'melody' ? layers.melody : layers.chord; }
      const endI = ev.kind === 'kick' || ev.kind === 'hat' ? Infinity : Math.round(Math.max(0.05, ev.dur) * sr);
      for (let j = 0; j < buf.length && i0 + j < n; j++) {
        const g = j < endI ? gain : gain * Math.exp(-(j - endI) / sr / tc);
        if (g < 1e-4) break;
        out[i0 + j] += buf[j] * g;
      }
    }
    const sum = new Float32Array(n); let pk = 0;
    for (let i = 0; i < n; i++) { sum[i] = layers.melody[i] + layers.chord[i] + layers.bass[i] + layers.drums[i]; pk = Math.max(pk, Math.abs(sum[i])); }
    const L = Object.fromEntries(Object.entries(layers).map(([k, x]) => [k, rms(x)]));
    return { pk, L, ph: Object.fromEntries(Object.entries(layers).map(([k, x]) => [k, rms(phone(x, sr))])) };
  };
  for (const id of ['twinkle', 'oh-susanna', 'brahms-lullaby', 'auld-lang-syne']) {
    const song = ARRANGE_SONGS.find((s) => s.id === id);
    for (const pattern of Object.keys(PATTERNS)) for (const tone of Object.keys(BASS_TONES)) {
      const { pk, L, ph } = mixOf(song, pattern, tone);
      ok(pk < 1, `${id} ${pattern} ${tone}: 限幅前峰值 ${pk.toFixed(2)} ≥ 1，会削波`);
      const rB = L.bass / L.chord, rM = L.melody / L.bass;
      ok(rB > 0.6 && rB < 2.5, `${id} ${pattern} ${tone}: 低音/和弦响度比 ${rB.toFixed(2)} 不平衡`);
      ok(rM > 0.8, `${id} ${pattern} ${tone}: 旋律/低音 ${rM.toFixed(2)}，旋律被盖住`);
      ok(ph.bass > 0.2 * ph.chord, `${id} ${pattern} ${tone}: 手机上低音只有和弦的 ${(ph.bass / ph.chord * 100).toFixed(0)}%`);
      if (tone === 'warm' && (pattern === 'pad' || pattern === 'strum')) console.log(`  ${song.title.padEnd(8, '　')} ${PATTERNS[pattern].name.padEnd(6, '　')} 峰值 ${pk.toFixed(2)}  RMS 旋律 ${L.melody.toFixed(3)} 和弦 ${L.chord.toFixed(3)} 低音 ${L.bass.toFixed(3)} 鼓 ${L.drums.toFixed(3)}  手机上 低音/和弦 ${(ph.bass / ph.chord * 100).toFixed(0)}%`);
    }
  }
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
