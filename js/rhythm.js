// rhythm.js — 节奏训练的纯逻辑（不碰 DOM / Web Audio，node 里可直接测试）
//   · 拍号、节奏型库、每小节的期望起音
//   · 击打与期望起音的匹配（最近的期望点、漏拍、多弹）
//   · 统计诊断（抢拍/拖拍、稳定性、每个位置的统计、最差位置、专项建议）
//   · 速度阶梯（连续达标加速，失败退一档）
//   · 节拍器的「间歇」规则（只响 2、4 拍 / 每 Y 小节静 X 小节）
//   · 回环延迟测量（喇叭放「啾」声 → 麦克风录 → 互相关）
//   · 外部节拍器：从麦克风里找出规律的「嗒」声、估计速度和抖动、锁相，区分节拍器声和你的拨弦
import { OnsetDetector } from './dsp.js';

// ---------------- 拍号 ----------------
// beats = 每小节几拍（6/8 按两大拍算，一大拍 = 附点四分 = 3 个八分）；sub = 节拍器细分点
export const METERS = {
  '2/4': { id: '2/4', beats: 2, sub: 1, compound: false },
  '3/4': { id: '3/4', beats: 3, sub: 1, compound: false },
  '4/4': { id: '4/4', beats: 4, sub: 1, compound: false },
  '6/8': { id: '6/8', beats: 2, sub: 3, compound: true },
};

// ---------------- 节奏型库 ----------------
// cell = 一个循环多少拍；hits = [拍内位置(拍), 方向 'D' 下 / 'U' 上 / '']；res = 每拍画几格
const SIMPLE = ['2/4', '3/4', '4/4'];
export const PATTERNS = [
  { id: 'q', name: '四分音符', short: '♩', hint: '每拍一下。先把「拍子」本身弹稳。', meters: SIMPLE, cell: 1, res: 1, level: 1, hits: [[0, 'D']] },
  { id: 'e', name: '八分音符', short: '♫', hint: '每拍两下，数「1 和 2 和」，下上交替。', meters: SIMPLE, cell: 1, res: 2, level: 1, hits: [[0, 'D'], [0.5, 'U']] },
  { id: 'chord-change', name: '开放和弦转换 · Em / G', short: 'Em → G', hint: '每小节第一拍向下扫一次。Em、G 交替；只评换和弦后的落拍。', meters: ['4/4'], cell: 4, res: 1, level: 1, hits: [[0, 'D']], chords: ['Em', 'G'] },
  { id: 'rest', name: '四分 + 休止', short: '♩ 𝄽', hint: '弹一拍、空一拍。休止也要「数」出来，别提前进。', meters: ['2/4', '4/4'], cell: 2, res: 1, level: 1, hits: [[0, 'D']] },
  { id: 'off', name: '反拍八分', short: '𝄾♪', hint: '拍上休止，只弹「和」。心里数拍，手在拍上空挥一下。', meters: SIMPLE, cell: 1, res: 2, level: 2, hits: [[0.5, 'U']] },
  { id: 't', name: '三连音', short: '³♪♪♪', hint: '一拍均分三下，数「1 2 3」。三个音要一样长。', meters: SIMPLE, cell: 1, res: 3, level: 2, hits: [[0, 'D'], [1 / 3, 'U'], [2 / 3, 'D']] },
  { id: 's', name: '十六分音符', short: '♬♬', hint: '一拍四下，数「1 e 和 a」。手腕放松、幅度小。', meters: SIMPLE, cell: 1, res: 4, level: 2, hits: [[0, 'D'], [0.25, 'U'], [0.5, 'D'], [0.75, 'U']] },
  { id: 'gal', name: '八分 + 两个十六分', short: '♪♬', hint: '「哒 哒哒」，后两下挤在后半拍。', meters: SIMPLE, cell: 1, res: 4, level: 2, hits: [[0, 'D'], [0.5, 'D'], [0.75, 'U']] },
  { id: 'dot', name: '附点八分 + 十六分', short: '♪.♬', hint: '长—短，短音在拍子最后 1/4。最容易弹成三连音，注意别「晃」。', meters: SIMPLE, cell: 1, res: 4, level: 3, hits: [[0, 'D'], [0.75, 'U']] },
  { id: 'syn', name: '切分（八分-四分-八分）', short: '♪♩♪', hint: '「哒 哒— 哒」：中间的长音从后半拍开始，跨过第 2 拍。', meters: ['2/4', '4/4'], cell: 2, res: 2, level: 3, hits: [[0, 'D'], [0.5, 'U'], [1.5, 'U']] },
  { id: 'folk', name: '扫弦：下 下上 上下上', short: '↓ ↓↑ ↑↓↑', hint: '最常用的民谣扫弦。第 3 拍上手要空挥（不碰弦），节奏才不乱。', meters: ['4/4'], cell: 4, res: 2, level: 3,
    hits: [[0, 'D'], [1, 'D'], [1.5, 'U'], [2.5, 'U'], [3, 'D'], [3.5, 'U']] },
  { id: 'folk2', name: '扫弦：下 下上 下 下上', short: '↓ ↓↑ ↓ ↓↑', hint: '两拍一组重复，比上一个简单。', meters: ['4/4'], cell: 2, res: 2, level: 2,
    hits: [[0, 'D'], [1, 'D'], [1.5, 'U']] },
  { id: 'waltz', name: '扫弦：下 下上 下上', short: '↓ ↓↑ ↓↑', hint: '3/4 拍常用扫法。第 1 拍重一点。', meters: ['3/4'], cell: 3, res: 2, level: 2,
    hits: [[0, 'D'], [1, 'D'], [1.5, 'U'], [2, 'D'], [2.5, 'U']] },
  { id: 'c8', name: '六个八分', short: '♪♪♪ ♪♪♪', hint: '6/8 拍：一小节 6 个八分，按「1 2 3 4 5 6」数，1 和 4 重。', meters: ['6/8'], cell: 1, res: 3, level: 1, hits: [[0, 'D'], [1 / 3, 'U'], [2 / 3, 'D']] },
  { id: 'cdq', name: '附点四分', short: '♩. ♩.', hint: '6/8 拍的两大拍：只在 1 和 4 上弹。', meters: ['6/8'], cell: 1, res: 3, level: 1, hits: [[0, 'D']] },
  { id: 'cls', name: '长-短（♩ ♪）', short: '♩♪ ♩♪', hint: '「哒— 哒」，6/8 拍最典型的摇摆感：在 1、3、4、6 上弹。', meters: ['6/8'], cell: 1, res: 3, level: 2, hits: [[0, 'D'], [2 / 3, 'U']] },
];
export function patternsFor(meterId) { return PATTERNS.filter((p) => p.meters.includes(meterId)); }
export function getPattern(id) { return PATTERNS.find((p) => p.id === id) || PATTERNS[0]; }

const r6 = (x) => Math.round(x * 1e6) / 1e6;
/** 一小节里的击打位置（拍为单位，从小节开头算），按时间排序 */
export function barHits(pattern, meter) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  if (m.beats % pattern.cell !== 0) throw new Error(`节奏型 ${pattern.id} 的循环长度 ${pattern.cell} 拍放不进 ${m.id}`);
  const out = [];
  for (let c = 0; c < m.beats; c += pattern.cell) for (const [at, dir] of pattern.hits) out.push({ at: r6(c + at), dir: dir || '' });
  out.sort((a, b) => a.at - b.at);
  return out.map((h, i) => ({ ...h, i, key: posKey(h.at) }));
}
export const posKey = (at) => String(Math.round(at * 12)); // 1/12 拍精度：三连音和十六分都能整除
/** 位置的中文名，比如「第 2 拍」「第 2 拍后半」「第 3 个八分」 */
export function posLabel(at, meter) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  if (m.compound) return `第 ${Math.round(at * 3) + 1} 个八分`;
  const beat = Math.floor(at + 1e-6), f = r6(at - beat), b = beat + 1;
  if (f === 0) return `第 ${b} 拍`;
  if (Math.abs(f - 0.5) < 1e-4) return `第 ${b} 拍后半`;
  if (Math.abs(f - 0.25) < 1e-4) return `第 ${b} 拍第 2 个十六分`;
  if (Math.abs(f - 0.75) < 1e-4) return `第 ${b} 拍第 4 个十六分`;
  if (Math.abs(f - 1 / 3) < 1e-4) return `第 ${b} 拍三连第 2 个`;
  if (Math.abs(f - 2 / 3) < 1e-4) return `第 ${b} 拍三连第 3 个`;
  return `第 ${b} 拍 +${f}`;
}
const fracKey = (at) => String(Math.round((at - Math.floor(at + 1e-6)) * 12));
function fracLabel(fk, meter) {
  const f = +fk / 12;
  if (meter.compound) return `每大拍的第 ${Math.round(f * 3) + 1} 个八分`;
  return f === 0 ? '每拍的拍头' : f === 0.5 ? '每拍后半' : f === 0.25 ? '每拍第 2 个十六分' : f === 0.75 ? '每拍第 4 个十六分' : Math.abs(f - 1 / 3) < 0.01 ? '每拍三连第 2 个' : '每拍三连第 3 个';
}
/** 记谱用的格子：一小节 beats*res 格，每格 {on, dir, beatStart, count} */
export function gridCells(pattern, meter) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  const res = pattern.res, hits = barHits(pattern, m), cells = [];
  const sylls = res === 4 ? ['', 'e', '和', 'a'] : res === 3 ? ['', '2', '3'] : res === 2 ? ['', '和'] : [''];
  for (let i = 0; i < m.beats * res; i++) {
    const at = r6(i / res), h = hits.find((x) => Math.abs(x.at - at) < 1e-4);
    const beat = Math.floor(i / res);
    const count = m.compound ? String(i + 1) : i % res === 0 ? String(beat + 1) : sylls[i % res];
    cells.push({ at, on: !!h, dir: h ? h.dir : '', key: posKey(at), beatStart: i % res === 0, count });
  }
  return cells;
}
/** 一小节的期望起音（秒） */
export function expectedForBar(pattern, meter, barStart, beatSec) {
  return barHits(pattern, meter).map((h) => ({ ...h, t: barStart + h.at * beatSec }));
}
/** 一小节里相邻起音的最小间隔（拍），首尾按循环算 */
export function minGapBeats(pattern, meter) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  const at = barHits(pattern, m).map((h) => h.at);
  let g = at.length ? at[0] + m.beats - at[at.length - 1] : m.beats;
  for (let i = 1; i < at.length; i++) g = Math.min(g, at[i] - at[i - 1]);
  return g;
}

// ---------------- 判定 ----------------
export function gradeHit(errMs, tol = { green: 30, yellow: 60 }) {
  const a = Math.abs(errMs);
  return a <= tol.green ? 'green' : a <= tol.yellow ? 'yellow' : 'red';
}
const GRADE_SCORE = { green: 1, yellow: 0.6, red: 0.25 };
/**
 * 一对一匹配：每个期望点配一个最近的击打（全局按误差从小到大贪心），窗口外的不算
 * @returns {hits: Array<{errMs, onset}|null>, extras: number[] 没配上的击打}
 */
export function matchHits(onsets, expectedTimes, windowSec) {
  const pairs = [];
  for (let i = 0; i < onsets.length; i++) for (let j = 0; j < expectedTimes.length; j++) {
    const d = onsets[i] - expectedTimes[j];
    if (Math.abs(d) <= windowSec) pairs.push([Math.abs(d), i, j, d]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const uo = new Set(), ue = new Set(), hits = new Array(expectedTimes.length).fill(null);
  for (const [, i, j, d] of pairs) {
    if (uo.has(i) || ue.has(j)) continue;
    uo.add(i); ue.add(j); hits[j] = { errMs: d * 1000, onset: onsets[i], i };
  }
  return { hits, extras: onsets.filter((_, i) => !uo.has(i)), used: uo };
}

/**
 * 一次训练：一小节一小节地加进来，随时喂击打，小节结束后结算
 * 时间都是「已经扣掉设备延迟」的音频时钟秒数
 */
export class RhythmSession {
  constructor({ pattern, meter, tol = { green: 30, yellow: 60 }, maxWindowMs = 150, focus = null } = {}) {
    this.pattern = pattern; this.meter = typeof meter === 'string' ? METERS[meter] : meter;
    this.tol = tol; this.maxWindowMs = maxWindowMs; this.focus = focus;
    this.bars = []; this.onsets = []; // {t, claimed}
  }
  addBar(index, start, beatSec) {
    const exp = expectedForBar(this.pattern, this.meter, start, beatSec);
    const win = Math.min(this.maxWindowMs / 1000, 0.5 * minGapBeats(this.pattern, this.meter) * beatSec);
    const bar = { index, start, beatSec, end: start + this.meter.beats * beatSec, exp, win, closed: false, result: null, live: [] };
    this.bars.push(bar); this.bars.sort((a, b) => a.start - b.start);
    return bar;
  }
  /** 实时反馈：找最近的期望点（只看还没结算的小节） */
  hit(t) {
    const o = { t, claimed: false }; this.onsets.push(o);
    let best = null;
    for (const bar of this.bars) {
      if (bar.closed) continue;
      for (const e of bar.exp) { const d = t - e.t; if (Math.abs(d) <= bar.win && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, e, bar }; }
    }
    if (!best) { const bar = this.barAt(t); if (bar) bar.live.push({ extra: true, t }); return { extra: true, t, bar }; }
    const errMs = best.d * 1000, grade = gradeHit(errMs, this.tol);
    const r = { errMs, grade, at: best.e.at, key: best.e.key, i: best.e.i, bar: best.bar, label: posLabel(best.e.at, this.meter) };
    best.bar.live.push({ i: best.e.i, errMs, grade });
    return r;
  }
  barAt(t) { return this.bars.find((b) => t >= b.start - b.win && t < b.end - b.win) || null; }
  /** 结算一小节：期望点和还没用过的击打做一对一匹配；落在本小节范围里、没配上的算多弹 */
  closeBar(bar, isLast = false) {
    if (bar.closed) return bar.result;
    const lo = bar.start - bar.win, hi = isLast ? bar.end + bar.win : bar.end - bar.win;
    const pool = this.onsets.filter((o) => !o.claimed && o.t >= lo - bar.win && o.t < bar.end + bar.win);
    const m = matchHits(pool.map((o) => o.t), bar.exp.map((e) => e.t), bar.win);
    m.used.forEach((i) => (pool[i].claimed = true));
    const extras = pool.filter((o, i) => !m.used.has(i) && o.t >= lo && o.t < hi);
    extras.forEach((o) => (o.claimed = true));
    const notes = bar.exp.map((e, j) => {
      const h = m.hits[j];
      return { at: e.at, key: e.key, i: e.i, dir: e.dir, errMs: h ? h.errMs : null, grade: h ? gradeHit(h.errMs, this.tol) : 'miss' };
    });
    const miss = notes.filter((n) => n.grade === 'miss').length, red = notes.filter((n) => n.grade === 'red').length;
    const score = notes.reduce((s, n) => s + (GRADE_SCORE[n.grade] || 0), 0);
    const accuracy = Math.max(0, score / (notes.length + 0.5 * extras.length));
    bar.result = { index: bar.index, notes, extras: extras.map((o) => o.t), miss, red, accuracy, ok: miss === 0 && red === 0 && extras.length === 0 };
    bar.closed = true;
    return bar.result;
  }
  get results() { return this.bars.filter((b) => b.closed).map((b) => b.result); }
  summary(bpm) { return diagnose(this.results, { pattern: this.pattern, meter: this.meter, tol: this.tol, bpm, focus: this.focus }); }
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** 诊断：整体倾向、稳定性、每个位置的统计、最差位置、专项建议 */
export function diagnose(barResults, { pattern, meter, tol = { green: 30, yellow: 60 }, bpm = 0, focus = null } = {}) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  const notes = barResults.flatMap((b) => b.notes);
  const errs = notes.filter((n) => n.errMs !== null).map((n) => n.errMs);
  const extras = barResults.reduce((s, b) => s + b.extras.length, 0);
  const grades = { green: 0, yellow: 0, red: 0, miss: 0 };
  notes.forEach((n) => grades[n.grade]++);
  const score = notes.reduce((s, n) => s + (GRADE_SCORE[n.grade] || 0), 0);
  const accuracy = notes.length ? Math.max(0, score / (notes.length + 0.5 * extras)) : 0;
  const meanMs = mean(errs), stdMs = sd(errs), meanAbsMs = mean(errs.map(Math.abs));
  const tendency = errs.length < 3 ? 'unknown' : meanMs <= -12 ? 'rush' : meanMs >= 12 ? 'drag' : 'center';
  const stability = errs.length < 3 ? 'unknown' : stdMs < 15 ? 'steady' : stdMs < 30 ? 'ok' : 'shaky';
  // 每个位置
  const byKey = new Map();
  for (const n of notes) {
    if (!byKey.has(n.key)) byKey.set(n.key, { key: n.key, at: n.at, dir: n.dir, label: posLabel(n.at, m), errs: [], n: 0, miss: 0 });
    const p = byKey.get(n.key); p.n++;
    if (n.errMs === null) p.miss++; else p.errs.push(n.errMs);
  }
  const positions = [...byKey.values()].sort((a, b) => a.at - b.at).map((p) => {
    const mn = mean(p.errs), ab = mean(p.errs.map(Math.abs)), missRate = p.n ? p.miss / p.n : 0;
    return { key: p.key, at: p.at, dir: p.dir, label: p.label, n: p.n, hit: p.errs.length, miss: p.miss, meanMs: mn, stdMs: sd(p.errs), meanAbsMs: ab,
      badness: (p.errs.length ? ab : tol.yellow * 2) + missRate * 120 };
  });
  const avgBad = mean(positions.map((p) => p.badness));
  const worst = positions.length > 1
    ? positions.filter((p) => p.badness > Math.max(tol.green, avgBad * 1.25)).sort((a, b) => b.badness - a.badness).slice(0, 2)
    : positions.filter((p) => p.badness > tol.green);
  // 前半 / 后半：越弹越准还是越弹越乱
  const half = Math.floor(barResults.length / 2);
  const absOf = (bs) => mean(bs.flatMap((b) => b.notes.filter((n) => n.errMs !== null).map((n) => Math.abs(n.errMs))));
  const drift = barResults.length >= 4 ? absOf(barResults.slice(half)) - absOf(barResults.slice(0, half)) : 0;
  // 建议
  const tips = [];
  const hitRate = notes.length ? (notes.length - grades.miss) / notes.length : 0;
  if (hitRate < 0.7) tips.push('漏掉的音比较多：先把速度降下来，每个音都弹到，再追求准。');
  if (tendency === 'rush') tips.push(`整体抢拍（平均早 ${Math.round(-meanMs)} ms）：心里数着拍子「等」一下，弹之前先吸气。`);
  if (tendency === 'drag') tips.push(`整体拖拍（平均晚 ${Math.round(meanMs)} ms）：手腕提前准备好，拨片离弦近一点。`);
  if (stability === 'shaky') tips.push(`忽早忽晚（±${Math.round(stdMs)} ms）：右手保持匀速摆动，休止的地方也空挥。`);
  if (extras > notes.length * 0.15) tips.push(`多弹了 ${extras} 下：休止的地方手可以空挥，但别碰弦。`);
  if (drift > 12) tips.push('后半段比前半段乱：注意力不集中或手累了，可以短一点、多练几次。');
  if (worst.length) tips.push(`最差的位置：${worst.map((p) => p.label + (p.miss ? `（漏 ${p.miss}）` : `（${p.meanMs < 0 ? '早' : '晚'} ${Math.round(Math.abs(p.meanMs))} ms）`)).join('、')}。`);
  if (!tips.length) tips.push('很稳！可以加快速度，或者换一个更难的节奏型。');
  // 同一种拍内位置（比如每一拍的后半）全都差 → 当成一个问题：「每拍后半」
  const thr = Math.max(tol.green, avgBad * 1.25), bad = positions.filter((p) => p.badness > thr);
  const groups = new Map();
  for (const p of positions) { const f = fracKey(p.at); if (!groups.has(f)) groups.set(f, []); groups.get(f).push(p); }
  const focusPos = [], labels = [];
  for (const [f, ps] of groups) {
    const b = ps.filter((p) => bad.includes(p));
    if (!b.length) continue;
    if (ps.length >= 2 && b.length === ps.length) { focusPos.push(...ps); labels.push(fracLabel(f, m)); }
    else { focusPos.push(...b); labels.push(...b.map((p) => p.label)); }
  }
  if (labels.length && worst.length && groups.size > 1) {
    const grouped = labels.filter((l) => l.startsWith('每'));
    if (grouped.length) tips.splice(tips.length - 1, 1, `问题集中在${grouped.join('、')}${labels.length > grouped.length ? '，以及 ' + labels.filter((l) => !l.startsWith('每')).join('、') : ''}：其他位置都还好。`);
  }
  const drill = worst.length && (accuracy < 0.9 || worst[0].badness > tol.green * 1.5)
    ? { bpm: Math.max(40, Math.round((bpm || 60) * 0.85)), focus: focusPos.map((p) => p.key), labels } : null;
  const focusStats = focus && focus.length ? positions.filter((p) => focus.includes(p.key)) : null;
  return { bars: barResults.length, expected: notes.length, hit: notes.length - grades.miss, miss: grades.miss, extras, hitRate, grades, accuracy,
    meanMs, stdMs, meanAbsMs, tendency, stability, positions, worst, drift, tips, drill, focusStats, barAcc: barResults.map((b) => b.accuracy), okBars: barResults.filter((b) => b.ok).length };
}

// ---------------- 速度阶梯 ----------------
/** 连续 needUp 小节达标 → +step；连续 needDown 小节没达标 → −step（不低于起始速度 − 3 档、不低于 min） */
export class TempoLadder {
  constructor({ bpm, step = 4, needUp = 2, needDown = 2, min = 40, max = 220 } = {}) {
    Object.assign(this, { bpm, start: bpm, step, needUp, needDown, min, max, okStreak: 0, failStreak: 0, ups: 0, downs: 0, top: bpm, log: [] });
  }
  update(ok) {
    let change = 0;
    if (ok) { this.okStreak++; this.failStreak = 0; if (this.okStreak >= this.needUp && this.bpm + this.step <= this.max) { this.bpm += this.step; this.okStreak = 0; this.ups++; change = 1; } }
    else { this.failStreak++; this.okStreak = 0; const floor = Math.max(this.min, this.start - 3 * this.step); if (this.failStreak >= this.needDown && this.bpm - this.step >= floor) { this.bpm -= this.step; this.failStreak = 0; this.downs++; change = -1; } }
    this.top = Math.max(this.top, this.bpm);
    if (change) this.log.push(this.bpm);
    return change;
  }
}

// ---------------- 节拍器间歇 ----------------
/**
 * 这一下要不要响
 * @param info {bar, beat, sub}  bar 从 0 起，countIn=true 的小节总是响
 * @param cfg {mode:'all'|'backbeat'|'one', muteX, muteY, subClicks}
 */
export function clickOn(info, cfg, meter, countIn = false) {
  const m = typeof meter === 'string' ? METERS[meter] : meter;
  if (countIn) return info.sub === 0 || (m.compound && cfg.subClicks !== false);
  if (cfg.muteY > 0 && cfg.muteX > 0 && info.bar % cfg.muteY >= cfg.muteY - cfg.muteX) return false;
  if (info.sub !== 0) return cfg.mode === 'all' && cfg.subClicks !== false;
  if (cfg.mode === 'one') return info.beat === 0;
  if (cfg.mode === 'backbeat') return m.beats === 4 ? info.beat % 2 === 1 : m.beats === 3 ? info.beat > 0 : info.beat === 1;
  return true;
}

// ---------------- FFT（基 2，原地） ----------------
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// ---------------- 回环延迟测量 ----------------
/** 测试音：Hann 窗线性扫频（1.5→6 kHz，10 ms）。返回同相 c 和正交 s 两条（求包络用） */
export function makeChirp(sr, ms = 10, f0 = 1500, f1 = 6000) {
  const n = Math.round((ms / 1000) * sr), c = new Float32Array(n), s = new Float32Array(n), T = n / sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr, ph = 2 * Math.PI * (f0 * t + ((f1 - f0) / (2 * T)) * t * t), w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    c[i] = w * Math.cos(ph); s[i] = w * Math.sin(ph);
  }
  return { c, s, n };
}
/** 随机间隔（0.5–0.8 秒），间隔不规律，回声和人为跟拍都对不上，只有真实延迟能在所有「啾」上同时对齐 */
export function calibSchedule(n = 8, seed = 1) {
  let s = seed >>> 0 || 1; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [0];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + 0.5 + 0.3 * rnd());
  return out;
}
/**
 * 估计回环延迟（喇叭输出 + 麦克风输入）
 * @param sig 录到的信号；sigStart = sig[0] 的音频时钟时间；clickTimes = 每个「啾」排程的时间
 * @returns {ok, latencyMs, spreadMs, n, total, lagsMs[], snrDb, confidence} 或 {ok:false, reason, n}
 */
export function estimateLoopback(sig0, sr, sigStart, clickTimes, opts = {}) {
  const { minLagMs = -10, maxLagMs = 450, minSnr = 8, minClicks = 4, minNcc = 0.35 } = opts;
  // 先高通（1.2 kHz）：琴声、人声、空调声大多在低频，不影响和测试音的相关
  const hp = highpass(1200, sr), sig = new Float32Array(sig0.length); for (let i = 0; i < sig0.length; i++) sig[i] = hp(sig0[i]);
  const tpl = opts.template || makeChirp(sr), M = tpl.n;
  const nLag = Math.round(((maxLagMs - minLagMs) / 1000) * sr), L = nLag + M;
  let N = 1; while (N < L + M) N <<= 1;
  const Tr = new Float64Array(N), Ti = new Float64Array(N), Sr = new Float64Array(N), Si = new Float64Array(N);
  Tr.set(tpl.c); Sr.set(tpl.s); fft(Tr, Ti); fft(Sr, Si);
  let Et = 0; for (let i = 0; i < M; i++) Et += tpl.c[i] * tpl.c[i];
  const envs = [], meds = [], segs = [];
  for (const tc of clickTimes) {
    const s0 = Math.round((tc + minLagMs / 1000 - sigStart) * sr);
    if (s0 < 0 || s0 + L > sig.length) { envs.push(null); meds.push(0); segs.push(-1); continue; }
    segs.push(s0);
    const xr = new Float64Array(N), xi = new Float64Array(N);
    for (let i = 0; i < L; i++) xr[i] = sig[s0 + i];
    fft(xr, xi);
    // Z = X·conj(Tc) + i·X·conj(Ts)  →  z 的实部 = 与同相模板的相关，虚部 = 与正交模板的相关
    const zr = new Float64Array(N), zi = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const ar = xr[k] * Tr[k] + xi[k] * Ti[k], ai = xi[k] * Tr[k] - xr[k] * Ti[k];
      const br = xr[k] * Sr[k] + xi[k] * Si[k], bi = xi[k] * Sr[k] - xr[k] * Si[k];
      zr[k] = ar - bi; zi[k] = ai + br;
    }
    fft(zr, zi, true);
    const env = new Float32Array(nLag);
    for (let i = 0; i < nLag; i++) env[i] = Math.hypot(zr[i], zi[i]);
    const md = median(Array.from(env.filter((_, i) => i % 7 === 0))) || 1e-12;
    for (let i = 0; i < nLag; i++) env[i] /= md;
    envs.push(env); meds.push(md);
  }
  // 归一化相关系数（0–1）：真的测试音波形对得上 ≈ 1；拨弦、拍手这类宽带噪声对不上
  const nccAt = (ci, p) => { const s0 = segs[ci]; let ex = 0; for (let i = 0; i < M; i++) { const v = sig[s0 + p + i] || 0; ex += v * v; } return (envs[ci][p] * meds[ci]) / Math.sqrt(Et * ex + 1e-20); };
  const valid = envs.filter(Boolean);
  if (valid.length < minClicks) return { ok: false, reason: 'nodata', n: 0, total: clickTimes.length };
  // 所有「啾」叠加：真实延迟处同时对齐
  const S = new Float32Array(nLag);
  for (const e of valid) for (let i = 0; i < nLag; i++) S[i] += Math.min(e[i], 200);
  let nStar = 0; for (let i = 1; i < nLag; i++) if (S[i] > S[nStar]) nStar = i;
  const R = Math.round(0.010 * sr), lags = [], snrs = [];
  const nccs = [];
  const lagsMs = envs.map((e, ci) => {
    if (!e) return null;
    let p = -1, pv = 0;
    for (let i = Math.max(1, nStar - R); i < Math.min(nLag - 1, nStar + R); i++) if (e[i] > pv) { pv = e[i]; p = i; }
    if (p < 0 || pv < minSnr) return null;
    const q = nccAt(ci, p); nccs.push(q);
    if (q < minNcc) return null;
    const a = e[p - 1], b = e[p], c = e[p + 1], den = a - 2 * b + c, dlt = den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const ms = minLagMs + ((p + dlt) / sr) * 1000;
    lags.push(ms); snrs.push(pv);
    return ms;
  });
  if (lags.length < minClicks) return { ok: false, reason: 'weak', ncc: nccs.length ? median(nccs) : 0, n: lags.length, total: clickTimes.length, snrDb: snrs.length ? 20 * Math.log10(median(snrs)) : 0, lagsMs };
  const med = median(lags), mad = median(lags.map((x) => Math.abs(x - med))), spreadMs = 1.4826 * mad;
  const confidence = lags.length >= Math.ceil(clickTimes.length * 0.75) && spreadMs <= 2 ? 'high' : spreadMs <= 5 && lags.length >= minClicks ? 'medium' : 'low';
  return { ok: true, latencyMs: med, spreadMs, n: lags.length, total: clickTimes.length, lagsMs, snrDb: 20 * Math.log10(median(snrs)), confidence,
    rangeMs: [Math.min(...lags), Math.max(...lags)], ncc: median(nccs) };
}

// ---------------- 外部节拍器：拟合拍子网格 ----------------
/**
 * 一串起音 → 规律网格 t = phase + k·period
 * bpm 给定时只拟合相位；否则先用间隔中位数估速度，再最小二乘细化。离网格太远的点当作离群点剔除
 */
export function fitGrid(times, { bpm = null, minBpm = 30, maxBpm = 260 } = {}) {
  const ts = times.slice().sort((a, b) => a - b);
  if (ts.length < 3) return null;
  let P;
  if (bpm) P = 60 / bpm;
  else {
    const iois = [];
    for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; if (d >= 60 / maxBpm * 0.9 && d <= 60 / minBpm * 1.1) iois.push(d); }
    if (iois.length < 2) return null;
    P = median(iois);
  }
  // 初始相位：圆周平均（对离群点不敏感）
  let cr = 0, ci = 0;
  for (const t of ts) { cr += Math.cos((2 * Math.PI * t) / P); ci += Math.sin((2 * Math.PI * t) / P); }
  let phase = (Math.atan2(ci, cr) / (2 * Math.PI)) * P;
  const tolOf = (p) => Math.min(0.04, 0.12 * p);
  let inl = ts;
  for (let it = 0; it < 4; it++) {
    const ks = ts.map((t) => Math.round((t - phase) / P));
    const res = ts.map((t, i) => t - (phase + ks[i] * P));
    const idx = ts.map((_, i) => i).filter((i) => Math.abs(res[i]) <= tolOf(P));
    if (idx.length < 3) return null;
    inl = idx.map((i) => ts[i]);
    const kk = idx.map((i) => ks[i]);
    if (bpm) phase += median(idx.map((i) => res[i]));
    else {
      const mx = mean(kk), my = mean(inl);
      let num = 0, den = 0;
      for (let j = 0; j < kk.length; j++) { num += (kk[j] - mx) * (inl[j] - my); den += (kk[j] - mx) ** 2; }
      if (den > 0) P = num / den;
      phase = my - P * mx;
    }
  }
  const ks = inl.map((t) => Math.round((t - phase) / P));
  const resid = inl.map((t, i) => (t - (phase + ks[i] * P)) * 1000);
  const rms = Math.sqrt(mean(resid.map((r) => r * r)));
  return { period: P, bpm: 60 / P, phase, n: ts.length, inliers: inl.length, outliers: ts.length - inl.length,
    jitterMs: rms, maxDevMs: Math.max(...resid.map(Math.abs)), residualsMs: resid, lastK: Math.max(...ks), lastT: inl[inl.length - 1] };
}
/** 锁相跟踪：每听到一下节拍器，按残差微调相位和周期 */
export class GridTracker {
  constructor(period, anchorT, anchorK = 0, { alpha = 0.3, beta = 0.03 } = {}) { Object.assign(this, { period, anchorT, anchorK, alpha, beta }); }
  tick(k) { return this.anchorT + (k - this.anchorK) * this.period; }
  nearest(t) { const k = this.anchorK + Math.round((t - this.anchorT) / this.period); return { k, resid: t - this.tick(k) }; }
  nextK(t) { return this.anchorK + Math.ceil((t - this.anchorT) / this.period); }
  update(t, k) {
    const r = t - this.tick(k);
    const nt = this.tick(k) + this.alpha * r, np = this.period + this.beta * r;
    this.anchorT = nt; this.anchorK = k; this.period = np;
    return r;
  }
  get bpm() { return 60 / this.period; }
}

function highpass(fc, sr) {
  const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / (2 * Math.SQRT1_2), cs = Math.cos(w), a0 = 1 + al;
  const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = b0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
// RBJ 二阶低通
function lowpass(fc, sr) {
  const w = (2 * Math.PI * fc) / sr, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), cs = Math.cos(w), a0 = 1 + al;
  const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, b2 = b0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
/**
 * 外部节拍器跟踪器：喂入麦克风数据块，返回事件
 *   {type:'cand', t}            还没锁定时听到的起音
 *   {type:'lock', bpm, jitterMs, n}
 *   {type:'click', t, k, residMs}  节拍器的一下（已锁相）
 *   {type:'hit', t, near}        你的拨弦
 * 区分方法：① 规律——节拍器的声音落在锁定的网格上；② 音色——拨弦在 1 kHz 以下的能量突然上升很多，
 *   节拍器的「嗒」主要是高频。锁定阶段记下节拍器的低频上升量，之后落在网格上、低频上升不超过它 2.5 倍的才算节拍器
 */
export class ExternalClickTracker {
  constructor(sr, { bpm = null, gate = 0.004, lockN = 6, lockJitterMs = 12, lowRatio = 2.5, minBpm = 30, maxBpm = 240 } = {}) {
    Object.assign(this, { sr, bpm, lockN, lockJitterMs, lowRatio, minBpm, maxBpm });
    this.det = new OnsetDetector(sr, { minIntervalMs: 35, rmsGate: gate, thresholdMult: 1.6, delta: 0.04 });
    this.N = 1 << 15; this.raw = new Float32Array(this.N); this.low = new Float32Array(this.N); this.total = 0; this.t0 = null;
    this.lp = lowpass(1000, sr);
    this.pre = Math.round(0.025 * sr); this.post = Math.round(0.025 * sr); this.gap = Math.round(0.001 * sr);
    this.pending = []; this.cands = []; this.grid = null; this.state = 'listen'; this.clickResid = []; this.clickLow = 0; this.lowThr = 0; this.clicks = 0;
  }
  setGate(g) { this.det.gate = g; }
  process(chunk, startTime) {
    if (this.t0 === null) this.t0 = startTime - this.total / this.sr;
    else if (Math.abs(this.t0 + this.total / this.sr - startTime) > 0.05) this.t0 = startTime - this.total / this.sr;
    const N = this.N;
    for (let i = 0; i < chunk.length; i++) { const p = this.total % N; this.raw[p] = chunk[i]; this.low[p] = this.lp(chunk[i]); this.total++; }
    for (const t of this.det.process(chunk, startTime)) this.pending.push(t);
    const ev = [];
    while (this.pending.length && this._idx(this.pending[0]) + this.post <= this.total) {
      const t = this.pending.shift();
      ev.push(...this._classify(t, this._feat(t)));
    }
    return ev;
  }
  _idx(t) { return Math.round((t - this.t0) * this.sr); }
  _feat(t) {
    const i = this._idx(t), N = this.N, oldest = this.total - N;
    let la = 0, ra = 0, lb = 0, nb = 0;
    for (let j = i; j < i + this.post; j++) { if (j < oldest || j >= this.total) continue; const l = this.low[j % N], r = this.raw[j % N]; la += l * l; ra += r * r; }
    for (let j = i - this.gap - this.pre; j < i - this.gap; j++) { if (j < Math.max(0, oldest)) continue; const l = this.low[j % N]; lb += l * l; nb++; }
    la /= this.post; ra /= this.post; lb = nb ? lb / nb : 0;
    return { lowRise: Math.sqrt(Math.max(0, la - lb)), level: Math.sqrt(ra), bright: Math.sqrt(Math.max(0, ra - la) / (ra + 1e-12)) };
  }
  _classify(t, f) {
    if (this.state === 'listen') {
      this.cands.push({ t, ...f }); if (this.cands.length > 10) this.cands.shift();
      const out = [{ type: 'cand', t, ...f }];
      if (this.cands.length >= this.lockN) {
        const last = this.cands.slice(-8), fit = fitGrid(last.map((c) => c.t), { bpm: this.bpm, minBpm: this.minBpm, maxBpm: this.maxBpm });
        if (fit && fit.inliers >= this.lockN && fit.jitterMs <= this.lockJitterMs && fit.bpm >= this.minBpm && fit.bpm <= this.maxBpm) {
          const inl = last.filter((c) => { const k = Math.round((c.t - fit.phase) / fit.period); return Math.abs(c.t - fit.phase - k * fit.period) <= Math.min(0.04, 0.12 * fit.period); });
          this.clickLow = median(inl.map((c) => c.lowRise));
          this.lowThr = Math.max(this.lowRatio * this.clickLow, this.det.gate * 0.5);
          this.grid = new GridTracker(fit.period, fit.phase + fit.lastK * fit.period, fit.lastK);
          this.state = 'locked'; this.fit = fit; this.clickResid = fit.residualsMs.slice(); this.clicks = inl.length;
          out.push({ type: 'lock', bpm: fit.bpm, jitterMs: fit.jitterMs, n: fit.inliers, k: fit.lastK, t: fit.lastT });
        }
      }
      return out;
    }
    const { k, resid } = this.grid.nearest(t), near = Math.abs(resid) <= Math.min(0.035, 0.15 * this.grid.period);
    if (near && f.lowRise <= this.lowThr) {
      this.grid.update(t, k); this.clicks++;
      this.clickResid.push(resid * 1000); if (this.clickResid.length > 64) this.clickResid.shift();
      return [{ type: 'click', t, k, residMs: resid * 1000, ...f }];
    }
    return [{ type: 'hit', t, near, ...f }];
  }
  get jitterMs() { const r = this.clickResid; return r.length ? Math.sqrt(mean(r.map((x) => x * x))) : 0; }
}
