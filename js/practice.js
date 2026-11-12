// practice.js — 练曲子 / 认识指板 的练习界面：滚动六线谱、指板提示、音高判定、「等我」和「跟拍」两种模式
import { $, $$, esc, settings, engine, metro, needMic, onPitch, onOnset, addHistory, css, fmtC, pct, posText } from './core.js';
import { parseSong } from './songs.js';
import { NoteSequenceTracker, centsBetween, midiToFreq, midiName, matchOnsets, summarizeRhythm, noteFromFreq } from './dsp.js';
import { drawBoard, markBoard } from './fretboard.js';

let S = null;          // 当前练习
let rafOn = false;
let onsetPending = false;

export function openPractice(song, opts = {}) {
  stopAll();
  const notes = parseSong(song);
  const pitched = notes.map((n, i) => ({ ...n, i })).filter((n) => n.midi !== null);
  S = {
    song, notes, pitched, drill: !!opts.drill, names: !!opts.names, onDone: opts.onDone,
    mode: opts.drill ? 'wait' : (S && S.lastMode) || 'wait', bpm: song.bpm,
    running: false, demo: false, res: [], pos: pitched[0].start, idx: 0,
  };
  resetRun();
  $('#p-title').textContent = song.title;
  const strs = [...new Set(pitched.map((n) => n.string))].sort();
  $('#p-meta').textContent = S.drill ? `${pitched.length} 个音 · ${strs.map((s) => s + '弦').join(' ')}` : `${song.en} · ${song.beats}/4 · ${pitched.length} 个音 · 用到 ${strs.join('、')} 弦`;
  $('#p-tip').textContent = song.tip || '';
  $('#p-mode').hidden = S.drill;
  $('#p-demo').hidden = S.drill;
  $('.tempo').hidden = S.drill;
  $('#p-tempo').value = S.bpm; $('#p-bpm').textContent = S.bpm;
  $$('#p-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
  drawBoard($('#p-board'));
  setFeedback(S.drill ? '看指板上的位置，弹出来' : '先点「示范」听一遍，再点「开始」', '');
  updateNow();
  if (!rafOn) { rafOn = true; requestAnimationFrame(drawLoop); }
}

export function closePractice() { stopAll(); S = null; }

function resetRun() {
  S.res = S.pitched.map(() => ({ state: 'pending', attempts: 0, cents: null, frames: [] }));
  S.idx = 0; S.pos = S.pitched[0].start; S.onsets = []; S.startedAt = 0;
  S.tracker = new NoteSequenceTracker(S.pitched.map((n) => n.midi), { tolCents: settings.tolCents, stableFrames: 3, a4: settings.a4, octaveFree: settings.octaveFree || S.names }); // 只看音名：任何八度都算对
}

function stopAll() {
  if (!S) return;
  S.running = false; S.demo = false;
  metro.stop();
  (S.demoSrc || []).forEach((s) => { try { s.stop(); } catch {} });
  S.demoSrc = [];
  clearTimeout(S.countTimer);
  $('#lane-msg').textContent = '';
  $('#p-start').textContent = '开始'; $('#p-demo').textContent = '示范';
}

// ---------- 控件 ----------
$$('#p-mode button').forEach((b) => (b.onclick = () => {
  if (!S) return;
  stopAll(); S.mode = S.lastMode = b.dataset.v; resetRun();
  $$('#p-mode button').forEach((x) => x.classList.toggle('on', x === b));
  setFeedback(S.mode === 'wait' ? '等我：弹对了才往下走，不用管快慢' : '跟拍：先响 1 小节预备拍，然后跟着节拍弹', '');
  updateNow();
}));
$('#p-tempo').oninput = (e) => { if (!S) return; S.bpm = +e.target.value; $('#p-bpm').textContent = S.bpm; };
$('#p-start').onclick = async () => {
  if (!S) return;
  if (S.running || S.demo) { stopAll(); setFeedback('已暂停', ''); return; }
  if (!(await needMic())) return;
  await engine.unlock();
  if (S.tracker.done || S.res.some((r) => r.state !== 'pending')) resetRun();
  S.running = true; S.startedAt = performance.now();
  $('#p-start').textContent = '停止';
  if (S.mode === 'wait') { setFeedback('开始弹吧 🎸', ''); updateNow(); }
  else startAlong();
};
$('#p-restart').onclick = () => { if (!S) return; stopAll(); resetRun(); updateNow(); setFeedback('从头开始', ''); };
$('#p-demo').onclick = async () => {
  if (!S) return;
  if (S.demo) { stopAll(); return; }
  stopAll(); resetRun();
  await engine.unlock();
  const spb = 60 / S.bpm, t0 = engine.ctx.currentTime + 0.4;
  S.demo = true; S.t0 = t0; S.spb = spb; S.demoSrc = [];
  for (const n of S.pitched) S.demoSrc.push(engine.pluck(n.midi, t0 + n.start * spb, n.beats * spb * 0.95, 0.85));
  const end = S.pitched[S.pitched.length - 1];
  S.demoEnd = t0 + (end.start + end.beats) * spb;
  $('#p-demo').textContent = '停止示范';
  setFeedback('🔊 示范中，跟着看谱', '');
};
$('#p-now').onclick = () => { const n = S && S.pitched[S.idx]; if (n) { engine.unlock(); engine.pluck(n.midi); } };

// ---------- 跟拍模式 ----------
function startAlong() {
  const spb = 60 / S.bpm, beats = S.song.beats;
  metro.set({ bpm: S.bpm, beatsPerBar: beats, subdiv: 1 });
  metro.sound = settings.outMode !== 'silent'; metro.accent = true; metro.volume = settings.volume;
  const offset = S.song.pickup ? beats - S.song.pickup : 0;
  const last = S.pitched[S.pitched.length - 1];
  const totalTicks = beats + offset + Math.ceil(last.start + last.beats);
  metro.onTick = (time, info) => {
    if (info.index >= totalTicks) { metro.stop(); return; }
    if (info.index < beats) { // 预备拍倒数
      const d = Math.max(0, (time - engine.ctx.currentTime) * 1000);
      S.countTimer = setTimeout(() => { if (S && S.running) $('#lane-msg').textContent = String(beats - info.index); }, d);
      setTimeout(() => { if (S && S.running && info.index === beats - 1) $('#lane-msg').textContent = ''; }, d + spb * 900);
    }
  };
  const T = metro.start(0.35);
  S.spb = spb; S.t0 = T + (beats + offset) * spb;
  S.lastEnd = S.t0 + (last.start + last.beats) * spb;
  setFeedback('听预备拍…', '');
}

function alongFrame(fr) {
  const lat = settings.latencyMs / 1000, t = fr.time - lat;
  for (let k = S.idx; k < S.pitched.length; k++) {
    const n = S.pitched[k], ts = S.t0 + n.start * S.spb, d = n.beats * S.spb;
    const w0 = ts + Math.min(0.06, d * 0.15), w1 = ts + Math.max(0.12, d * 0.9);
    if (t < w0) break;
    if (t <= w1) { if (fr.raw) S.res[k].frames.push(centsTo(fr.raw, n.midi)); break; }
    // 这个音的判定窗口已过：结算
    judgeAlong(k); S.idx = k + 1;
  }
  if (t > S.lastEnd + 0.35) finish();
}
function judgeAlong(k) {
  const r = S.res[k], n = S.pitched[k];
  if (r.state !== 'pending') return;
  const good = r.frames.filter((c) => Math.abs(c) <= settings.tolCents);
  const ok = r.frames.length > 0 && good.length >= Math.max(1, Math.ceil(r.frames.length * 0.3));
  r.state = ok ? 'hit' : 'miss';
  r.cents = good.length ? good.reduce((a, b) => a + b, 0) / good.length : (r.frames.length ? median(r.frames) : null);
  if (ok) setFeedback(`✓ ${n.name}`, 'ok');
  else if (!r.frames.length) setFeedback(`没听到 ${n.name}`, 'bad');
  else setFeedback(`✗ ${n.name} ${Math.abs(r.cents) < 100 ? (r.cents > 0 ? '偏高' : '偏低') : '音不对'}`, 'bad');
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function centsTo(freq, midi) {
  let c = centsBetween(freq, midiToFreq(midi, settings.a4));
  if (settings.octaveFree) c -= 1200 * Math.round(c / 1200);
  return c;
}

// ---------- 数据输入 ----------
onOnset((t) => { onsetPending = true; if (S && S.running && S.mode === 'along') S.onsets.push(t); });
onPitch((fr) => {
  if (!S || $('#v-play').hidden) return;
  // 「听到」显示
  const hb = $('#p-heard');
  hb.classList.toggle('dim', !fr.freq);
  if (fr.show) {
    const n = noteFromFreq(fr.show, settings.a4), cur = S.pitched[S.idx];
    $('#p-heard-note').textContent = n.name + n.octave;
    const c = cur ? centsTo(fr.show, cur.midi) : null;
    $('#p-heard-c').textContent = c !== null && Math.abs(c) < 100 ? fmtC(c) + ' 音分' : '';
  } else { $('#p-heard-note').textContent = '—'; $('#p-heard-c').textContent = ''; }
  if (!S.running || S.demo) { onsetPending = false; return; }
  if (S.mode === 'along') { alongFrame(fr); return; }
  // 等我模式
  const ev = S.tracker.update({ freq: fr.raw, time: fr.time, onset: onsetPending });
  onsetPending = false;
  if (!ev) return;
  const r = S.res[ev.index], n = S.pitched[ev.index];
  r.attempts++;
  if (ev.type === 'hit') {
    r.state = r.attempts > 1 ? 'retry' : 'hit'; r.cents = ev.cents;
    S.idx = ev.index + 1;
    setFeedback(`✓ ${n.name}${Math.abs(ev.cents) > 12 ? `  ${fmtC(ev.cents)} 音分` : ''}`, 'ok');
    updateNow();
    if (S.tracker.done) setTimeout(finish, 350);
  } else if (Math.abs(ev.cents) < 100) {
    setFeedback(`${ev.cents > 0 ? '偏高' : '偏低'} ${Math.abs(Math.round(ev.cents))} 音分，再来`, 'warn');
  } else {
    const want = posText(n.string, n.fret);
    setFeedback(`弹成了 ${midiName(ev.playedMidi)} · 应该是 ${want}`, 'bad');
  }
});

function setFeedback(txt, cls) {
  const el = $('#p-feedback');
  el.textContent = txt; el.className = 'feedback' + (cls ? ' ' + cls : '');
  if (cls) { void el.offsetWidth; el.classList.add('pop'); }
}
function updateNow() {
  const n = S.pitched[S.idx], nx = S.pitched[S.idx + 1];
  if (!n) { $('#p-pos').textContent = '完成'; $('#p-note').textContent = ''; markBoard($('#p-board'), null, null); return; }
  if (S.names) { $('#p-pos').textContent = n.name.replace(/\d+$/, ''); $('#p-note').textContent = `${n.name} · 在哪根弦？`; }
  else { $('#p-pos').textContent = posText(n.string, n.fret); $('#p-note').textContent = `${n.name}${nx ? ' · 下一个 ' + posText(nx.string, nx.fret) : ''}`; }
  markBoard($('#p-board'), S.names ? null : n, S.names ? null : nx);
}

// ---------- 结束 ----------
function finish() {
  if (!S || !S.running) return;
  const along = S.mode === 'along';
  if (along) for (let k = S.idx; k < S.pitched.length; k++) judgeAlong(k);
  S.running = false; metro.stop();
  $('#p-start').textContent = '开始';
  const total = S.pitched.length;
  const hits = S.res.filter((r) => r.state === 'hit' || r.state === 'retry').length;
  const first = S.res.filter((r) => r.state === 'hit').length;
  const centsArr = S.res.filter((r) => r.cents !== null && r.state !== 'miss').map((r) => Math.abs(r.cents));
  const avgC = centsArr.length ? centsArr.reduce((a, b) => a + b, 0) / centsArr.length : 0;
  let score, stats, rhythm = null;
  const secs = Math.round((performance.now() - S.startedAt) / 1000);
  if (along) {
    const starts = S.pitched.map((n) => S.t0 + n.start * S.spb);
    let minGap = Infinity; for (let i = 1; i < starts.length; i++) minGap = Math.min(minGap, starts[i] - starts[i - 1]);
    const m = matchOnsets(S.onsets.filter((o) => o > S.t0 - 0.3 && o < S.lastEnd + 0.3), starts, { latencyMs: settings.latencyMs, windowMs: Math.min(150, (minGap * 1000) / 2) });
    rhythm = summarizeRhythm(m);
    const pitchAcc = hits / total;
    score = 0.6 * pitchAcc + 0.4 * rhythm.accuracy;
    stats = [[pct(pitchAcc), '音准'], [pct(rhythm.accuracy), '节奏'], [Math.round(rhythm.meanAbsErrorMs) + 'ms', '平均早/晚']];
  } else {
    const attempts = S.res.reduce((a, r) => a + r.attempts, 0);
    const acc = attempts ? hits / attempts : 0;
    score = 0.5 * acc + 0.5 * (first / total);
    stats = [[pct(first / total), '一次弹对'], [pct(acc), '命中率'], [secs + 's', '用时']];
  }
  const stars = score >= 0.9 ? 3 : score >= 0.7 ? 2 : score >= 0.4 ? 1 : 0;
  // 难点
  const tr = new Map();
  S.res.forEach((r, k) => {
    const bad = along ? (r.state === 'miss' ? 1 : 0) : Math.max(0, r.attempts - 1);
    if (!bad) return;
    const n = S.pitched[k], key = `${n.string}-${n.fret}`;
    const e = tr.get(key) || { n, c: 0 }; e.c += bad; tr.set(key, e);
  });
  const trouble = [...tr.values()].sort((a, b) => b.c - a.c).slice(0, 3);
  const songTitle = S.song.title;
  addHistory({ type: S.drill ? 'drill' : 'song', id: S.song.id, title: songTitle, mode: S.mode, stars, score: Math.round(score * 100),
    pitch: Math.round((hits / total) * 100), rhythm: rhythm ? Math.round(rhythm.accuracy * 100) : null, avgCents: Math.round(avgC), bpm: S.bpm, seconds: secs });
  // 弹窗
  $('#r-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('#r-title').textContent = stars === 3 ? '太棒了！' : stars === 2 ? '很不错！' : stars === 1 ? '完成了，继续加油' : '再试一次吧';
  $('#r-stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#r-trouble').innerHTML = (trouble.length
    ? `<div class="trouble">要多练的位置：${trouble.map((t) => `<b>${posText(t.n.string, t.n.fret)}</b>（${t.n.name}）×${t.c}`).join('，')}</div>` : '') +
    (along && rhythm && Math.abs(rhythm.meanErrorMs) > 25 ? `<div class="trouble">整体${rhythm.meanErrorMs > 0 ? '偏晚（拖拍）' : '偏早（抢拍）'} ${Math.abs(Math.round(rhythm.meanErrorMs))} ms${settings.latencyMs === 0 ? '，还没校准延迟，去设置里校准一下' : ''}</div>` : '') +
    (!along && stars >= 2 && !S.drill ? `<div class="trouble">下一步：试试「跟拍」模式，或者把速度调快一点。</div>` : '') +
    (avgC > 15 ? `<div class="trouble">平均偏差 ${Math.round(avgC)} 音分：先去「调音」把琴调准，按弦时手指靠近品丝。</div>` : '');
  $('#result').hidden = false;
  setFeedback(`完成 ${'★'.repeat(stars)}`, 'ok');
  updateNow();
  if (S.onDone) S.onDone();
}
$('#r-again').onclick = () => { $('#result').hidden = true; if (S) { resetRun(); updateNow(); $('#p-start').click(); } };
$('#r-close').onclick = () => { $('#result').hidden = true; };

// ---------- 六线谱滚动画布 ----------
let colors = null, colorTheme = '';
function drawLoop() {
  requestAnimationFrame(drawLoop);
  if (!S || $('#v-play').hidden) return;
  const cv = $('#lane'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const theme = document.documentElement.dataset.theme;
  if (colorTheme !== theme) { colorTheme = theme; colors = { fg: css('--fg'), muted: css('--muted'), faint: css('--faint'), line: css('--line'), card2: css('--card-2'), accent: css('--accent'), ok: css('--ok'), warn: css('--warn'), bad: css('--bad') }; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const ppb = Math.max(58, Math.min(110, W / 7.5)), hitX = Math.round(W * 0.24);
  // 位置（以拍为单位）
  if ((S.mode === 'along' && S.running) || S.demo) {
    const outLat = (engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0);
    S.pos = (engine.ctx.currentTime - outLat - S.t0) / S.spb;
    if (S.demo) {
      const k = S.pitched.findIndex((n) => n.start + n.beats > S.pos);
      if (k >= 0 && k !== S.idx) { S.idx = k; updateNow(); }
      if (engine.ctx.currentTime > S.demoEnd + 0.3) { stopAll(); S.idx = 0; S.pos = S.pitched[0].start; updateNow(); setFeedback('示范结束，点「开始」自己弹', ''); }
    } else if (S.idx < S.pitched.length) {
      // 跟拍：显示上“现在弹”跟随时间
      const k = S.pitched.findIndex((n) => n.start + n.beats > S.pos + 0.02);
      if (k >= 0 && k !== S.shown) { S.shown = k; const save = S.idx; S.idx = Math.max(k, 0); updateNow(); S.idx = save; }
    }
  } else {
    const n = S.pitched[Math.min(S.idx, S.pitched.length - 1)];
    const target = S.idx >= S.pitched.length ? n.start + n.beats : n.start;
    S.pos += (target - S.pos) * 0.16;
  }
  const top = 22, bottom = H - 18, gap = (bottom - top) / 5, y = (s) => top + (s - 1) * gap;
  // 拍线与小节线
  const b0 = Math.floor(S.pos - hitX / ppb) - 1, b1 = Math.ceil(S.pos + (W - hitX) / ppb) + 1;
  const pk = S.song.pickup || 0, beats = S.song.beats;
  for (let b = b0; b <= b1; b++) {
    const x = hitX + (b - S.pos) * ppb;
    const bar = ((b - pk) % beats + beats) % beats === 0;
    g.strokeStyle = bar ? colors.line : colors.line + '66'; g.lineWidth = bar ? 1.5 : 1;
    g.beginPath(); g.moveTo(x, top - 8); g.lineTo(x, bottom + 8); g.stroke();
  }
  // 六根弦
  for (let s = 1; s <= 6; s++) {
    g.strokeStyle = colors.faint; g.lineWidth = 0.6 + s * 0.22;
    g.beginPath(); g.moveTo(0, y(s)); g.lineTo(W, y(s)); g.stroke();
  }
  // 判定线
  const grd = g.createLinearGradient(hitX - 26, 0, hitX + 26, 0);
  grd.addColorStop(0, 'transparent'); grd.addColorStop(0.5, colors.accent + '33'); grd.addColorStop(1, 'transparent');
  g.fillStyle = grd; g.fillRect(hitX - 26, 0, 52, H);
  g.strokeStyle = colors.accent; g.lineWidth = 2.5; g.beginPath(); g.moveTo(hitX, 6); g.lineTo(hitX, H - 6); g.stroke();
  // 音符
  g.textAlign = 'center'; g.textBaseline = 'middle';
  S.pitched.forEach((n, k) => {
    const x = hitX + (n.start - S.pos) * ppb;
    const len = n.beats * ppb;
    if (x + len < -40 || x > W + 40) return;
    const r = S.res[k], cur = k === S.idx && (S.running || S.demo || S.mode === 'wait');
    const col = r.state === 'hit' ? colors.ok : r.state === 'retry' ? colors.warn : r.state === 'miss' ? colors.bad : cur ? colors.accent : null;
    const yy = y(n.string);
    // 时值尾巴
    g.fillStyle = (col || colors.muted) + '30';
    roundRect(g, x, yy - 5, Math.max(8, len - 8), 10, 5); g.fill();
    // 音头
    const w = 30, hh = Math.min(26, gap + 4);
    g.fillStyle = col || colors.card2;
    if (cur) { g.shadowColor = colors.accent; g.shadowBlur = 14; }
    roundRect(g, x - w / 2, yy - hh / 2, w, hh, 8); g.fill();
    g.shadowBlur = 0;
    if (!col) { g.strokeStyle = colors.line; g.lineWidth = 1; g.stroke(); }
    g.fillStyle = col ? '#fff' : colors.fg;
    g.font = `700 ${S.names ? 11 : 14}px ${css('--font') || 'sans-serif'}`;
    g.fillText(S.names ? n.name.replace(/\d+$/, '') : String(n.fret), x, yy + 0.5);
  });
  // 左侧弦号
  g.fillStyle = colors.muted; g.font = `600 10px sans-serif`; g.textAlign = 'left';
  for (let s = 1; s <= 6; s++) { g.fillStyle = colors.card2; g.fillRect(0, y(s) - 7, 16, 14); g.fillStyle = colors.muted; g.fillText(String(s), 4, y(s) + 1); }
  // 进度
  const done = S.res.filter((r) => r.state !== 'pending').length;
  g.fillStyle = colors.accent; g.fillRect(0, H - 3, (W * done) / S.pitched.length, 3);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export const practiceState = () => S;
