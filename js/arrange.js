// arrange.js — 编曲入门：旋律 / 和弦 / 低音 / 鼓 分层试听，5 个小课
import { $, $$, esc, engine, releaseMicForPlayback } from './core.js';
import { ARRANGE, ARRANGE_SONGS, CHORDS, KEYS, DEGREES, PATTERNS, PC_NAME, scaleOf, slotsOf, fitOf, fitClass, songFit,
  autoHarmonize, minorColor, buildSchedule, chordChart, degreeOf, isChordTone, bassMidi, pickupOf, pickupNotes } from './harmony.js';
import { BASS_TONES, DEFAULT_BASS } from './bass.js';
import { drawBoard, markShape } from './fretboard.js';

const LS = 'guitar-practice:arrange';
const saved = (() => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } })();
const st = {
  songId: saved.songId && ARRANGE[saved.songId] ? saved.songId : 'twinkle',
  step: saved.step || 1,
  bySong: saved.bySong || {},
  layers: { melody: true, chords: true, bass: false, drums: false, drone: false },
  mood: 'orig', // 只在第 5 课用，不保存
  focus: null,  // 第 2 课：正在看的和弦
  bassTone: BASS_TONES[saved.bassTone] ? saved.bassTone : DEFAULT_BASS,
};
const save = () => localStorage.setItem(LS, JSON.stringify({ songId: st.songId, step: st.step, bySong: st.bySong, bassTone: st.bassTone }));
const song = () => ARRANGE_SONGS.find((s) => s.id === st.songId);
const A = () => ARRANGE[st.songId];
function arr() {
  if (!st.bySong[st.songId]) st.bySong[st.songId] = { chords: A().chords.slice(), pattern: 'pad', bpm: song().bpm };
  return st.bySong[st.songId];
}
const playChords = () => (st.mood === 'minor' ? minorColor(song(), arr().chords) : arr().chords);

// ---------- 课程 ----------
const LESSONS = [
  { t: '旋律和伴奏', s: '旋律',
    p: '旋律是你会哼的那条线；伴奏在下面托着它。点下面的按钮，一层一层加上去，听听每一层带来了什么。' },
  { t: '和弦是怎么来的', s: '和弦',
    p: '大调音阶有 7 个音。从某个音开始<b>隔一个取一个</b>，取 3 个，就叠成一个三和弦（1-3-5）。点一个和弦看看、听听；谱上<b>实心</b>的旋律音就是这一格和弦里的音（和弦内音）。' },
  { t: '给旋律配和弦', s: '配和弦',
    p: '点谱上的和弦块换一个和弦（I → IV → V → vi → V7），会马上弹这一格给你听。颜色告诉你旋律有多少落在和弦里：<b class="c-hi">绿</b> 合适，<b class="c-mid">黄</b> 还行，<b class="c-lo">红</b> 打架。' },
  { t: '伴奏型', s: '伴奏型',
    p: '和弦不变，只换右手的弹法，整首歌的感觉就不一样了。边播放边切换试试。低音也跟着变：扫弦、低音+和弦时，低音弹「根音–五音」；3/4 拍的歌，「低音+和弦」就是华尔兹的「嘣-恰-恰」。' },
  { t: '速度与情绪', s: '情绪',
    p: '同一条旋律：快一点、扫弦 → 欢快；慢一点、分解和弦，再把一些 I 换成 vi（关系小调和弦，和 I 有两个共同音）→ 抒情、带点忧伤。' },
];
const LAYER_NAMES = { melody: '旋律', chords: '和弦', bass: '低音', drums: '鼓', drone: '持续低音' };

function renderSteps() {
  $('#ar-steps').innerHTML = LESSONS.map((l, i) => `<button role="tab" data-i="${i + 1}" class="${st.step === i + 1 ? 'on' : ''}"><b>${i + 1}</b>${l.s}</button>`).join('');
  $$('#ar-steps button').forEach((b) => (b.onclick = () => { setStep(+b.dataset.i); }));
}
function setStep(n) {
  st.step = n; st.mood = 'orig'; st.focus = null;
  if (n !== 1) st.layers.drone = false;
  save(); renderSteps(); renderLesson(); renderGrid(); renderLayers();
}

function renderLesson() {
  const L = LESSONS[st.step - 1], K = KEYS[A().key], c = $('#ar-l-ctl');
  $('#ar-l-n').textContent = st.step; $('#ar-l-title').textContent = L.t; $('#ar-l-text').innerHTML = L.p;
  if (st.step === 1) {
    const opts = [
      ['只有旋律', { melody: true, chords: false, bass: false, drums: false, drone: false }],
      ['＋ 一个持续低音', { melody: true, chords: false, bass: false, drums: false, drone: true }],
      ['＋ 和弦', { melody: true, chords: true, bass: false, drums: false, drone: false }],
      ['＋ 低音和鼓', { melody: true, chords: true, bass: true, drums: true, drone: false }],
    ];
    c.innerHTML = `<div class="try">${opts.map(([n], i) => `<button class="btn try-b" data-i="${i}"><span>${i + 1}</span>${n}</button>`).join('')}</div>
      <p class="hint">持续低音：整首只弹一个主音（${PC_NAME[K.tonic]}），旋律有的地方和它很融洽，有的地方有点“紧”——这就是为什么需要换和弦。</p>`;
    $$('.try-b', c).forEach((b) => (b.onclick = () => {
      Object.assign(st.layers, opts[+b.dataset.i][1]);
      $$('.try-b', c).forEach((x) => x.classList.toggle('on', x === b));
      renderLayers(); play(0);
    }));
  } else if (st.step === 2) {
    const sc = scaleOf(A().key);
    c.innerHTML = `<div class="scale" id="ar-scale">${[...sc, ...sc.slice(0, 6)].map((p, i) => `<span data-i="${i}"><b>${PC_NAME[p]}</b><small>${(i % 7) + 1}</small></span>`).join('')}</div>
      <div class="chord-pick">${DEGREES.map((d) => `<button class="btn" data-c="${K.chords[d]}"><b>${K.chords[d]}</b><small>${d}</small></button>`).join('')}</div>
      <div class="chord-view"><svg id="ar-shape" class="fretboard"></svg><div id="ar-chord-info" class="hint"></div></div>`;
    drawBoard($('#ar-shape'));
    $$('.chord-pick button', c).forEach((b) => (b.onclick = () => focusChord(b.dataset.c, true)));
    focusChord(st.focus || K.chords.I, false);
  } else if (st.step === 3) {
    c.innerHTML = `<div class="row wrap"><button class="btn" id="ar-all-i">全部用 I（从零开始）</button><button class="btn primary" id="ar-auto">✨ 推荐（自动配）</button><button class="btn ghost" id="ar-ref">参考答案</button></div>
      <p class="hint" id="ar-auto-note">先「全部用 I」听一遍，找出红色、听着别扭的格子，再换成 IV 或 V。</p>`;
    $('#ar-all-i').onclick = () => { arr().chords = arr().chords.map(() => K.chords.I); afterEdit(); play(0); };
    $('#ar-auto').onclick = () => { arr().chords = autoHarmonize(song()); afterEdit(); play(0); $('#ar-auto-note').textContent = '自动配和弦：每格挑旋律音最贴合的和弦，换和弦不要太频繁，开头和结尾用 I，结尾前用 V 或 V7（终止式）。'; };
    $('#ar-ref').onclick = () => { arr().chords = A().chords.slice(); afterEdit(); play(0); };
  } else if (st.step === 4) {
    c.innerHTML = `<div class="seg pat" id="ar-pat">${Object.entries(PATTERNS).map(([k, p]) => `<button data-v="${k}" class="${arr().pattern === k ? 'on' : ''}">${p.name}</button>`).join('')}</div><p class="hint" id="ar-pat-d">${PATTERNS[arr().pattern].desc}</p>`;
    $$('#ar-pat button').forEach((b) => (b.onclick = () => {
      arr().pattern = b.dataset.v; save();
      $$('#ar-pat button').forEach((x) => x.classList.toggle('on', x === b)); $('#ar-pat-d').textContent = PATTERNS[b.dataset.v].desc;
      st.layers.chords = true; renderLayers(); restartIfPlaying(true);
    }));
  } else if (st.step === 5) {
    const base = song().bpm;
    const moods = [
      ['😄 欢快', { pattern: 'strum', bpm: Math.round(base * 1.25), mood: 'orig' }],
      ['🙂 原样', { pattern: 'pad', bpm: base, mood: 'orig' }],
      ['🌙 抒情', { pattern: 'arp', bpm: Math.round(base * 0.72), mood: 'minor' }],
    ];
    c.innerHTML = `<div class="try">${moods.map(([n], i) => `<button class="btn try-b" data-i="${i}">${n}</button>`).join('')}</div><p class="hint" id="ar-mood-d"></p>`;
    $$('.try-b', c).forEach((b) => (b.onclick = () => {
      const m = moods[+b.dataset.i][1];
      arr().pattern = m.pattern; arr().bpm = m.bpm; st.mood = m.mood; save();
      $$('.try-b', c).forEach((x) => x.classList.toggle('on', x === b));
      const changed = playChords().filter((x, i) => x !== arr().chords[i]).length;
      $('#ar-mood-d').textContent = `${PATTERNS[m.pattern].name} · ♩=${m.bpm}` + (m.mood === 'minor' ? ` · ${changed} 处 ${KEYS[A().key].chords.I} 换成了 ${KEYS[A().key].chords.vi}（谱上虚线框）` : '');
      Object.assign(st.layers, { melody: true, chords: true, bass: true, drums: m.pattern === 'strum', drone: false });
      syncTempo(); renderLayers(); renderGrid(); play(0);
    }));
  }
}
function focusChord(ch, sound) {
  st.focus = ch;
  const K = KEYS[A().key], sc = scaleOf(A().key), tones = CHORDS[ch].tones;
  // 在音阶条上标出 1-3-5（-7）：从根音所在的位置开始隔一个取一个
  const r = sc.indexOf(CHORDS[ch].root), idx = tones.map((_, k) => r + 2 * k);
  $$('#ar-scale span').forEach((s) => { const i = +s.dataset.i; s.className = idx.includes(i) ? (i === r ? 'root' : 'on') : ''; });
  $$('.chord-pick button').forEach((b) => b.classList.toggle('on', b.dataset.c === ch));
  markShape($('#ar-shape'), CHORDS[ch].shape);
  const names = tones.map((t) => PC_NAME[t]).join(' – ');
  $('#ar-chord-info').innerHTML = `<b>${ch}</b>（${degreeOf(A().key, ch)} 级${CHORDS[ch].quality}和弦）= ${names}` +
    (CHORDS[ch].tones.length > 3 ? '：在三和弦上再叠一个三度，多了一点「想回家」的紧张感。' : CHORDS[ch].quality === '小三' ? '：小三和弦，听起来偏暗、柔和。' : '：大三和弦，听起来明亮。') +
    `<br>按法 ${CHORDS[ch].shape}（6 弦 → 1 弦，× 不弹）`;
  renderGrid();
  if (sound) { engine.unlock(); const t = engine.ensureContext().currentTime + 0.05; CHORDS[ch].voicing.forEach((m, k) => { engine.pluck(m, t + k * 0.12, 1.6, 0.3); engine.pluck(m, t + 0.9 + k * 0.012, 1.4, 0.25); }); }
}

// ---------- 谱面 ----------
function renderGrid() {
  const s = song(), a = A(), slots = slotsOf(s), chords = playChords(), base = arr().chords;
  const per = s.beats / a.slot, bars = slots.length / per, pk = pickupOf(s);
  const mids = slots.flatMap((x) => x.notes.map((n) => n.note.midi)), lo = Math.min(...mids), hi = Math.max(...mids);
  const focus = null; // 谱面始终显示当前编配的和弦
  let h = '';
  for (let b = 0; b < bars; b++) {
    const bs = pk + b * s.beats;
    h += `<div class="ar-bar" data-b="${b}"><div class="ar-chords">`;
    for (let k = 0; k < per; k++) {
      const i = b * per + k, ch = focus || chords[i], f = fitOf(slots[i], ch);
      h += `<button class="cblk ${fitClass(f)}${chords[i] !== base[i] && !focus ? ' sub' : ''}" data-i="${i}" title="贴合 ${Math.round(f * 100)}%"><b>${ch}</b><small>${degreeOf(a.key, ch)}</small></button>`;
    }
    h += `</div><div class="ar-mel">`;
    const seen = new Set();
    for (let k = 0; k < per; k++) {
      const i = b * per + k, ch = focus || chords[i];
      for (const { note } of slots[i].notes) {
        if (seen.has(note)) continue; seen.add(note);
        const left = ((note.start - bs) / s.beats) * 100, w = (Math.min(note.beats, bs + s.beats - note.start) / s.beats) * 100;
        const top = hi === lo ? 40 : ((hi - note.midi) / (hi - lo)) * 70;
        h += `<span class="mn ${isChordTone(note.midi, ch) ? 'ct' : 'nct'}" style="left:${left}%;width:calc(${w}% - 3px);top:${top}%">${PC_NAME[note.midi % 12]}</span>`;
      }
    }
    h += `</div><i class="ar-ph"></i></div>`;
  }
  const pn = pickupNotes(s);
  $('#ar-pickup').hidden = !pn.length;
  $('#ar-pickup').innerHTML = pn.length ? `<b>弱起 ${pk} 拍</b>${pn.map((n) => `<span class="mn nct">${PC_NAME[n.midi % 12]}</span>`).join('')}<small>不完整的「第 0 小节」，不配和弦；和弦从下一小节第 1 拍开始</small>` : '';
  $('#ar-grid').innerHTML = h;
  $('#ar-grid').style.setProperty('--per', per);
  $('#ar-fit').textContent = `整体贴合 ${Math.round(songFit(s, focus ? chords.map(() => focus) : chords) * 100)}%`;
  $$('#ar-grid .cblk').forEach((btn) => (btn.onclick = () => onChordTap(+btn.dataset.i)));
}
function onChordTap(i) {
  const K = KEYS[A().key];
  if (st.step === 2) { focusChord(arr().chords[i], true); return; }
  const order = DEGREES.map((d) => K.chords[d]);
  const cur = arr().chords[i], next = order[(order.indexOf(cur) + 1) % order.length];
  arr().chords[i] = next; st.mood = 'orig';
  afterEdit(false);
  previewSlot(i);
}
function afterEdit(rerenderLesson = false) { save(); renderGrid(); if (rerenderLesson) renderLesson(); restartIfPlaying(false); }

// ---------- 图层开关 ----------
function renderLayers() {
  const keys = ['melody', 'chords', 'bass', 'drums'].concat(st.layers.drone ? ['drone'] : []);
  $('#ar-layers').innerHTML = keys.map((k) => `<button class="chip ${st.layers[k] ? 'on' : ''}" data-k="${k}">${LAYER_NAMES[k]}</button>`).join('');
  $$('#ar-layers .chip').forEach((b) => (b.onclick = () => {
    st.layers[b.dataset.k] = !st.layers[b.dataset.k];
    b.classList.toggle('on', st.layers[b.dataset.k]);
    restartIfPlaying(true);
  }));
}

// ---------- 播放 ----------
const P = { on: false, nodes: [], t0: 0, total: 0, timer: 0 };
let noiseBuf = null;
function drum(kind, t, vol) {
  const ctx = engine.ctx, g = ctx.createGain(); g.connect(engine.master);
  if (kind === 'kick') {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); o.start(t); o.stop(t + 0.3); return o;
  }
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(); n.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 7000;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.08); return n;
}
function scheduleEvents(events, t0, from = 0, to = Infinity) {
  for (const e of events) {
    if (e.t < from - 1e-6 || e.t >= to) continue;
    const t = t0 + e.t, vol = e.vol * 0.7; // 多层叠加时留出余量，避免削波
    if (e.kind === 'kick' || e.kind === 'hat') P.nodes.push(drum(e.kind, t, vol));
    else if (e.kind === 'bass') P.nodes.push(engine.bass(e.midi, t, e.dur, vol, st.bassTone));
    else if (e.kind === 'drone') P.nodes.push(engine.bass(e.midi, t, e.dur, vol * 0.9, 'warm'));
    else P.nodes.push(engine.pluck(e.midi, t, e.dur, vol));
  }
}
function schedule() { return buildSchedule(song(), { chords: playChords(), bpm: arr().bpm, pattern: arr().pattern, layers: st.layers }); }
async function play(from = 0) {
  stop();
  await engine.unlock();
  const sc = schedule();
  P.on = true; P.total = sc.total; P.spb = sc.spb;
  P.t0 = engine.ctx.currentTime + 0.12 - from;
  scheduleEvents(sc.events, P.t0, from);
  $('#ar-play').textContent = '⏸ 停止';
  window.__arSchedule = { n: sc.events.length, total: sc.total, kinds: sc.events.reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {}) };
}
function stop() {
  P.nodes.forEach((n) => { try { n.stop(); } catch {} }); P.nodes = [];
  P.on = false; $('#ar-play').textContent = '▶ 播放';
  $$('#ar-grid .ar-ph').forEach((x) => x.classList.remove('on')); $$('#ar-grid .cblk.playing').forEach((x) => x.classList.remove('playing'));
}
function restartIfPlaying(keepPos) {
  if (!P.on) return;
  const pos = Math.max(0, engine.ctx.currentTime - P.t0);
  // 从当前小节开头重新排程，层的开关「马上」听得到
  const barSec = song().beats * P.spb, pkSec = pickupOf(song()) * P.spb;
  const from = keepPos && pos > pkSec ? pkSec + Math.floor((pos - pkSec) / barSec) * barSec : 0;
  play(Math.min(from, P.total - 0.01));
}
function previewSlot(i) {
  stop();
  engine.unlock();
  const sc = schedule(), s = sc.slots[i], from = s.start * sc.spb, to = from + s.beats * sc.spb;
  const t0 = engine.ensureContext().currentTime + 0.05 - from;
  const L = st.layers; const saveL = { ...L };
  scheduleEvents(buildSchedule(song(), { chords: playChords(), bpm: arr().bpm, pattern: arr().pattern, layers: { ...saveL, melody: true, chords: true } }).events, t0, from, to);
}
(function loop() {
  requestAnimationFrame(loop);
  if (!P.on) return;
  const pos = engine.ctx.currentTime - P.t0;
  if (pos > P.total + 0.6) { stop(); return; }
  if (pos < 0) return;
  const s = song(), barSec = s.beats * P.spb, pkSec = pickupOf(s) * P.spb, rel = pos - pkSec, b = rel < 0 ? -1 : Math.floor(rel / barSec);
  const bars = $$('#ar-grid .ar-bar');
  bars.forEach((el, k) => {
    const ph = el.querySelector('.ar-ph');
    if (k === b) { ph.classList.add('on'); ph.style.left = ((rel - b * barSec) / barSec) * 100 + '%'; }
    else ph.classList.remove('on');
  });
  const slot = rel < 0 ? -1 : Math.floor(rel / (A().slot * P.spb));
  $$('#ar-grid .cblk').forEach((c) => c.classList.toggle('playing', +c.dataset.i === slot));
})();

// ---------- 控件 ----------
function syncTempo() { $('#ar-tempo').value = arr().bpm; $('#ar-bpm').textContent = arr().bpm; }
{
  // 选曲按「拍子」分组：先 4/4 从第 1 拍开始的，再有弱起的，最后 3/4 拍
  const groups = [['4/4 拍', (x) => x.beats === 4 && !x.pickup], ['4/4 拍 · 弱起（从小节中间开始唱）', (x) => x.beats === 4 && x.pickup], ['3/4 拍（华尔兹「嘣-恰-恰」）', (x) => x.beats === 3]];
  const opt = (x) => `<option value="${x.id}">${esc(x.title)}（${ARRANGE[x.id].key} 调${x.pickup ? ' · 弱起' : ''}）</option>`;
  $('#ar-song').innerHTML = groups.map(([g, f]) => `<optgroup label="${g}">${ARRANGE_SONGS.filter(f).map(opt).join('')}</optgroup>`).join('');
}
$('#ar-song').onchange = (e) => { stop(); st.songId = e.target.value; st.mood = 'orig'; save(); renderAll(); };
$('#ar-play').onclick = () => (P.on ? stop() : play(0));
$('#ar-tempo').oninput = (e) => { arr().bpm = +e.target.value; $('#ar-bpm').textContent = arr().bpm; save(); };
$('#ar-tempo').onchange = () => restartIfPlaying(false);
$('#ar-reset').onclick = () => { arr().chords = A().chords.slice(); st.mood = 'orig'; afterEdit(); };
$('#ar-export').onclick = async () => {
  const txt = chordChart(song(), playChords(), { bpm: arr().bpm, pattern: arr().pattern });
  const pre = $('#ar-chart'); pre.hidden = false; pre.textContent = txt;
  try { await navigator.clipboard.writeText(txt); pre.dataset.note = '已复制到剪贴板'; } catch { pre.dataset.note = ''; }
};

// ---------- 低音音色 ----------
function renderBassTone() {
  $('#ar-bass-tone').innerHTML = Object.entries(BASS_TONES).map(([k, t]) => `<button data-v="${k}" class="${st.bassTone === k ? 'on' : ''}">${t.name}</button>`).join('');
  $('#ar-bass-d').textContent = BASS_TONES[st.bassTone].desc;
  $$('#ar-bass-tone button').forEach((b) => (b.onclick = () => {
    st.bassTone = b.dataset.v; save(); renderBassTone();
    if (P.on) { if (!st.layers.bass) { st.layers.bass = true; renderLayers(); } restartIfPlaying(true); } else previewBass();
  }));
}
/** 试听：在本调里弹一小段低音线 I – V – vi – IV（根音-五音），只有低音 */
function previewBass() {
  stop();
  engine.unlockSync(true);
  const K = KEYS[A().key], spb = 60 / 104, t0 = engine.ensureContext().currentTime + 0.08;
  const line = [];
  ['I', 'V', 'vi', 'IV'].forEach((d, i) => { const r = bassMidi(K.chords[d]); line.push([r, i * 2, 1], [r + 7, i * 2 + 1, 1]); });
  line.push([bassMidi(K.chords.I), 8, 2]);
  for (const [m, b, d] of line) P.nodes.push(engine.bass(m, t0 + b * spb, d * spb * 0.92, 0.55 * 0.7, st.bassTone));
}
$('#ar-bass-try').onclick = previewBass;

function renderAll() {
  $('#ar-song').value = st.songId;
  const K = KEYS[A().key];
  $('#ar-key').textContent = `${A().key} 大调 · I=${K.chords.I} IV=${K.chords.IV} V=${K.chords.V} vi=${K.chords.vi}`;
  $('#ar-chart').hidden = true;
  syncTempo(); renderSteps(); renderLesson(); renderGrid(); renderLayers(); renderBassTone();
}
export function openArrange() { releaseMicForPlayback('（编曲页只播放，不用听）'); renderAll(); }
export function closeArrange() { stop(); }
export const arrangeState = () => ({ st, P });
