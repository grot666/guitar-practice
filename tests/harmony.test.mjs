// 编曲入门的乐理数据与算法测试：node tests/harmony.test.mjs
import { PC_NAME, CHORDS, OPEN_STRINGS, KEYS, DEGREES, scaleOf, stackTriad, ARRANGE, ARRANGE_SONGS, slotsOf, fitOf, songFit, autoHarmonize, minorColor, buildSchedule, chordChart, PATTERNS, isChordTone } from '../js/harmony.js';
import { parseSong } from '../js/songs.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  ✗ ' + msg); } };
const pcs = (a) => [...new Set(a.map((m) => ((m % 12) + 12) % 12))].sort((x, y) => x - y);
const same = (a, b) => JSON.stringify(pcs(a)) === JSON.stringify(pcs(b));

console.log('== 和弦');
const INTERVALS = { '大三': [0, 4, 7], '小三': [0, 3, 7], '属七': [0, 4, 7, 10] };
for (const [name, c] of Object.entries(CHORDS)) {
  ok(same(c.tones, INTERVALS[c.quality].map((x) => c.root + x)), `${name} 组成音与 ${c.quality} 和弦结构不符`);
  ok(same(c.voicing, c.tones), `${name} 播放音高的音级 ≠ 组成音`);
  const fromShape = [...c.shape].map((f, i) => (f === 'x' ? null : OPEN_STRINGS[i] + +f)).filter((x) => x !== null);
  ok(JSON.stringify(fromShape) === JSON.stringify(c.voicing), `${name} 按法 ${c.shape} 算出的音 ${fromShape} ≠ voicing ${c.voicing}`);
  ok(((c.voicing[0] % 12) + 12) % 12 === c.root, `${name} 最低音不是根音`);
  ok([...c.shape].every((f) => f === 'x' || +f <= 3), `${name} 不是开放把位按法`);
  console.log(`  ${name.padEnd(3)} ${c.shape}  组成音 ${c.tones.map((t) => PC_NAME[t]).join(' ')}`);
}
console.log('== 调内和弦 = 音阶上 1-3-5 叠出来的三和弦');
for (const [k, K] of Object.entries(KEYS)) {
  ok(JSON.stringify(scaleOf(k)) === JSON.stringify([0, 2, 4, 5, 7, 9, 11].map((s) => (s + K.tonic) % 12)), `${k} 音阶错误`);
  for (const [d, c] of Object.entries(K.chords)) {
    const idx = { I: 0, IV: 3, V: 4, vi: 5, V7: 4 }[d];
    const want = d === 'V7' ? [...stackTriad(k, 4), scaleOf(k)[(4 + 6) % 7]] : stackTriad(k, idx); // V7 = 5-7-2-4
    ok(same(want, CHORDS[c].tones), `${k} 调 ${d} 应为 ${c}`);
  }
  console.log(`  ${k} 大调：` + DEGREES.map((d) => `${d}=${K.chords[d]}`).join('  '));
}
console.log('== 曲子：参考和弦 / 自动配和弦');
for (const song of ARRANGE_SONGS) {
  const a = ARRANGE[song.id], K = KEYS[a.key], slots = slotsOf(song);
  const total = parseSong(song).reduce((m, n) => Math.max(m, n.start + n.beats), 0);
  const pk = song.pickup || 0;
  ok(pk < song.beats, `${song.id} 弱起应不满一小节`);
  ok((total - pk) % song.beats === 0 && song.beats % a.slot === 0, `${song.id} 小节/和弦格不整齐`);
  ok(slots[0].start === pk, `${song.id} 第一个和弦格应从弱起之后开始`);
  ok(a.chords.length === slots.length, `${song.id} 参考和弦 ${a.chords.length} 个，应为 ${slots.length}`);
  const dia = Object.values(K.chords);
  ok(a.chords.every((c) => dia.includes(c)), `${song.id} 参考和弦有调外和弦`);
  ok(a.chords[0] === K.chords.I && a.chords.at(-1) === K.chords.I, `${song.id} 没有从 I 开始、在 I 结束`);
  // 旋律的所有音都在调内（大调音阶）
  ok(parseSong(song).every((n) => n.midi === null || scaleOf(a.key).includes(n.midi % 12)), `${song.id} 旋律有调外音`);
  // 每个和弦格里，最长的旋律音必须是和弦内音（长音落在和弦上）
  // 每一格：参考和弦至少包含这一格的一个旋律音，并且不比最合适的调内和弦差太多
  slots.forEach((s, i) => {
    const f = fitOf(s, a.chords[i]), best = Math.max(...dia.map((c) => fitOf(s, c)));
    ok(f > 0 && f >= best - 0.6, // 允许经过音（如欢乐颂 E E F G 整小节用 C）
       `${song.id} 第 ${i + 1} 格 ${a.chords[i]} 贴合 ${f.toFixed(2)}，最好的是 ${best.toFixed(2)}`);
  });
  const refFit = songFit(song, a.chords);
  const auto = autoHarmonize(song), autoFit = songFit(song, auto);
  const agree = auto.filter((c, i) => c === a.chords[i]).length / auto.length;
  ok(refFit >= 0.7, `${song.id} 参考和弦贴合度 ${refFit.toFixed(2)} 太低`);
  ok(auto[0] === K.chords.I && auto.at(-1) === K.chords.I, `${song.id} 自动配和弦首尾不是 I`);
  ok(auto.at(-2) === K.chords.V || auto.at(-2) === K.chords.V7 || auto.at(-2) === K.chords.IV || auto.at(-2) === K.chords.I, `${song.id} 自动配和弦结尾前不是 V/IV/I`);
  ok(autoFit >= refFit - 0.05, `${song.id} 自动配和弦贴合度 ${autoFit.toFixed(2)} 比参考低太多`);
  ok(agree >= 0.6, `${song.id} 自动配和弦和参考只有 ${(agree * 100).toFixed(0)}% 相同`);
  const minor = minorColor(song, a.chords);
  ok(minor[0] === a.chords[0] && minor.at(-1) === a.chords.at(-1), `${song.id} 小调色彩改了首尾`);
  console.log(`  ${song.title.padEnd(8, '　')} ${a.key} 调 ${slots.length} 格  参考贴合 ${(refFit * 100).toFixed(0)}%  自动 ${(autoFit * 100).toFixed(0)}%  一致 ${(agree * 100).toFixed(0)}%  小调色彩改了 ${minor.filter((c, i) => c !== a.chords[i]).length} 格`);
  console.log('    参考 ' + chordChart(song, a.chords).split('\n').slice(1).join(' '));
  console.log('    自动 ' + chordChart(song, auto).split('\n').slice(1).join(' '));
}
console.log('== 播放事件表');
{
  const song = ARRANGE_SONGS.find((s) => s.id === 'twinkle'), a = ARRANGE.twinkle;
  const all = { melody: true, chords: true, bass: true, drums: true, drone: false };
  for (const pattern of Object.keys(PATTERNS)) {
    const { events, total, spb } = buildSchedule(song, { chords: a.chords, bpm: 90, pattern, layers: all });
    ok(Math.abs(spb - 60 / 90) < 1e-9, 'spb');
    ok(events.every((e, i) => i === 0 || e.t >= events[i - 1].t), `${pattern} 事件没排序`);
    ok(events.every((e) => e.t >= 0 && e.t < total), `${pattern} 有事件超出曲长`);
    const mel = events.filter((e) => e.kind === 'melody'), notes = parseSong(song).filter((n) => n.midi !== null);
    ok(mel.length === notes.length && mel.every((e, i) => Math.abs(e.t - notes[i].start * spb) < 1e-9 && e.midi === notes[i].midi), `${pattern} 旋律时间/音高不对`);
    const ch = events.filter((e) => e.kind === 'chord');
    ok(ch.every((e) => isChordTone(e.midi, a.chords[e.slot])), `${pattern} 伴奏里有不属于当前和弦的音`);
    const bars = total / spb / 4;
    const expectCount = { pad: a.chords.reduce((s, c) => s + CHORDS[c].voicing.length, 0), strum: a.chords.reduce((s, c) => s + 2 * CHORDS[c].voicing.length, 0), arp: bars * 8, boom: bars * 2 + bars * 2 * 3 }[pattern];
    ok(ch.length === expectCount, `${pattern} 伴奏事件 ${ch.length} 个，应为 ${expectCount}`);
    ok(events.filter((e) => e.kind === 'bass').length === a.chords.length, `${pattern} 低音数量不对`);
    ok(events.filter((e) => e.kind === 'kick').length === bars * 2 && events.filter((e) => e.kind === 'hat').length === bars * 4, `${pattern} 鼓数量不对`);
    console.log(`  ${PATTERNS[pattern].name.padEnd(6, '　')} ${events.length} 个事件，伴奏 ${ch.length}，总长 ${total.toFixed(1)}s`);
  }
  const off = buildSchedule(song, { chords: a.chords, bpm: 120, pattern: 'pad', layers: { melody: true, drone: true } });
  ok(off.events.every((e) => e.kind === 'melody' || e.kind === 'drone'), '关掉的层仍有事件');
  ok(off.events.filter((e) => e.kind === 'drone').length === 12 && off.events.filter((e) => e.kind === 'drone').every((e) => e.midi % 12 === 7), '持续低音应为每小节一个 G');
  const boom = buildSchedule(song, { chords: a.chords, bpm: 60, pattern: 'boom', layers: { chords: true } }).events;
  ok(boom.filter((e) => e.vol > 0.3).map((e) => e.t).slice(0, 4).join() === '0,2,4,6', '低音+和弦：低音应在第 1、3 拍');
  ok(chordChart(song, a.chords).split('\n')[1] === '| G | C G | C G | D G |', '和弦谱格式');
}
console.log('== 弱起、3/4 拍、低音线');
{
  const all = { melody: true, chords: true, bass: true, drums: true };
  // 弱起：和弦、低音、鼓都从弱起之后开始；弱起里只有旋律
  for (const id of ['saints', 'red-river', 'amazing-grace', 'auld-lang-syne', 'happy-birthday']) {
    const song = ARRANGE_SONGS.find((s) => s.id === id), a = ARRANGE[id], pk = song.pickup, spb = 60 / song.bpm;
    for (const pattern of Object.keys(PATTERNS)) {
      const { events, total } = buildSchedule(song, { chords: a.chords, bpm: song.bpm, pattern, layers: all });
      const pre = events.filter((e) => e.t < pk * spb - 1e-9);
      ok(pre.length > 0 && pre.every((e) => e.kind === 'melody'), `${id} ${pattern}：弱起里应只有旋律`);
      ok(events.filter((e) => e.kind === 'kick')[0].t === pk * spb, `${id} ${pattern}：第一个底鼓应在弱起之后的第 1 拍`);
      ok(Math.abs(total - (pk + slotsOf(song).length * a.slot) * spb) < 1e-9, `${id} 总长`);
    }
    ok(chordChart(song, a.chords).includes(`弱起 ${pk} 拍`), `${id} 和弦谱应注明弱起`);
  }
  // 3/4：「低音+和弦」= 嘣-恰-恰，低音只在每小节第 1 拍；鼓每小节一个底鼓、三个踩镲
  const bl = ARRANGE_SONGS.find((s) => s.id === 'brahms-lullaby'), spb = 60 / 60;
  const ev = buildSchedule(bl, { chords: ARRANGE['brahms-lullaby'].chords, bpm: 60, pattern: 'boom', layers: { chords: true, drums: true } }).events;
  const booms = ev.filter((e) => e.kind === 'chord' && e.vol > 0.3).map((e) => +(e.t - bl.pickup * spb).toFixed(6));
  ok(booms.length === 16 && booms.every((t, i) => t === i * 3), '3/4 低音+和弦：低音应在每小节第 1 拍');
  ok(ev.filter((e) => e.kind === 'chord' && e.vol <= 0.3).length === 16 * 2 * 3, '3/4 低音+和弦：每小节两下「恰」');
  ok(ev.filter((e) => e.kind === 'kick').length === 16 && ev.filter((e) => e.kind === 'hat').length === 48, '3/4 鼓');
  const arp = buildSchedule(bl, { chords: ARRANGE['brahms-lullaby'].chords, bpm: 60, pattern: 'arp', layers: { chords: true } }).events;
  ok(arp.length === 16 * 6, '3/4 分解和弦：每小节 6 个八分音符');
  // 低音线：4 拍一格 + 扫弦 → 根音、五音；其他 → 根音
  const tw = ARRANGE_SONGS.find((s) => s.id === 'jingle-bells');
  const b1 = buildSchedule(tw, { chords: ARRANGE['jingle-bells'].chords, bpm: 60, pattern: 'strum', layers: { bass: true } }).events;
  ok(b1.length === 32 && b1.every((e, i) => (i % 2 ? e.midi === b1[i - 1].midi + 7 && e.t === b1[i - 1].t + 2 : CHORDS[ARRANGE['jingle-bells'].chords[e.slot]].root === e.midi % 12)), '扫弦时低音 = 根音（第 1 拍）+ 五音（第 3 拍）');
  const b2 = buildSchedule(tw, { chords: ARRANGE['jingle-bells'].chords, bpm: 60, pattern: 'pad', layers: { bass: true } }).events;
  ok(b2.length === 16 && b2.every((e) => e.midi >= 40 && e.midi <= 51), '长音时每格一个根音，音区 E2–D#3');
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
