// app.js — 路由与各页面（首页 / 调音 / 曲库 / 认识指板 / 节奏 / 记录）
import { $, $$, esc, settings, saveSettings, engine, metro, live, onPitch, onOnset, onMic, enableMic, disableMic, needMic,
  loadHistory, addHistory, applyTheme, css, fmtC, pct, markChecked } from './core.js';
import { SONGS, parseSong, makeFretDrill, OPEN_MIDI } from './songs.js';
import { midiToFreq, midiName, noteFromFreq, centsBetween, matchOnsets, summarizeRhythm, gradeOf } from './dsp.js';
import { drawBoard } from './fretboard.js';
import { openPractice, closePractice } from './practice.js';
import { openDrawer, initDrawer } from './drawer.js';
import { openArrange, closeArrange } from './arrange.js';

applyTheme();
initDrawer();

// ---------- 小工具 ----------
let toastT = 0;
export function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}
const STARS = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

// ---------- 麦克风状态胶囊 ----------
onMic((st) => {
  const c = $('#mic-chip');
  c.classList.toggle('on', st === 'on'); c.classList.toggle('err', st === 'error');
  $('#mic-chip-text').textContent = st === 'on' ? '在听' : st === 'pending' ? '…' : st === 'error' ? '麦克风不可用' : '开麦克风';
  if (st === 'error') toast(live.micError, 6000);
});
$('#mic-chip').onclick = async () => { if (engine.micOn) disableMic(); else { await enableMic(); engine.unlock(); } };
(function levelLoop() {
  requestAnimationFrame(levelLoop);
  if (!engine.micOn) return;
  const v = Math.max(0, Math.min(1, (live.db + 70) / 55));
  $('.mic-lvl i').style.transform = `scaleX(${v.toFixed(3)})`;
})();

// ---------- 路由 ----------
const TITLES = { home: '吉他练习', tuner: '调音', songs: '练曲子', frets: '认识指板', rhythm: '节奏', history: '练习记录', play: '练习', arrange: '编曲入门' };
let curView = '';
let drill = null;
function route() {
  const [name, arg] = (location.hash.slice(1) || 'home').split('/');
  const view = TITLES[name] ? name : 'home';
  if (curView === 'play' && view !== 'play') closePractice();
  if (curView === 'rhythm' && view !== 'rhythm') stopRhythmAll();
  if (curView === 'arrange' && view !== 'arrange') closeArrange();
  $$('.view').forEach((v) => (v.hidden = v.id !== 'v-' + view));
  $('#result').hidden = true;
  curView = view;
  $('#view-title').textContent = TITLES[view];
  $('#back').hidden = view === 'home';
  document.title = (view === 'home' ? '' : TITLES[view] + ' · ') + '吉他练习 · Guitar Practice';
  if (view === 'home') renderHome();
  if (view === 'songs') renderSongs();
  if (view === 'history') renderHistory();
  if (view === 'arrange') openArrange();
  if (view === 'play') {
    if (arg === 'drill') { if (!drill) drill = makeDrillFromUI(); openPractice(drill.song, { drill: true, names: drill.names, onDone: () => { drill = makeDrillFromUI(); } }); }
    else {
      const song = SONGS.find((s) => s.id === arg);
      if (!song) { location.hash = '#songs'; return; }
      openPractice(song);
    }
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('#back').onclick = () => {
  const [name] = location.hash.slice(1).split('/');
  location.hash = name === 'play' ? (location.hash.includes('drill') ? '#frets' : '#songs') : '#home';
};

// ---------- 首页 ----------
function renderHome() {
  const c = settings.checked || {};
  $('#first-run').hidden = !!(c.mic && c.heard && c.click);
  const h = loadHistory().slice(-4).reverse();
  $('#recent').innerHTML = h.length ? h.map(histItem).join('') : `<div class="empty">还没有练习记录。先去「调音」把琴调准，然后试试《小星星》。</div>`;
  $('#hist-more').hidden = !h.length;
}
$('#first-run').onclick = () => openDrawer();
$('#hist-more').onclick = (e) => { e.preventDefault(); location.hash = '#history'; };
function histItem(e) {
  const d = new Date(e.at), when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (e.type === 'song' || e.type === 'drill') {
    const detail = e.type === 'drill' ? `认识指板 · 一次弹对率 ${e.score}%` : `${e.mode === 'along' ? '跟拍' : '等我'} · 音准 ${e.pitch}%${e.rhythm !== null && e.rhythm !== undefined ? ' · 节奏 ' + e.rhythm + '%' : ''} · ${e.bpm} BPM`;
    const href = e.type === 'drill' ? '#frets' : '#play/' + e.id;
    return `<a class="item" href="${href}"><span class="num">${e.type === 'drill' ? '▦' : '♪'}</span><span class="meta"><b>${esc(e.title)}</b><small>${detail}</small></span><span class="side"><span class="stars-s">${STARS(e.stars || 0)}</span><br>${when}</span></a>`;
  }
  if (e.type === 'rhythm') return `<a class="item" href="#rhythm"><span class="num">◔</span><span class="meta"><b>节奏测试</b><small>${esc(e.name || '')} · 准确率 ${pct(e.accuracy || 0)}</small></span><span class="side">${when}</span></a>`;
  return `<div class="item"><span class="num">·</span><span class="meta"><b>${esc(e.name || e.type || '练习')}</b><small>旧版记录</small></span><span class="side">${when}</span></div>`;
}

// ---------- 曲库 ----------
function renderSongs() {
  const best = {};
  for (const e of loadHistory()) if (e.type === 'song') best[e.id] = Math.max(best[e.id] || 0, e.stars || 0);
  $('#song-list').innerHTML = SONGS.map((s, i) => {
    const notes = parseSong(s).filter((n) => n.midi !== null);
    const strs = [...new Set(notes.map((n) => n.string))].sort().join('');
    return `<a class="item" href="#play/${s.id}" data-id="${s.id}"><span class="num">${i + 1}</span>
      <span class="meta"><b>${esc(s.title)}</b><small>${esc(s.en)} · ${notes.length} 个音 · ${strs.split('').join('、')} 弦</small></span>
      <span class="side"><span class="lvl-dots">${'●'.repeat(s.level)}${'○'.repeat(3 - s.level)}</span><br><span class="stars-s">${best[s.id] ? STARS(best[s.id]) : ''}</span></span></a>`;
  }).join('');
}

// ---------- 认识指板 ----------
function segVal(id) { return $(`#${id} button.on`).dataset.v; }
$$('#v-frets .seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
})));
function makeDrillFromUI() {
  const range = segVal('fr-range');
  const strings = range === 'open' ? [1, 2, 3, 4, 5, 6] : range === '123' ? [1, 2, 3] : [1, 2, 3, 4, 5, 6];
  const maxFret = range === 'open' ? 0 : +segVal('fr-fret');
  const names = segVal('fr-show') === 'name';
  const song = makeFretDrill({ strings, maxFret, count: +segVal('fr-count'), naturalOnly: names });
  return { song, names };
}
$('#fr-start').onclick = () => { drill = makeDrillFromUI(); if (location.hash === '#play/drill') route(); else location.hash = '#play/drill'; };
drawBoard($('#fr-map'), { names: true, onPick: (s, f) => { engine.unlock(); engine.pluck(OPEN_MIDI[s] + f); toast(`${s} 弦 ${f === 0 ? '空弦' : f + ' 品'} = ${midiName(OPEN_MIDI[s] + f)}`, 1500); } });

// ---------- 调音器 ----------
const OPEN = [6, 5, 4, 3, 2, 1].map((s) => OPEN_MIDI[s]);
let lockStr = -1;
(function buildTuner() {
  let t = '';
  for (let c = -50; c <= 50; c += 10) {
    const a = (c / 50) * (Math.PI / 2.4), major = c % 50 === 0 || c === 0, r2 = major ? 76 : 82;
    t += `<line class="g-tick ${major ? 'major' : ''}" x1="${Math.sin(a) * 90}" y1="${-Math.cos(a) * 90}" x2="${Math.sin(a) * r2}" y2="${-Math.cos(a) * r2}"/>`;
    if (major) t += `<text x="${Math.sin(a) * 64}" y="${-Math.cos(a) * 64 + 3}">${c > 0 ? '+' + c : c}</text>`;
  }
  $('#tu-ticks').innerHTML = t;
  const za = (5 / 50) * (Math.PI / 2.4);
  $('#tu-zone').setAttribute('d', `M ${-Math.sin(za) * 90} ${-Math.cos(za) * 90} A 90 90 0 0 1 ${Math.sin(za) * 90} ${-Math.cos(za) * 90}`);
  const w = $('#tu-strings');
  w.innerHTML = `<button data-s="-1" class="on">自动<small>最近的音</small></button>` +
    OPEN.map((m, i) => `<button data-s="${i}">${midiName(m).replace(/\d/, '')}<small>${6 - i} 弦</small></button>`).join('');
  w.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    lockStr = +b.dataset.s;
    w.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (lockStr >= 0) { await engine.unlock(); engine.pluck(OPEN[lockStr], undefined, 1.6, 0.9); }
    needMic();
  }));
})();
onPitch((fr) => {
  if (curView !== 'tuner') return;
  const f = fr.show, needle = $('#tu-needle'), v = $('#tu-verdict');
  $('.tu-note').classList.toggle('hold', !!fr.held);
  if (!f) { needle.classList.add('idle'); v.textContent = '弹一根空弦'; v.className = 'tu-verdict'; return; }
  needle.classList.remove('idle');
  let best = Infinity, near = -1;
  OPEN.forEach((m, i) => { const d = Math.abs(centsBetween(f, midiToFreq(m, settings.a4))); if (d < best) { best = d; near = i; } });
  let name, oct, cents;
  if (lockStr >= 0) { const m = OPEN[lockStr]; cents = centsBetween(f, midiToFreq(m, settings.a4)); name = midiName(m).replace(/-?\d+$/, ''); oct = Math.floor(m / 12) - 1; }
  else { const n = noteFromFreq(f, settings.a4); name = n.name; oct = n.octave; cents = n.cents; }
  $('#tu-note').textContent = name; $('#tu-oct').textContent = oct;
  $('#tu-freq').textContent = `${f.toFixed(1)} Hz · ${fmtC(cents)} 音分`;
  const c = Math.max(-50, Math.min(50, cents));
  needle.style.transform = `rotate(${(c / 50) * (180 / 2.4)}deg)`;
  needle.classList.toggle('in', Math.abs(cents) <= 5);
  if (fr.held) { v.textContent = '…'; v.className = 'tu-verdict'; }
  else if (Math.abs(cents) > 300) { v.textContent = `差了 ${Math.abs(Math.round(cents / 100))} 个半音，是不是选错弦了？`; v.className = 'tu-verdict bad'; }
  else if (Math.abs(cents) <= 5) { v.textContent = '✓ 准了'; v.className = 'tu-verdict ok'; }
  else if (cents > 0) { v.textContent = '偏高 · 把弦放松一点'; v.className = 'tu-verdict warn'; }
  else { v.textContent = '偏低 · 把弦拧紧一点'; v.className = 'tu-verdict warn'; }
  $$('#tu-strings button').forEach((b) => b.classList.toggle('near', +b.dataset.s === near && best < 50));
});

// ---------- 节奏 ----------
const rh = { active: false, expected: [], onsets: [], live: [], countInEnd: 0, endTime: 0, timer: 0 };
function rhSetBpm(v) { v = Math.max(30, Math.min(220, Math.round(v))); $('#rh-bpm').textContent = v; $('#rh-bpm-range').value = v; metro.set({ bpm: v }); }
$$('[data-bpm]').forEach((b) => (b.onclick = () => rhSetBpm(+$('#rh-bpm').textContent + +b.dataset.bpm)));
$('#rh-bpm-range').oninput = (e) => rhSetBpm(+e.target.value);
function rhDots() {
  const n = +segVal('rh-beats');
  $('#rh-dots').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i === 0 ? 'first' : ''}"></span>`).join('');
}
['rh-beats', 'rh-sub'].forEach((id) => $$(`#${id} button`).forEach((b) => (b.onclick = () => {
  $$(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b));
  metro.set({ beatsPerBar: +segVal('rh-beats'), subdiv: +segVal('rh-sub') }); rhDots();
})));
rhDots();
function flashAt(time, info) {
  const outLat = (engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0);
  setTimeout(() => {
    if (info.sub !== 0) return;
    const d = $$('#rh-dots span'); d.forEach((x, i) => x.classList.toggle('flash', i === info.beat));
    setTimeout(() => d[info.beat] && d[info.beat].classList.remove('flash'), 110);
  }, Math.max(0, (time + outLat - engine.ctx.currentTime) * 1000));
}
function metroParams() { return { bpm: +$('#rh-bpm').textContent, beatsPerBar: +segVal('rh-beats'), subdiv: +segVal('rh-sub'), sound: settings.outMode !== 'silent', accent: true, volume: settings.volume }; }
$('#rh-play').onclick = async () => {
  if (rh.active) return;
  if (metro.running) { metro.stop(); $('#rh-play').textContent = '▶ 节拍器'; return; }
  await engine.unlock(); markChecked('click');
  Object.assign(metro, metroParams()); metro.onTick = flashAt; metro.start();
  $('#rh-play').textContent = '⏸ 停止';
};
let taps = [];
$('#rh-tap').onclick = () => {
  const now = performance.now(); taps = taps.filter((t) => now - t < 2500); taps.push(now);
  if (taps.length >= 3) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); rhSetBpm(60000 / iv); }
};
function stopRhythmAll() { if (rh.active) stopRhythm(false); metro.stop(); $('#rh-play').textContent = '▶ 节拍器'; }
$('#rh-test').onclick = async () => {
  if (rh.active) { stopRhythm(true); return; }
  if (!(await needMic())) return;
  await engine.unlock();
  metro.stop(); $('#rh-play').textContent = '▶ 节拍器';
  Object.assign(metro, metroParams());
  const perBar = metro.beatsPerBar * metro.subdiv, bars = 4, total = perBar * bars;
  const start = metro.start(0.3), iv = metro.tickInterval;
  Object.assign(rh, { active: true, onsets: [], live: [], expected: [], total, countInEnd: start + perBar * iv, iv,
    desc: `${metro.bpm} BPM · ${metro.beatsPerBar}/4 · ${['', '四分', '八分', '三连音', '十六分'][metro.subdiv]}`, params: { bpm: metro.bpm, beats: metro.beatsPerBar, subdiv: metro.subdiv, bars } });
  for (let i = 0; i < total; i++) rh.expected.push(rh.countInEnd + i * iv);
  rh.endTime = rh.expected[total - 1] + Math.min(0.3, iv / 2) + 0.15;
  metro.onTick = (time, info) => { flashAt(time, info); if (info.index >= perBar + total) metro.stop(); };
  $('#rh-test').textContent = '停止'; $('#rh-result').innerHTML = '';
  $('#rh-last').textContent = '—'; $('#rh-last').className = ''; $('#rh-grade').textContent = '';
  rh.timer = setInterval(() => {
    const now = engine.ctx.currentTime, st = $('#rh-state');
    if (now < rh.countInEnd) st.textContent = `预备 ${Math.max(1, metro.beatsPerBar - Math.floor((now - start) / (iv * metro.subdiv)))}`;
    else if (now < rh.endTime) st.textContent = `第 ${Math.min(bars, Math.floor((now - rh.countInEnd) / (iv * perBar)) + 1)} / ${bars} 小节`;
    if (engine.lastFrameTime > rh.endTime + 0.1) stopRhythm(true);
  }, 50);
  drawRh();
};
onOnset((o) => {
  if (!rh.active) return;
  const adj = o - settings.latencyMs / 1000;
  if (adj < rh.countInEnd - rh.iv / 2 || adj > rh.endTime) return;
  rh.onsets.push(o);
  let best = rh.expected[0];
  for (const e of rh.expected) if (Math.abs(adj - e) < Math.abs(adj - best)) best = e;
  const err = (adj - best) * 1000, win = Math.min(150, (rh.iv * 1000) / 2), el = $('#rh-last');
  if (Math.abs(err) > win) { el.textContent = '没对上'; el.className = 'bad'; $('#rh-grade').textContent = '离拍太远'; return; }
  rh.live.push({ idx: rh.expected.indexOf(best), err });
  const g = gradeOf(err);
  el.textContent = Math.abs(err) < 5 ? '正好' : `${err < 0 ? '早' : '晚'} ${Math.abs(Math.round(err))}ms`;
  el.className = { perfect: 'ok', good: 'accent', ok: 'warn', off: 'bad' }[g];
  $('#rh-grade').textContent = { perfect: '完美', good: '好', ok: '一般', off: '偏差大' }[g];
  drawRh();
});
function stopRhythm(save) {
  rh.active = false; metro.stop(); clearInterval(rh.timer);
  $('#rh-test').textContent = '开始测'; $('#rh-state').textContent = '结束';
  const lim = Math.min(engine.ctx.currentTime, engine.lastFrameTime) - 0.05;
  const expected = rh.expected.filter((e) => e <= lim);
  if (!save || expected.length < 2) return;
  const m = matchOnsets(rh.onsets, expected, { latencyMs: settings.latencyMs, windowMs: 150 });
  const s = summarizeRhythm(m);
  drawRh(m);
  const tip = s.hitRate < 0.6 ? '漏拍较多：先把速度调慢。' : s.meanErrorMs < -15 ? '整体抢拍：心里数着拍子“等”一下。' : s.meanErrorMs > 15 ? (settings.latencyMs ? '整体拖拍：手腕放松，提前准备。' : '整体偏晚：可能是设备延迟，先到设置里做一次延迟校准。') : s.stdMs > 30 ? '忽早忽晚：右手保持匀速上下摆动。' : '很稳！可以加快速度或换更密的细分。';
  $('#rh-result').innerHTML = `<div class="stats">
    <div class="stat"><b>${pct(s.accuracy)}</b><span>准确率</span></div>
    <div class="stat"><b>${s.hit}/${s.expected}</b><span>命中</span></div>
    <div class="stat"><b>${fmtC(s.meanErrorMs)}ms</b><span>平均（+晚 −早）</span></div>
    <div class="stat"><b>±${Math.round(s.stdMs)}ms</b><span>稳定性</span></div></div><p class="hint">${tip}</p>`;
  addHistory({ type: 'rhythm', name: rh.desc, ...rh.params, latencyMs: settings.latencyMs, accuracy: s.accuracy, hitRate: s.hitRate, meanErrorMs: s.meanErrorMs, stdMs: s.stdMs, extra: s.extra });
}
function drawRh(match) {
  const cv = $('#rh-canvas'), dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 600, H = 120;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const R = 120, y = (ms) => H / 2 - (Math.max(-R, Math.min(R, ms)) / R) * (H / 2 - 10);
  g.fillStyle = css('--ok') + '22'; g.fillRect(0, y(20), W, y(-20) - y(20));
  g.strokeStyle = css('--line'); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.fillStyle = css('--muted'); g.font = '10px sans-serif'; g.fillText('晚', 6, 14); g.fillText('早', 6, H - 6);
  const n = rh.total || 16, x = (i) => 24 + ((i + 0.5) / n) * (W - 32);
  const pts = match ? match.hits.map((h, i) => (h ? { idx: i, err: h.errorMs } : { idx: i, miss: true })) : rh.live;
  for (const p of pts) {
    if (p.miss) { g.fillStyle = css('--bad'); g.fillText('×', x(p.idx) - 3, H / 2 + 4); continue; }
    const gr = gradeOf(p.err);
    g.fillStyle = css(gr === 'perfect' ? '--ok' : gr === 'good' ? '--accent' : gr === 'ok' ? '--warn' : '--bad');
    g.beginPath(); g.arc(x(p.idx), y(p.err), 4.5, 0, Math.PI * 2); g.fill();
  }
}

// ---------- 记录 ----------
function renderHistory() {
  const h = loadHistory().slice().reverse();
  $('#hist-list').innerHTML = h.length ? h.map(histItem).join('') : `<div class="empty">还没有记录</div>`;
}

route();
