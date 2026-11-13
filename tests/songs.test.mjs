// 曲库检查：每首曲子能解析、都在第一把位、小节对齐，并与已知旋律的音程走向逐一比对
import { SONGS, parseSong, fingerFor, makeFretDrill, OPEN_MIDI } from '../js/songs.js';
import { midiName } from '../js/dsp.js';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  ✗ ' + m); } };

// 已知旋律（相对第一个音的半音数，取开头若干音），来源：常见简谱/五线谱
const KNOWN = {
  'hot-cross-buns': [0, -2, -4, 0, -2, -4],                 // 3 2 1  3 2 1
  'mary-lamb': [0, -2, -4, -2, 0, 0, 0],                     // 3 2 1 2 3 3 3
  'twinkle': [0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0],     // 1 1 5 5 6 6 5 4 4 3 3 2 2 1
  'au-clair': [0, 0, 0, 2, 4, 2, 0, 4, 2, 2, 0],             // 1 1 1 2 3 2 1 3 2 2 1
  'ode-to-joy': [0, 0, 1, 3, 3, 1, 0, -2, -4, -4, -2, 0, 0, -2, -2], // 3 3 4 5 5 4 3 2 1 1 2 3 3 2 2
  'two-tigers': [0, 2, 4, 0, 0, 2, 4, 0, 4, 5, 7, 4, 5, 7],  // 1 2 3 1 1 2 3 1 3 4 5 3 4 5
  'london-bridge': [0, 2, 0, -2, -3, -2, 0, -5, -3, -2],     // 5 6 5 4 3 4 5 2 3 4
  'yankee-doodle': [0, 0, 2, 4, 0, 4, 2, -5],                // 1 1 2 3 1 3 2 5̣
  'happy-birthday': [0, 0, 2, 0, 5, 4, 0, 0, 2, 0, 7, 5, 0, 0, 12, 9, 5, 4, 2, 10, 10, 9, 5, 7, 5], // 5̣5̣6̣5̣1 7̣ ...
  'jingle-bells': [0, 0, 0, 0, 0, 0, 0, 3, -4, -2, 0],       // 3 3 3 3 3 3 3 5 1 2 3
  'songbie': [0, -3, 0, 5, 2, 5, 0, 0, -7, -5, -3, -5, -7, -5], // 5 3 5 1̇ 6 1̇ 5 5 1 2 3 2 1 2
  // 以下按通行简谱逐音核对（与谱源 ABC / 五线谱独立对照）
  'lightly-row': [0, -3, -3, -2, -5, -5, -7, -5, -3, -2, 0, 0, 0],    // 5 3 3 4 2 2 1 2 3 4 5 5 5
  'old-macdonald': [0, 0, 0, -5, -3, -3, -5, 4, 4, 2, 2, 0],          // 1 1 1 5̣ 6̣ 6̣ 5̣ 3 3 2 2 1
  'saints': [0, 4, 5, 7, 0, 4, 5, 7, 0, 4, 5, 7, 4, 0, 4, 2],         // 1 3 4 5  1 3 4 5  1 3 4 5 3 1 3 2
  'oh-susanna': [0, 2, 4, 7, 7, 9, 7, 4, 0, 2, 4, 4, 2, 0, 2],        // 1 2 3 5 5 6 5 3 1 2 3 3 2 1 2
  'camptown': [0, 0, 0, -3, 0, 2, 0, -3, -3, -5],                     // 5 5 5 3 5 6 5 3 3 2
  'red-river': [0, 5, 9, 9, 9, 9, 7, 9, 7, 5],                        // 5̣ 1 3 3 3 3 2 3 2 1
  'clementine': [0, 0, 0, -5, 4, 4, 4, 0, 0, 4, 7, 7, 5, 4, 2],       // 1 1 1 5̣ 3 3 3 1 1 3 5 5 4 3 2
  'amazing-grace': [0, 5, 9, 5, 9, 7, 5, 2, 0],                       // 5̣ 1 3 1 3 2 1 6̣ 5̣
  'brahms-lullaby': [0, 0, 3, 0, 0, 3, 0, 3, 8, 7, 5, 5, 3],          // 3 3 5 3 3 5 3 5 1̇ 7 6 6 5
  'auld-lang-syne': [0, 5, 5, 5, 9, 7, 5, 7, 9, 5, 5, 9, 12, 14],     // 5̣ 1 1 1 3 2 1 2 3 1 1 3 5 6
};

console.log('== 曲库');
for (const s of SONGS) {
  let notes;
  try { notes = parseSong(s); } catch (e) { ok(false, e.message); continue; }
  const pitched = notes.filter((n) => n.midi !== null);
  const total = notes.reduce((a, n) => a + n.beats, 0);
  const bars = (total - s.pickup) / s.beats;
  const maxFret = Math.max(...pitched.map((n) => n.fret));
  const strings = [...new Set(pitched.map((n) => n.string))].sort();
  const lo = Math.min(...pitched.map((n) => n.midi)), hi = Math.max(...pitched.map((n) => n.midi));
  const onHigh = pitched.filter((n) => n.string <= 3).length / pitched.length;
  const known = KNOWN[s.id];
  const rel = pitched.map((n) => n.midi - pitched[0].midi);
  const match = known ? known.every((v, i) => rel[i] === v) : false;
  console.log(`  ${s.title.padEnd(8, '　')} ${pitched.length} 个音，${total} 拍 = ${bars} 小节，音域 ${midiName(lo)}–${midiName(hi)}，弦 ${strings.join(',')}，最高 ${maxFret} 品，1–3 弦占 ${(onHigh * 100).toFixed(0)}%，旋律比对 ${match ? '✓' : '✗'}`);
  ok(Number.isInteger(bars), `${s.id} 小节数应为整数（${bars}）`);
  ok(maxFret <= 4, `${s.id} 应在第一把位`);
  ok(onHigh >= 0.85, `${s.id} 应主要在 1–3 弦`);
  ok(match, `${s.id} 开头旋律与已知音程不符：${rel.slice(0, known ? known.length : 8).join(',')}`);
  ok(s.source && s.source.includes('公有领域'), `${s.id} 需要注明公有领域`);
  for (const n of pitched) ok(OPEN_MIDI[n.string] + n.fret === n.midi, `${s.id} 指法与音高不符`);
}

console.log('== 指法');
ok(fingerFor(64).string === 1 && fingerFor(64).fret === 0, 'E4 → 1 弦空弦');
ok(fingerFor(59).string === 2 && fingerFor(59).fret === 0, 'B3 → 2 弦空弦');
ok(fingerFor(57).string === 3 && fingerFor(57).fret === 2, 'A3 → 3 弦 2 品');
ok(fingerFor(67).string === 1 && fingerFor(67).fret === 3, 'G4 → 1 弦 3 品');
ok(fingerFor(54).string === 4 && fingerFor(54).fret === 4, 'F#3 → 4 弦 4 品');
const d = parseSong(makeFretDrill({ strings: [1, 2], maxFret: 3, count: 20 }));
ok(d.length === 20 && d.every((n) => n.string <= 2 && n.fret <= 3), '指板练习范围');
ok(d.every((n, i) => i === 0 || !(n.string === d[i - 1].string && n.fret === d[i - 1].fret)), '指板练习不连续重复');
console.log(fails ? `\n失败 ${fails} 项` : '\n全部通过');
process.exit(fails ? 1 : 0);
