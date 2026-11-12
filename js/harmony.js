// harmony.js — 编曲入门用到的乐理数据和纯函数（没有 DOM，Node 里可以直接测试）
//   和弦定义（组成音、吉他开放把位按法、播放用的音高）、调内和弦（I IV V vi）、
//   旋律和和弦的「贴合度」、自动配和弦、伴奏型 → 播放事件表。
import { SONGS, parseSong } from './songs.js';

export const PC_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 和弦：root 根音音级，tones 组成音音级（根音、三音、五音[、七音]），shape 吉他按法（6 弦 → 1 弦，x = 不弹），voicing 播放音高（MIDI，低 → 高） */
export const CHORDS = {
  C:  { root: 0, tones: [0, 4, 7], quality: '大三', shape: 'x32010', voicing: [48, 52, 55, 60, 64] },
  D:  { root: 2, tones: [2, 6, 9], quality: '大三', shape: 'xx0232', voicing: [50, 57, 62, 66] },
  D7: { root: 2, tones: [2, 6, 9, 0], quality: '属七', shape: 'xx0212', voicing: [50, 57, 60, 66] },
  Em: { root: 4, tones: [4, 7, 11], quality: '小三', shape: '022000', voicing: [40, 47, 52, 55, 59, 64] },
  F:  { root: 5, tones: [5, 9, 0], quality: '大三', shape: 'xx3211', voicing: [53, 57, 60, 65] },
  G:  { root: 7, tones: [7, 11, 2], quality: '大三', shape: '320003', voicing: [43, 47, 50, 55, 59, 67] },
  G7: { root: 7, tones: [7, 11, 2, 5], quality: '属七', shape: '320001', voicing: [43, 47, 50, 55, 59, 65] },
  Am: { root: 9, tones: [9, 0, 4], quality: '小三', shape: 'x02210', voicing: [45, 52, 57, 60, 64] },
};
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64]; // 6 弦 → 1 弦

/** 调：大调音阶 + 这一阶段用到的调内和弦（用级数表示） */
export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
export const KEYS = {
  C: { tonic: 0, chords: { I: 'C', IV: 'F', V: 'G', vi: 'Am', V7: 'G7' } },
  G: { tonic: 7, chords: { I: 'G', IV: 'C', V: 'D', vi: 'Em', V7: 'D7' } },
};
export const DEGREES = ['I', 'IV', 'V', 'vi', 'V7']; // V7 = 属七和弦：V 再往上叠一个三度
export const scaleOf = (key) => MAJOR_STEPS.map((s) => (KEYS[key].tonic + s) % 12);
/** 在音阶上「隔一个取一个」叠出三和弦：第 d 级（0 起）→ [d, d+2, d+4] 三个音级 */
export function stackTriad(key, d) { const sc = scaleOf(key); return [sc[d % 7], sc[(d + 2) % 7], sc[(d + 4) % 7]]; }
export const ROMAN_INDEX = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5 };
export function degreeOf(key, chord) { for (const [r, c] of Object.entries(KEYS[key].chords)) if (c === chord) return r; return ''; }
export const bassMidi = (chord) => 36 + CHORDS[chord].root; // 低音：C2–B2 一个八度

/**
 * 可以编曲的曲子：key 调，slot 每个和弦格占几拍，chords 参考和弦（按格）。
 * 参考和弦按通行的简易和声写：大调只用 I / IV / V / vi，旋律的长音和强拍尽量落在和弦内音上。
 */
export const ARRANGE = {
  twinkle: { key: 'G', slot: 2,
    // 一闪一闪亮晶晶 | 满天都是小星星 | 挂在天上放光明 | 好像许多小眼睛 | 一闪一闪亮晶晶 | 满天都是小星星
    chords: ['G', 'G', 'C', 'G', 'C', 'G', 'D', 'G',  'G', 'C', 'G', 'D', 'G', 'C', 'G', 'D',  'G', 'G', 'C', 'G', 'C', 'G', 'D', 'G'] },
  'mary-lamb': { key: 'C', slot: 4, chords: ['C', 'C', 'G', 'C', 'C', 'C', 'G', 'C'] },
  'london-bridge': { key: 'G', slot: 4, chords: ['G', 'G', 'D7', 'G', 'G', 'G', 'D', 'G'] }, // 第 3 小节 A B C：D7 里正好有 A 和 C
  'ode-to-joy': { key: 'C', slot: 2,
    // 第 2 小节 G F E D 用 G7（F 是 G7 的七音）；第 4、8 小节是半终止 / 正格终止
    chords: ['C', 'C', 'G7', 'G7', 'C', 'C', 'C', 'G',  'C', 'C', 'G7', 'G7', 'C', 'C', 'G', 'C',
             'G', 'C', 'G7', 'C', 'G7', 'C', 'C', 'G',  'C', 'C', 'G7', 'G7', 'C', 'C', 'G', 'C'] },
  'jingle-bells': { key: 'C', slot: 4, chords: ['C', 'C', 'C', 'C', 'F', 'C', 'G', 'G', 'C', 'C', 'C', 'C', 'F', 'C', 'G', 'C'] },
};
export const ARRANGE_SONGS = Object.keys(ARRANGE).map((id) => SONGS.find((s) => s.id === id));

/** 每个和弦格里的旋律：[{note, w}]，w = 在格内的时长 ×（落在格的起点 = 强拍时 ×1.5） */
export function slotsOf(song) {
  const a = ARRANGE[song.id], notes = parseSong(song).filter((n) => n.midi !== null);
  const total = notes.reduce((m, n) => Math.max(m, n.start + n.beats), 0);
  const count = Math.round(total / a.slot);
  const slots = Array.from({ length: count }, (_, i) => ({ i, start: i * a.slot, beats: a.slot, notes: [] }));
  for (const n of notes) {
    for (const s of slots) {
      const ov = Math.min(n.start + n.beats, s.start + s.beats) - Math.max(n.start, s.start);
      if (ov > 1e-6) s.notes.push({ note: n, w: ov * (Math.abs(n.start - s.start) < 1e-6 ? 1.5 : 1) });
    }
  }
  return slots;
}
export const isChordTone = (midi, chord) => CHORDS[chord].tones.includes(((midi % 12) + 12) % 12);
/** 贴合度：这一格里旋律（按时长和强拍加权）有多少落在和弦内音上，0–1 */
export function fitOf(slot, chord) {
  let a = 0, b = 0;
  for (const { note, w } of slot.notes) { b += w; if (isChordTone(note.midi, chord)) a += w; }
  return b ? a / b : 1;
}
export const fitClass = (f) => (f >= 0.75 ? 'hi' : f >= 0.4 ? 'mid' : 'lo');
export function songFit(song, chords) { const s = slotsOf(song); return s.reduce((x, sl, i) => x + fitOf(sl, chords[i]), 0) / s.length; }

/**
 * 自动配和弦（动态规划）：每格在 I / IV / V / vi 里选一个，
 * 得分 = 贴合度 − 换和弦的小惩罚，开头和结尾用 I，结尾前一格用 V 有加分（终止式）。
 */
export function autoHarmonize(song, degrees = DEGREES) {
  const a = ARRANGE[song.id], K = KEYS[a.key], slots = slotsOf(song), n = slots.length;
  const cands = degrees.map((d) => K.chords[d]);
  const bias = { I: 0.06, IV: 0, V: 0.02, vi: -0.08, V7: -0.03 };
  const local = (i, c) => {
    const d = degrees[cands.indexOf(c)];
    let s = fitOf(slots[i], c) + bias[d];
    if ((i === 0 || i === n - 1) && d === 'I') s += 1;   // 从主和弦开始、回到主和弦结束
    if (i === n - 1 && d !== 'I') s -= 5;
    if (i === n - 2 && (d === 'V' || d === 'V7')) s += 0.3;              // 属 → 主：正格终止
    return s;
  };
  let score = cands.map((c) => local(0, c)), back = [];
  for (let i = 1; i < n; i++) {
    const ns = [], bk = [];
    cands.forEach((c, j) => {
      let best = -Infinity, arg = 0;
      cands.forEach((p, k) => {
        let v = score[k] - (p === c ? 0 : 0.12);
        if (K.chords.IV === p && K.chords.I === c) v += 0.02; // IV → I 也顺耳
        if ((K.chords.V === p || K.chords.V7 === p) && K.chords.IV === c) v -= 0.1;
        if (K.chords.V7 === p && K.chords.I !== c && p !== c) v -= 0.1; // 属七一般要回到 I  // V → IV 在古典和声里较少
        if (v > best) { best = v; arg = k; }
      });
      ns.push(best + local(i, c)); bk.push(arg);
    });
    score = ns; back.push(bk);
  }
  let j = score.indexOf(Math.max(...score));
  const out = [cands[j]];
  for (let i = n - 2; i >= 0; i--) { j = back[i][j]; out.unshift(cands[j]); }
  return out;
}

/** 情绪：把中间的 I 换成 vi（关系小调和弦，和 I 有两个共同音），贴合度够的地方才换 */
export function minorColor(song, chords) {
  const a = ARRANGE[song.id], K = KEYS[a.key], slots = slotsOf(song);
  return chords.map((c, i) => (c === K.chords.I && i > 0 && i < chords.length - 1 && fitOf(slots[i], K.chords.vi) >= 0.5 ? K.chords.vi : c));
}

export const PATTERNS = {
  pad:   { name: '长音', desc: '每个和弦拨一下，让它一直响。最安静，突出旋律。' },
  strum: { name: '扫弦', desc: '每拍扫一下。节奏感强，热闹。' },
  arp:   { name: '分解和弦', desc: '把和弦里的音一个一个弹出来（八分音符）。流动、抒情。' },
  boom:  { name: '低音+和弦', desc: '「嘣-恰」：强拍弹低音，弱拍弹和弦。民谣、乡村常用。' },
};

/**
 * 生成播放事件表（时间单位秒，从 0 开始）。
 * opts: { chords, bpm, pattern, layers: {melody, chords, bass, drums, drone} }
 * 事件：{ t, kind: 'melody'|'chord'|'bass'|'drone'|'kick'|'hat', midi?, dur, vol, slot? }
 */
export function buildSchedule(song, opts) {
  const a = ARRANGE[song.id], spb = 60 / opts.bpm, L = opts.layers, beatsPerBar = song.beats;
  const slots = slotsOf(song), ev = [];
  const total = slots.length * a.slot * spb;
  if (L.melody) for (const n of parseSong(song)) if (n.midi !== null) ev.push({ t: n.start * spb, kind: 'melody', midi: n.midi, dur: n.beats * spb * 0.95, vol: 0.9 });
  slots.forEach((s, i) => {
    const ch = opts.chords[i], v = CHORDS[ch].voicing, t0 = s.start * spb;
    if (L.chords) {
      if (opts.pattern === 'pad') v.forEach((m, k) => ev.push({ t: t0 + k * 0.012, kind: 'chord', midi: m, dur: s.beats * spb * 0.98, vol: 0.2, slot: i }));
      else if (opts.pattern === 'strum') {
        for (let b = 0; b < s.beats; b++) {
          const acc = (s.start + b) % beatsPerBar === 0;
          v.forEach((m, k) => ev.push({ t: t0 + b * spb + k * 0.01, kind: 'chord', midi: m, dur: spb * 0.9, vol: acc ? 0.24 : 0.17, slot: i }));
        }
      } else if (opts.pattern === 'arp') {
        const n = v.length, order = [0, n - 3, n - 2, n - 1, n - 2, n - 3, n - 2, n - 1];
        for (let e = 0; e < s.beats * 2; e++) ev.push({ t: t0 + e * spb / 2, kind: 'chord', midi: v[order[e % 8]], dur: spb * 1.2, vol: e % 8 === 0 ? 0.3 : 0.22, slot: i });
      } else if (opts.pattern === 'boom') {
        for (let b = 0; b < s.beats; b++) {
          const inBar = (s.start + b) % beatsPerBar;
          const tb = t0 + b * spb;
          if (inBar % 2 === 0) ev.push({ t: tb, kind: 'chord', midi: v[0], dur: spb * 0.95, vol: 0.34, slot: i });
          else v.slice(-3).forEach((m, k) => ev.push({ t: tb + k * 0.006, kind: 'chord', midi: m, dur: spb * 0.55, vol: 0.2, slot: i }));
        }
      }
    }
    if (L.bass) ev.push({ t: t0, kind: 'bass', midi: bassMidi(ch), dur: s.beats * spb * 0.95, vol: 0.55, slot: i });
  });
  const bars = Math.round(slots.length * a.slot / beatsPerBar);
  for (let b = 0; b < bars; b++) {
    const tb = b * beatsPerBar * spb;
    if (L.drone) ev.push({ t: tb, kind: 'drone', midi: 36 + KEYS[a.key].tonic, dur: beatsPerBar * spb * 0.98, vol: 0.5 });
    if (L.drums) for (let k = 0; k < beatsPerBar; k++) {
      if (k === 0 || (beatsPerBar === 4 && k === 2)) ev.push({ t: tb + k * spb, kind: 'kick', dur: 0.3, vol: 0.7 });
      ev.push({ t: tb + k * spb, kind: 'hat', dur: 0.05, vol: k === 0 ? 0.2 : 0.13 });
    }
  }
  ev.sort((x, y) => x.t - y.t);
  return { events: ev, total, spb, slots };
}

/** 导出和弦谱：| C | G | Am F | …，每行 4 小节 */
export function chordChart(song, chords, extra = {}) {
  const a = ARRANGE[song.id], per = song.beats / a.slot, bars = [];
  for (let i = 0; i < chords.length; i += per) {
    const cs = chords.slice(i, i + per);
    bars.push(cs.every((c) => c === cs[0]) ? cs[0] : cs.join(' '));
  }
  const lines = [];
  for (let i = 0; i < bars.length; i += 4) lines.push('| ' + bars.slice(i, i + 4).join(' | ') + ' |');
  const head = `${song.title}（${song.en}）  ${a.key} 大调  ${song.beats}/4` + (extra.bpm ? `  ♩=${extra.bpm}` : '') + (extra.pattern ? `  伴奏：${PATTERNS[extra.pattern].name}` : '');
  return head + '\n' + lines.join('\n') + '\n';
}
