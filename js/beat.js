// beat.js — 「节奏训练」页：节奏型 + 节拍器（内置 / 外部）+ 每一下的早晚 + 小节结算 + 诊断 + 专项 + 自动调速
import { $, $$, esc, settings, onSettings, engine, metro, onOnset, needMic, gateRms, loadHistory, addHistory, css, pct, toast, markChecked } from './core.js';
import { METERS, patternsFor, getPattern, gridCells, RhythmSession, TempoLadder, clickOn, ExternalClickTracker } from './rhythm.js';
import { runLoopback, loopbackMessage, listenExternal, externalMessage, testBusy } from './latency.js';

const LS = 'guitar-practice:beat';
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const cfg = Object.assign({
  meter: '4/4', pat: { '2/4': 'q', '3/4': 'q', '4/4': 'e', '6/8': 'c8' }, bars: 8, src: 'internal', click: 'all', muteX: 1, muteY: 0,
  subClicks: false, ladder: true, ladderK: 2, tolG: 30, tolY: 60, beep: false, extBpm: 80, extAuto: true, bpm: {},
}, json(localStorage.getItem(LS)) || {});
const save = () => localStorage.setItem(LS, JSON.stringify(cfg));
const meterObj = () => METERS[cfg.meter] || METERS['4/4'];
function curPattern() {
  const list = patternsFor(cfg.meter), p = getPattern(cfg.pat[cfg.meter]);
  return list.includes(p) ? p : list[0];
}
const bpmKey = () => cfg.meter + ':' + curPattern().id;
const curBpm = () => cfg.bpm[bpmKey()] || (cfg.meter === '6/8' ? 46 : 70);
const setBpm = (v) => { cfg.bpm[bpmKey()] = Math.max(30, Math.min(220, Math.round(v))); save(); $('#bt-bpm').textContent = cfg.bpm[bpmKey()]; };

let run = null;     // 正在进行的训练
let lastView = null; // 结束后画布上保留的最后一小节
let prevDiag = null; // 上一次的诊断（专项练习前后对比）

// ---------------- 记谱 ----------------
function shortLabel(cell, meter) {
  if (meter.compound) return cell.count;
  const beat = Math.floor(cell.at + 1e-6) + 1;
  return cell.beatStart ? String(beat) : beat + cell.count;
}
function notationHTML(pattern, meter, { focus = null, mini = false } = {}) {
  const cells = gridCells(pattern, meter), res = pattern.res, beats = [];
  let hitI = 0;
  for (let b = 0; b < meter.beats; b++) {
    const cs = cells.slice(b * res, (b + 1) * res).map((c) => {
      const i = c.on ? hitI++ : -1, f = focus && c.on && focus.includes(c.key);
      return `<div class="c${c.on ? ' on' : ''}${f ? ' focus' : ''}"${c.on ? ` data-i="${i}"` : ''}>${mini ? '' : `<i>${c.on ? (c.dir === 'D' ? '↓' : c.dir === 'U' ? '↑' : '●') : ''}</i>`}<span>${esc(mini ? '' : c.count)}</span></div>`;
    }).join('');
    beats.push(`<div class="bt-beat" style="--n:${res}">${cs}</div>`);
  }
  return `<div class="bt-nota${mini ? ' mini' : ''}${meter.compound ? ' compound' : ''}">${beats.join('')}</div>`;
}
function renderHeader() {
  const p = curPattern(), m = meterObj(), focus = run && run.focus;
  $('#bt-pat-name').textContent = p.name;
  $('#bt-pat-hint').textContent = p.hint;
  $('#bt-meter-pill').textContent = m.id + (m.compound ? '（BPM = 附点四分）' : '');
  $('#bt-src-pill').textContent = cfg.src === 'external' ? '外部节拍器' : '内置节拍器';
  $('#bt-focus-pill').hidden = !focus;
  if (focus) $('#bt-focus-pill').textContent = '专项：' + run.focusLabels.join('、');
  $('#bt-notation').innerHTML = notationHTML(p, m, { focus });
  $('#bt-bpm').textContent = run ? (run.mode === 'external' ? (run.locked ? Math.round(run.tracker.grid.bpm) : '…') : run.ladder ? run.ladder.bpm : run.bpm) : cfg.src === 'external' ? (cfg.extAuto ? '自动' : cfg.extBpm) : curBpm();
  $('#bt-beats').innerHTML = Array.from({ length: m.beats }, (_, i) => `<span class="${i === 0 ? 'first' : ''}"></span>`).join('');
}
function renderSettings() {
  const m = meterObj(), list = patternsFor(cfg.meter), cur = curPattern();
  $$('#bt-meter button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.meter));
  $('#bt-patterns').innerHTML = list.map((p) => `<button class="bt-pc${p === cur ? ' on' : ''}" data-id="${p.id}">
      <span class="bt-pc-h"><b>${esc(p.name)}</b><span class="lvl-dots">${'●'.repeat(p.level)}${'○'.repeat(3 - p.level)}</span></span>
      ${notationHTML(p, m, { mini: true })}<small>${esc(p.short)}</small></button>`).join('');
  $$('#bt-patterns .bt-pc').forEach((b) => (b.onclick = () => { if (run) return toast('先停止当前练习'); cfg.pat[cfg.meter] = b.dataset.id; save(); prevDiag = null; renderAll(); }));
  $$('#bt-nbars button').forEach((b) => b.classList.toggle('on', +b.dataset.v === cfg.bars));
  $$('#bt-src button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.src));
  $$('#bt-click button').forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.click));
  $('#bt-click-f').hidden = cfg.src === 'external';
  $('#bt-int').hidden = cfg.src === 'external'; $('#bt-ext').hidden = cfg.src !== 'external';
  $('#bt-muteY').value = String(cfg.muteY); $('#bt-muteX').value = String(Math.min(cfg.muteX, Math.max(1, cfg.muteY - 1) || 1));
  $('#bt-subclick').checked = cfg.subClicks; $('#bt-ladder').checked = cfg.ladder; $('#bt-ladderK').value = String(cfg.ladderK);
  $('#bt-tolG').value = cfg.tolG; $('#bt-tolG-v').textContent = `±${cfg.tolG} ms`;
  $('#bt-tolY').value = cfg.tolY; $('#bt-tolY-v').textContent = `±${cfg.tolY} ms`;
  $('#bt-beep').checked = cfg.beep;
  $('#bt-ext-bpm').value = cfg.extBpm; $('#bt-ext-bpm').disabled = cfg.extAuto; $('#bt-ext-auto').checked = cfg.extAuto;
  $('#bt-lat-v').textContent = settings.latencyMs;
  $('#bt-lat-src').textContent = cfg.src === 'external' ? '（外部节拍器模式不用）' : settings.checked && settings.checked.cal ? '' : '（还没测过）';
  // 偏差条的颜色区间跟着容差走（显示范围 ±150 ms）
  const R = 150, g = (cfg.tolG / R) * 50, y = ((cfg.tolY - cfg.tolG) / R) * 50, r = 50 - g - y;
  const z = $$('.bt-dev-zones .z'); [r, y, 2 * g, y, r].forEach((w, i) => (z[i].style.flexBasis = Math.max(0, w) + '%'));
}
function renderAll() { renderHeader(); renderSettings(); renderTrend(); draw(); }

// ---------------- 设置事件 ----------------
function seg(id, fn) { $$(`#${id} button`).forEach((b) => (b.onclick = () => { if (run) return toast('先停止当前练习'); fn(b.dataset.v); save(); renderAll(); })); }
seg('bt-meter', (v) => { cfg.meter = v; prevDiag = null; });
seg('bt-nbars', (v) => (cfg.bars = +v));
seg('bt-src', (v) => (cfg.src = v));
seg('bt-click', (v) => (cfg.click = v));
$('#bt-muteY').onchange = (e) => { cfg.muteY = +e.target.value; if (cfg.muteX >= cfg.muteY && cfg.muteY) cfg.muteX = cfg.muteY - 1 || 1; save(); renderSettings(); };
$('#bt-muteX').onchange = (e) => { cfg.muteX = +e.target.value; if (cfg.muteY && cfg.muteX >= cfg.muteY) cfg.muteX = cfg.muteY - 1 || 1; save(); renderSettings(); };
$('#bt-subclick').onchange = (e) => { cfg.subClicks = e.target.checked; save(); };
$('#bt-ladder').onchange = (e) => { cfg.ladder = e.target.checked; save(); };
$('#bt-ladderK').onchange = (e) => { cfg.ladderK = +e.target.value; save(); };
$('#bt-tolG').oninput = (e) => { cfg.tolG = +e.target.value; if (cfg.tolY < cfg.tolG + 10) cfg.tolY = cfg.tolG + 10; save(); renderSettings(); };
$('#bt-tolY').oninput = (e) => { cfg.tolY = Math.max(+e.target.value, cfg.tolG + 10); save(); renderSettings(); };
$('#bt-beep').onchange = (e) => { cfg.beep = e.target.checked; save(); };
$('#bt-ext-bpm').onchange = (e) => { cfg.extBpm = Math.max(30, Math.min(240, +e.target.value || 80)); save(); renderAll(); };
$('#bt-ext-auto').onchange = (e) => { cfg.extAuto = e.target.checked; save(); renderAll(); };
$$('[data-bt-bpm]').forEach((b) => (b.onclick = () => {
  if (run && run.mode === 'external') return toast('外部节拍器的速度要在那台设备上调');
  if (cfg.src === 'external' && !run) return toast('外部节拍器模式：速度在那台设备上调，或在设置里填写');
  const v = (run ? (run.ladder ? run.ladder.bpm : run.bpm) : curBpm()) + +b.dataset.btBpm;
  setBpm(v);
  if (run) { const nv = cfg.bpm[bpmKey()]; if (run.ladder) run.ladder.bpm = nv; run.bpm = nv; metro.pendingBpm = nv; }
}));
$('#bt-lat-test').onclick = async () => {
  if (run) return toast('先停止当前练习');
  $('#bt-lat-res').textContent = '正在放测试音…保持安静，不用弹琴';
  const est = await runLoopback({ onProgress: (i, n) => i >= 0 && ($('#bt-lat-res').textContent = `正在放测试音 ${i + 1}/${n}…`) });
  $('#bt-lat-res').textContent = loopbackMessage(est); renderSettings();
};
$('#bt-ext-test').onclick = async () => {
  if (run) return toast('先停止当前练习');
  $('#bt-ext-res').textContent = '在听…（8 秒，别弹琴）';
  const r = await listenExternal({ seconds: 8, bpm: cfg.extAuto ? null : cfg.extBpm, onClick: (t, n) => ($('#bt-ext-res').textContent = `在听…已听到 ${n} 下`) });
  $('#bt-ext-res').textContent = externalMessage(r);
  if (r.ok && cfg.extAuto) { cfg.extBpm = Math.round(r.bpm); save(); $('#bt-ext-bpm').value = cfg.extBpm; }
};
onSettings(() => { if (!$('#v-beat').hidden) renderSettings(); });

// ---------------- 开始 / 停止 ----------------
$('#bt-start').onclick = () => (run ? stop(true) : start());
async function start(opts = {}) {
  if (testBusy()) return toast('正在测试，稍等一下');
  if (!(await needMic())) return;
  await engine.unlock(); markChecked('click');
  const pattern = curPattern(), meter = meterObj(), focus = opts.focus || null;
  $('#bt-diag').hidden = true; $('#bt-bars').innerHTML = ''; lastView = null;
  $('#bt-set').open = false;
  const session = new RhythmSession({ pattern, meter, tol: { green: cfg.tolG, yellow: cfg.tolY }, focus });
  run = { pattern, meter, session, focus, focusLabels: opts.labels || [], bars: cfg.bars, mode: cfg.src, bpm: opts.bpm || curBpm(), startedAt: Date.now(), hits: 0, unsub: [] };
  run.startBpm = run.bpm;
  if (run.mode === 'external') startExternal();
  else startInternal();
  $('#bt-start').textContent = '■ 停止';
  $('#bt-last').textContent = '—'; $('#bt-last').className = ''; $('#bt-last-l').textContent = '';
  renderHeader();
  run.timer = setInterval(tickRun, 30);
  requestAnimationFrame(frame);
}
function startInternal() {
  const { meter, pattern } = run;
  metro.stop();
  if (cfg.ladder) run.ladder = new TempoLadder({ bpm: run.bpm, step: 4, needUp: cfg.ladderK, needDown: 2, min: 40, max: 220 });
  run.lat = settings.latencyMs / 1000;
  const clickCfg = { mode: cfg.click, muteX: cfg.muteX, muteY: cfg.muteY, subClicks: cfg.subClicks };
  run.clickCfg = clickCfg;
  Object.assign(metro, { bpm: run.bpm, beatsPerBar: meter.beats, subdiv: meter.compound ? 3 : cfg.subClicks ? pattern.res : 1, accent: true,
    sound: settings.outMode !== 'silent', volume: settings.volume, pendingBpm: 0 });
  metro.gate = (info) => info.bar <= run.bars && clickOn({ ...info, bar: info.bar - 1 }, clickCfg, meter, info.bar === 0);
  metro.onTick = (time, info) => {
    if (!run) return;
    const sounding = info.bar <= run.bars && clickOn({ ...info, bar: info.bar - 1 }, clickCfg, meter, info.bar === 0);
    if (info.sub === 0 && sounding) flashBeat(time + outLat(), info.beat);
    if (info.sub !== 0 || info.beat !== 0) return;
    if (info.bar === 0) { run.countStart = time; run.beatSec = 60 / metro.bpm; }
    else if (info.bar <= run.bars) {
      const bar = run.session.addBar(info.bar - 1, time, 60 / metro.bpm);
      bar.bpm = metro.bpm; bar.muted = clickCfg.muteY > 0 && (info.bar - 1) % clickCfg.muteY >= clickCfg.muteY - clickCfg.muteX;
    } else metro.stop();
  };
  run.unsub.push(onOnset((t) => run && onHit(t - run.lat)));
  metro.start(0.35);
}
function startExternal() {
  metro.stop();
  run.lat = 0;
  const tr = new ExternalClickTracker(engine.ctx.sampleRate, { bpm: cfg.extAuto ? null : cfg.extBpm, gate: gateRms() * 0.8 });
  run.tracker = tr; run.locked = false; run.heard = 0; run.listenT = performance.now(); run.nextBar = 0;
  run.unsub.push(engine.onChunk((d, t) => { if (!run) return; tr.setGate(gateRms() * 0.8); for (const e of tr.process(d, t)) onExtEvent(e); }));
}
function onExtEvent(e) {
  if (e.type === 'cand') { run.heard++; flashBeat(null, (run.heard - 1) % run.meter.beats); return; }
  if (e.type === 'lock') {
    const g = run.tracker.grid;
    run.locked = true; run.k0 = g.nextK(engine.lastFrameTime + 0.08);
    run.countStart = g.tick(run.k0); run.beatSec = g.period; run.bpm = run.startBpm = Math.round(e.bpm);
    run.lockInfo = e;
    toast(`锁定外部节拍器：${e.bpm.toFixed(1)} BPM（抖动 ±${e.jitterMs.toFixed(1)} ms）。数 1 小节就开始。`, 3000);
    renderHeader(); return;
  }
  if (!run.locked) return;
  if (e.type === 'click') { const b = ((e.k - run.k0) % run.meter.beats + run.meter.beats) % run.meter.beats; flashBeat(null, b); return; }
  if (e.type === 'hit') onHit(e.t);
}
const outLat = () => (engine.ctx ? (engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0) : 0);
// 「现在」的位置：内置 = 你听到的时间；外部 = 麦克风时间
const nowPerceived = () => (run && run.mode === 'external' ? engine.lastFrameTime : engine.ctx.currentTime - outLat());
function flashBeat(when, beat) {
  const d = $$('#bt-beats span'), go = () => { d.forEach((x, i) => x.classList.toggle('flash', i === beat)); setTimeout(() => d[beat] && d[beat].classList.remove('flash'), 110); };
  if (when === null) go(); else setTimeout(go, Math.max(0, (when - engine.ctx.currentTime) * 1000));
}
function stopAudio() {
  if (!run) return;
  clearInterval(run.timer); run.unsub.forEach((f) => f()); run.unsub = [];
  if (run.mode === 'internal') { metro.stop(); metro.gate = null; metro.onTick = null; metro.pendingBpm = 0; }
}
function stop(userStopped) {
  if (!run) return;
  stopAudio();
  const done = run.session.results.length;
  if (userStopped && done >= 1) return finish(true);
  run = null; $('#bt-start').textContent = '开始'; $('#bt-state').textContent = userStopped ? '已停止（一小节都没练完，不记录）' : '准备好就点「开始」';
  $('#bt-barno').textContent = ''; renderHeader(); draw();
}
export function closeBeat() { if (run) stop(false); }
export function openBeat() { renderAll(); }

// ---------------- 运行中 ----------------
function tickRun() {
  if (!run) return;
  const { session, meter } = run;
  if (run.mode === 'external') {
    if (!run.locked) {
      const sec = (performance.now() - run.listenT) / 1000;
      $('#bt-state').textContent = `在听外部节拍器…先别弹（${run.heard} 下${cfg.extAuto ? '' : ` · 按 ${cfg.extBpm} BPM 找`}）`;
      if (sec > 15) { stop(false); $('#bt-state').textContent = `15 秒内没锁定外部节拍器（听到 ${run ? run.heard : 0} 下）：把节拍器调大声、每拍只响一下，或先在设置里「先听 8 秒测一下」。`; }
      return;
    }
    const g = run.tracker.grid;
    while (run.nextBar < run.bars && engine.lastFrameTime > g.tick(run.k0 + (run.nextBar + 1) * meter.beats) - 0.6) {
      const k = run.k0 + (run.nextBar + 1) * meter.beats, bar = session.addBar(run.nextBar, g.tick(k), g.period);
      bar.bpm = Math.round(g.bpm); run.nextBar++;
    }
  }
  const nowIn = engine.lastFrameTime - run.lat;
  for (const bar of session.bars) {
    if (bar.closed || nowIn < bar.end + bar.win + 0.03) continue;
    const res = session.closeBar(bar, bar.index === run.bars - 1);
    onBarClosed(bar, res);
  }
  // 状态
  const tp = nowPerceived(), st = $('#bt-state');
  if (run.countStart !== undefined) {
    const bs = run.beatSec, first = run.countStart + meter.beats * bs;
    if (tp < run.countStart) st.textContent = '准备…';
    else if (tp < first) st.textContent = `预备 ${Math.max(1, meter.beats - Math.floor((tp - run.countStart) / bs))}`;
    else {
      const cur = session.bars.filter((b) => b.start <= tp).pop();
      if (cur) { st.textContent = cur.muted ? '🔇 心里数拍子' : '弹！'; $('#bt-barno').textContent = `第 ${cur.index + 1} / ${run.bars} 小节 · ${cur.bpm} BPM`; }
    }
  }
  if (session.results.length >= run.bars) finish(false);
}
function onHit(t) {
  if (!run) return;
  const r = run.session.hit(t);
  if (r.extra && !r.bar) return; // 预备拍里的
  const el = $('#bt-last');
  if (r.extra) { el.textContent = '多弹'; el.className = 'muted'; $('#bt-last-l').textContent = '这里不该弹（休止 / 不在节奏型里）'; return; }
  run.hits++;
  const e = Math.round(r.errMs);
  el.textContent = Math.abs(e) < 5 ? '正好' : `${e < 0 ? '早' : '晚'} ${Math.abs(e)} ms`;
  el.className = { green: 'ok', yellow: 'warn', red: 'bad' }[r.grade];
  $('#bt-last-l').textContent = r.label;
  const m = $('#bt-dev-mark');
  m.style.left = (50 + (Math.max(-150, Math.min(150, r.errMs)) / 150) * 50) + '%'; m.className = 'bt-dev-mark ' + r.grade;
  const c = $(`#bt-notation .c[data-i="${r.i}"]`);
  if (c) { c.classList.remove('g-green', 'g-yellow', 'g-red'); void c.offsetWidth; c.classList.add('g-' + r.grade); clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('g-' + r.grade), 380); }
  if (cfg.beep && run.mode === 'internal' && settings.outMode !== 'silent') engine.blip(r.grade === 'green' ? 3400 : r.grade === 'yellow' ? 2900 : 2450, 0.18);
}
function onBarClosed(bar, res) {
  let arrow = '';
  if (run.ladder && bar.index < run.bars - 1) {
    const ch = run.ladder.update(res.ok);
    if (ch) { metro.pendingBpm = run.ladder.bpm; arrow = ch > 0 ? `<i class="up">↑${run.ladder.bpm}</i>` : `<i class="down">↓${run.ladder.bpm}</i>`; $('#bt-bpm').textContent = run.ladder.bpm; }
  }
  const html = `<span class="bc ${res.ok ? 'ok' : res.accuracy >= 0.6 ? 'mid' : 'bad'}" title="${res.miss} 漏 / ${res.extras.length} 多"><b>${bar.index + 1}</b>${Math.round(res.accuracy * 100)}${bar.muted ? '🔇' : ''}${arrow}</span>`;
  $('#bt-bars').insertAdjacentHTML('beforeend', html);
}

// ---------------- 画布：当前小节，每个音一个槽，偏差放大显示 ----------------
function frame() { draw(); if (run) requestAnimationFrame(frame); }
function draw() {
  const cv = $('#bt-canvas'); if (!cv || $('#v-beat').hidden) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 600, H = 132;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const pattern = run ? run.pattern : curPattern(), meter = run ? run.meter : meterObj();
  const cells = gridCells(pattern, meter), n = cells.length, pad = 14, cw = (W - 2 * pad) / n, mid = 66;
  const tp = run ? nowPerceived() : 0;
  let bar = null;
  if (run) { bar = run.session.bars.filter((b) => b.start - 0.05 <= tp).pop() || null; if (bar) lastView = bar; }
  else bar = lastView;
  const focus = run ? run.focus : null;
  // 拍线
  for (let i = 0; i <= n; i++) {
    const x = pad + i * cw, strong = i % pattern.res === 0;
    g.strokeStyle = css('--line'); g.lineWidth = strong ? 1.5 : 0.6; g.globalAlpha = strong ? 1 : 0.6;
    g.beginPath(); g.moveTo(x, 18); g.lineTo(x, H - 22); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = css('--muted'); g.font = '11px sans-serif'; g.textAlign = 'center';
  cells.forEach((c, i) => g.fillText(c.count, pad + (i + 0.5) * cw, H - 7));
  // 槽：容差区间（绿 / 黄）宽度 = 显示比例
  const half = Math.min(cw * 0.46, 46), R = 150, sx = (ms) => (Math.max(-R, Math.min(R, ms)) / R) * half;
  const onCells = cells.map((c, i) => ({ c, i })).filter((x) => x.c.on);
  onCells.forEach(({ c, i }) => {
    const cx = pad + (i + 0.5) * cw;
    g.fillStyle = css('--warn') + '26'; g.fillRect(cx - sx(cfg.tolY), mid - 18, 2 * sx(cfg.tolY), 36);
    g.fillStyle = css('--ok') + '40'; g.fillRect(cx - sx(cfg.tolG), mid - 18, 2 * sx(cfg.tolG), 36);
    g.strokeStyle = focus && focus.includes(c.key) ? css('--accent') : css('--faint'); g.lineWidth = focus && focus.includes(c.key) ? 2.5 : 1.2;
    g.beginPath(); g.moveTo(cx, mid - 26); g.lineTo(cx, mid + 26); g.stroke();
  });
  if (!bar) {
    g.fillStyle = css('--muted'); g.font = '13px sans-serif';
    g.fillText(run ? (run.mode === 'external' && !run.locked ? '在听外部节拍器…' : '预备…') : '开始后，每一下的早晚会画在这里（左 = 早，右 = 晚）', W / 2, mid + 44);
    return;
  }
  // 播放头
  if (run && tp >= bar.start && tp <= bar.end) {
    const x = pad + ((tp - bar.start) / (bar.end - bar.start)) * (W - 2 * pad);
    g.strokeStyle = css('--accent'); g.lineWidth = 2; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, 18); g.lineTo(x, H - 22); g.stroke(); g.globalAlpha = 1;
  }
  const color = (gr) => css(gr === 'green' ? '--ok' : gr === 'yellow' ? '--warn' : '--bad');
  const cellOfHit = (i) => onCells[i] ? onCells[i].i : 0;
  if (bar.closed) {
    bar.result.notes.forEach((nt, j) => {
      const cx = pad + (cellOfHit(j) + 0.5) * cw;
      if (nt.errMs === null) { g.fillStyle = css('--bad'); g.font = 'bold 18px sans-serif'; g.fillText('×', cx, mid + 6); return; }
      g.fillStyle = color(nt.grade); g.beginPath(); g.arc(cx + sx(nt.errMs), mid, 7, 0, Math.PI * 2); g.fill();
    });
    bar.result.extras.forEach((t) => { const x = pad + ((t - bar.start) / (bar.end - bar.start)) * (W - 2 * pad); g.fillStyle = css('--faint'); g.beginPath(); g.arc(x, mid + 34, 4, 0, Math.PI * 2); g.fill(); });
  } else {
    bar.live.forEach((h) => {
      if (h.extra) { const x = pad + ((h.t - bar.start) / (bar.end - bar.start)) * (W - 2 * pad); g.fillStyle = css('--faint'); g.beginPath(); g.arc(x, mid + 34, 4, 0, Math.PI * 2); g.fill(); return; }
      const cx = pad + (cellOfHit(h.i) + 0.5) * cw;
      g.fillStyle = color(h.grade); g.beginPath(); g.arc(cx + sx(h.errMs), mid, 7, 0, Math.PI * 2); g.fill();
    });
  }
  g.fillStyle = css('--muted'); g.font = '11px sans-serif'; g.textAlign = 'left';
  g.fillText(`第 ${bar.index + 1} 小节${bar.muted ? ' 🔇 静音' : ''}`, pad, 13); g.textAlign = 'center';
}

// ---------------- 结束：诊断 ----------------
function finish(early) {
  const r = run; stopAudio(); run = null;
  $('#bt-start').textContent = '开始'; $('#bt-barno').textContent = '';
  const endBpm = r.ladder ? r.ladder.bpm : r.bpm;
  const d = r.session.summary(r.mode === 'external' ? r.bpm : r.startBpm);
  $('#bt-state').textContent = early ? `提前停止：结算了 ${d.bars} 小节` : '完成！看看哪里需要加强 ↓';
  if (r.mode === 'internal' && r.ladder && !r.focus) setBpmFor(r, Math.max(r.startBpm, r.ladder.bpm - (d.accuracy < 0.7 ? 4 : 0)));
  addHistory({ type: 'beat', pat: r.pattern.id, name: r.pattern.name, meter: r.meter.id, bpm: r.startBpm, endBpm, topBpm: r.ladder ? r.ladder.top : r.bpm, bars: d.bars,
    accuracy: d.accuracy, meanMs: d.meanMs, stdMs: d.stdMs, hitRate: d.hitRate, extras: d.extras, src: r.mode, drill: !!r.focus, latencyMs: r.mode === 'internal' ? settings.latencyMs : 0 });
  _lastDiag = d;
  renderDiag(d, r, endBpm);
  if (!r.focus) prevDiag = d;
  renderHeader(); renderTrend(); draw();
}
function setBpmFor(r, v) { cfg.bpm[r.meter.id + ':' + r.pattern.id] = v; save(); }
function renderDiag(d, r, endBpm) {
  const el = $('#bt-diag'); el.hidden = false;
  const tend = { rush: `抢拍 ${Math.round(-d.meanMs)} ms`, drag: `拖拍 ${Math.round(d.meanMs)} ms`, center: '不早不晚', unknown: '—' }[d.tendency];
  const stab = { steady: '很稳', ok: '还行', shaky: '不稳', unknown: '—' }[d.stability];
  const head = d.accuracy >= 0.9 ? '非常准！' : d.accuracy >= 0.75 ? '不错，还有几个地方可以更准' : d.accuracy >= 0.5 ? '有进步空间：先看最差的位置' : '先慢下来：速度降一点，每一下都弹到';
  let focusCmp = '';
  if (r.focus && d.focusStats && d.focusStats.length) {
    focusCmp = `<div class="bt-cmp">${d.focusStats.map((p) => {
      const before = prevDiag && prevDiag.positions.find((q) => q.key === p.key);
      return `<div><b>${esc(p.label)}</b>：现在平均偏 ${Math.round(p.meanAbsMs)} ms、漏 ${p.miss}${before ? `（专项前 ${Math.round(before.meanAbsMs)} ms、漏 ${before.miss}）${p.meanAbsMs < before.meanAbsMs - 3 ? ' ✓ 进步了' : ''}` : ''}</div>`;
    }).join('')}</div>`;
  }
  el.innerHTML = `
    <div class="bt-d-head"><div class="bt-score ${d.accuracy >= 0.85 ? 'ok' : d.accuracy >= 0.6 ? 'warn' : 'bad'}">${pct(d.accuracy)}</div>
      <div><b>${head}</b><small class="muted">${esc(r.pattern.name)} · ${r.meter.id} · ${r.mode === 'external' ? '外部节拍器 ' + r.bpm : r.startBpm + (endBpm !== r.startBpm ? ' → ' + endBpm : '')} BPM · ${d.bars} 小节${r.focus ? ' · 专项' : ''}</small></div></div>
    <div class="stats bt-stats">
      <div class="stat"><b class="${d.tendency === 'center' ? 'ok' : 'warn'}">${d.hit === 0 ? '—' : (d.meanMs > 0 ? '+' : '') + Math.round(d.meanMs)}<small>ms</small></b><span>倾向 · ${tend}</span></div>
      <div class="stat"><b class="${d.stability === 'steady' ? 'ok' : d.stability === 'ok' ? '' : 'warn'}">±${Math.round(d.stdMs)}<small>ms</small></b><span>稳定性 · ${stab}</span></div>
      <div class="stat"><b>${d.hit}/${d.expected}</b><span>弹到${d.extras ? ` · 多弹 ${d.extras}` : ''}</span></div>
      <div class="stat"><b>${d.grades.green}</b><span>绿（±${cfg.tolG}）</span></div>
      <div class="stat"><b>${d.grades.yellow}</b><span>黄（±${cfg.tolY}）</span></div>
      <div class="stat"><b>${d.okBars}/${d.bars}</b><span>达标小节</span></div>
    </div>
    <h3>每个位置：平均早晚（竖线 = 忽早忽晚的范围）</h3>
    ${posChart(d, r)}
    ${focusCmp}
    <ul class="bt-tips">${d.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="row wrap">
      ${d.drill ? `<button id="bt-drill" class="btn primary">🎯 专项练习：盯住 ${esc(d.drill.labels.join('、'))} · ${d.drill.bpm} BPM${r.mode === 'external' ? '（请把外部节拍器调到这个速度）' : ''}</button>` : ''}
      <button id="bt-again" class="btn ${d.drill ? '' : 'primary'}">再来一次${r.mode === 'internal' && cfg.ladder && !r.focus ? `（${curBpm()} BPM）` : ''}</button>
      ${d.accuracy >= 0.9 && r.mode === 'internal' ? `<button id="bt-faster" class="btn">快一点 +4</button>` : ''}
    </div>`;
  const dr = $('#bt-drill');
  if (dr) dr.onclick = () => start({ bpm: d.drill.bpm, focus: d.drill.focus, labels: d.drill.labels });
  $('#bt-again').onclick = () => start();
  const f = $('#bt-faster'); if (f) f.onclick = () => { setBpm(curBpm() + 4); start(); };
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function posChart(d, r) {
  const cells = gridCells(r.pattern, r.meter), P = d.positions, W = Math.max(300, P.length * 48), H = 170, mid = 78, sc = 58 / 100;
  if (!P.length) return '';
  const cw = (W - 30) / P.length, worst = new Set(d.drill ? d.drill.focus : d.worst.map((p) => p.key)), focus = new Set(r.focus || []);
  const col = (p) => (p.hit === 0 ? 'var(--bad)' : p.meanAbsMs <= cfg.tolG ? 'var(--ok)' : p.meanAbsMs <= cfg.tolY ? 'var(--warn)' : 'var(--bad)');
  const clamp = (v) => Math.max(-100, Math.min(100, v));
  const parts = P.map((p, i) => {
    const x = 30 + cw * (i + 0.5), cell = cells.find((c) => c.key === p.key), lbl = cell ? shortLabel(cell, r.meter) : '';
    const y0 = mid, y1 = mid + clamp(p.meanMs) * sc, top = Math.min(y0, y1), h = Math.max(1.5, Math.abs(y1 - y0)), bw = Math.min(26, cw * 0.5);
    const ws = clamp(p.meanMs + p.stdMs) * sc, we = clamp(p.meanMs - p.stdMs) * sc;
    return `<g>${worst.has(p.key) || focus.has(p.key) ? `<rect x="${x - cw / 2 + 2}" y="4" width="${cw - 4}" height="${H - 8}" rx="8" fill="var(--accent-bg)"/>` : ''}
      ${p.hit ? `<rect x="${x - bw / 2}" y="${top}" width="${bw}" height="${h}" rx="4" fill="${col(p)}"/><line x1="${x}" x2="${x}" y1="${mid + ws}" y2="${mid + we}" stroke="var(--fg)" stroke-width="1.5" opacity=".55"/>` : ''}
      <text x="${x}" y="${H - 8}" text-anchor="middle" font-size="12" fill="var(--muted)">${esc(lbl)}${p.dir === 'D' ? '↓' : p.dir === 'U' ? '↑' : ''}</text>
      <text x="${x}" y="${p.meanMs > 0 ? Math.min(top + h + 13, H - 22) : Math.max(top - 4, 12)}" text-anchor="middle" font-size="10.5" fill="var(--fg)">${p.hit ? (p.meanMs > 0 ? '+' : '') + Math.round(p.meanMs) : ''}${p.miss ? ` ×${p.miss}` : ''}</text></g>`;
  }).join('');
  return `<svg class="bt-pos" viewBox="0 0 ${W} ${H}">
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>
    <text x="4" y="${mid - 40}" font-size="11" fill="var(--muted)">早</text><text x="4" y="${mid + 48}" font-size="11" fill="var(--muted)">晚</text><text x="4" y="${mid + 4}" font-size="10" fill="var(--faint)">0</text>${parts}</svg>`;
}
// ---------------- 趋势 ----------------
function renderTrend() {
  const all = loadHistory().filter((e) => e.type === 'beat');
  const p = curPattern(), mine = all.filter((e) => e.pat === p.id && e.meter === cfg.meter);
  const last = all.slice(-16), svg = $('#bt-spark');
  if (!last.length) { svg.innerHTML = ''; $('#bt-trend-t').textContent = '练完一次就会在这里看到准确率的变化。'; $('#bt-best').textContent = ''; return; }
  const W = 300, H = 70, x = (i) => (last.length === 1 ? W / 2 : 8 + (i / (last.length - 1)) * (W - 16)), y = (a) => H - 6 - a * (H - 14);
  svg.innerHTML = `<line x1="0" x2="${W}" y1="${y(0.85)}" y2="${y(0.85)}" stroke="var(--ok)" stroke-dasharray="3 3" opacity=".5"/>
    <polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${last.map((e, i) => `${x(i)},${y(e.accuracy || 0)}`).join(' ')}"/>` +
    last.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.accuracy || 0)}" r="${e.pat === p.id ? 4 : 2.5}" fill="${e.pat === p.id ? 'var(--accent)' : 'var(--faint)'}"><title>${esc(e.name)} ${e.bpm} BPM ${Math.round((e.accuracy || 0) * 100)}%</title></circle>`).join('');
  const good = mine.filter((e) => (e.accuracy || 0) >= 0.85 && e.src !== 'external');
  $('#bt-best').textContent = good.length ? `「${p.name}」最快达标 ${Math.max(...good.map((e) => e.topBpm || e.bpm))} BPM` : '';
  const recent = mine.slice(-5);
  const sdT = recent.length >= 2 ? `；最近 ${recent.length} 次稳定性 ±${Math.round(recent[0].stdMs)} → ±${Math.round(recent[recent.length - 1].stdMs)} ms` : '';
  $('#bt-trend-t').textContent = `最近 ${last.length} 次练习的准确率（虚线 = 85%；大点 = 当前节奏型）。「${p.name}」练了 ${mine.length} 次${sdT}。`;
}
// 调试 / 端到端测试用
let _lastDiag = null;
export const beatDebug = () => run;
export const lastDiag = () => _lastDiag;
