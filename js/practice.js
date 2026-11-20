import { renderMelody, markMelody, melodyTonic } from './melody-score.js';
import { pitchLabels } from './note-names.js';
import { annotate, phrases, sliceRange, barLabel, rangeLabel, reviewPhrase, difficulty } from './phrase.js';
// practice.js — 练曲子 / 认识指板 的练习界面：滚动六线谱、指板提示、音高判定、「等我」和「跟拍」两种模式
import { $, $$, esc, settings, engine, metro, needMic, releaseMicForPlayback, onPitch, onOnset, onMic, onSettings, addHistory, loadHistory, saveResume, css, fmtC, pct, posText } from './core.js';
import { parseSong } from './songs.js';
import { NoteSequenceTracker, centsBetween, midiToFreq, midiName, summarizeRhythm, noteFromFreq, snapCents } from './dsp.js';
import { diag, logDiag } from './diag.js';
import { drawBoard, markBoard } from './fretboard.js';

let S = null;          // 当前练习
let rafOn = false;
let onsetPending = false;

export function openPractice(song, opts = {}) {
  stopAll();
  const notes = annotate(parseSong(song), song.beats, song.pickup || 0);
  const pitched = notes.map((n, i) => ({ ...n, i })).filter((n) => n.midi !== null);
  S = {
    song, notes, pitched, fullNotes: notes, ranges: phrases(notes, song.pickup), range: null, parent: null, focusBar: null, guide: 'full', drill: !!opts.drill, names: !!opts.names, onDone: opts.onDone,
    mode: opts.drill ? 'wait' : (S && S.lastMode) || 'wait', bpm: song.bpm,
    running: false, demo: false, res: [], pos: pitched[0].start, idx: 0,
  };
  const saved = opts.resume;
  if (!S.drill && saved?.id === song.id) {
    S.mode = saved.mode === 'along' ? 'along' : 'wait';
    S.bpm = Math.max(40, Math.min(160, Number(saved.bpm) || song.bpm));
    S.guide = ['tab','memory'].includes(saved.guide) ? saved.guide : 'full';
    S.hard = saved.hard && validRange([saved.hard.bar, saved.hard.bar]) ? saved.hard : null;
    S.range = validRange(saved.range); S.parent = validRange(saved.parent);
    S.focusBar = Number.isInteger(saved.focusBar) ? saved.focusBar : null;
  }
  $('#v-play').dataset.melody = String(!S.drill);
  $('#p-phrase').hidden = S.drill;
  $('#p-loop').checked = false;
  $('#p-guide').value = S.guide;
  $('#v-play').dataset.guide = S.guide;
  $('#p-range').innerHTML = '<option value="">整首</option>' + S.ranges.map((r,i) => `<option value="${i}">${rangeLabel(r)}</option>`).join('');
  applyRange();
  $('#p-title').textContent = song.title;
  const strs = [...new Set(pitched.map((n) => n.string))].sort();
  $('#p-meta').textContent = S.drill ? `${pitched.length} 个音 · ${strs.map((s) => s + '弦').join(' ')}` : `${song.en} · ${song.beats}/4 · ${pitched.length} 个音`;
  $('#p-tip').textContent = S.drill ? song.tip || '' : '先认音名和唱名，再跟着简谱弹；点当前音可以试听。';
  $('#p-mode').hidden = S.drill;
  $('#p-demo').hidden = S.drill;
  $('.tempo').hidden = S.drill;
  $('#p-tempo').value = S.bpm; $('#p-bpm').textContent = S.bpm;
  $$('#p-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
  drawBoard($('#p-board'));
  setFeedback(S.drill ? '看指板上的位置，弹出来' : '先点「示范」听一遍，再点「开始」', '');
  updateNow();
  if (!rafOn) { rafOn = true; requestAnimationFrame(drawLoop); }
  logDiag('practice', practiceSnapshot('open'));
}

export function closePractice() { stopAll(); S = null; }

function validRange(r) {
  if (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isInteger)) return null;
  return r[0] >= S.fullNotes[0].bar && r[1] <= S.fullNotes.at(-1).bar && r[0] <= r[1] &&
    S.fullNotes.some(n => n.midi !== null && n.bar >= r[0] && n.bar <= r[1]) ? r : null;
}
function applyRange() {
  S.notes = sliceRange(S.fullNotes, S.range, S.song.beats, S.song.pickup || 0);
  S.pitched = S.notes.filter(n => n.midi !== null);
  S.pickup = !S.range || S.range[0] === 0 ? S.song.pickup || 0 : 0;
  const selected = S.ranges.findIndex(r => String(r) === String(S.parent || S.range));
  $('#p-range').value = selected < 0 ? '' : String(selected);
  $('#p-loop').disabled = !S.range;
  $('#p-scope').textContent = rangeLabel(S.range);
  $('#p-return').hidden = !S.parent;
  $('#p-previous-hard').hidden = !S.hard || S.focusBar !== null;
  if (S.hard) $('#p-previous-hard').textContent = '重练' + barLabel(S.hard.bar);
  renderMelody(S);
  resetRun();
}
function remember() {
  if (!S || S.drill) return;
  const { range, parent, focusBar, bpm, guide, mode } = S;
  saveResume({ id: S.song.id, range, parent, focusBar, bpm, guide, mode, hard: S.hard ?? null, label: rangeLabel(range) });
}
function changeRange(range, start = false) {
  stopAll(); S.range = validRange(range); applyRange(); updateNow(); remember();
  $('#result').hidden = true;
  setFeedback(rangeLabel(S.range) + ' · 准备好就点开始', '');
  if (start) $('#p-start').click();
}
$('#p-range').onchange = e => {
  S.parent = null; S.focusBar = null; S.hard = null;
  changeRange(e.target.value === '' ? null : S.ranges[Number(e.target.value)]);
};
$('#p-guide').onchange = e => { S.guide = e.target.value; $('#v-play').dataset.guide = S.guide; remember(); };
$('#p-previous-hard').onclick = $('#r-focus').onclick = () => {
  const bar = S.hard.bar;
  S.parent = S.parent || S.ranges.find(r => r[0] <= bar && r[1] >= bar);
  S.focusBar = bar; changeRange([bar, bar], true);
};
$('#r-lead').onclick = () => changeRange([Math.max(S.fullNotes[0].bar, S.focusBar - 1), S.focusBar], true);
$('#p-return').onclick = $('#r-parent').onclick = () => {
  const range = S.parent; S.parent = null; S.focusBar = null; changeRange(range, true);
};
function resetRun() {
  S.res = S.pitched.map(() => ({ state: 'pending', attempts: 0, cents: null }));
  onsetPending = false; S.shown = -1; S.samples = []; S.idx = 0; S.pos = S.pitched[0].start; S.onsets = []; S.startedAt = 0;
  S.tracker = new NoteSequenceTracker(S.pitched.map((n) => n.midi), { tolCents: settings.tolCents, stableFrames: 3, a4: settings.a4, octaveFree: settings.octaveFree || S.names }); // 只看音名：任何八度都算对
}
function syncTrackerSettings() {
  if (!S || !S.tracker) return;
  S.tracker.tol = settings.tolCents;
  S.tracker.a4 = settings.a4;
  S.tracker.octaveFree = settings.octaveFree || S.names;
}
onSettings(syncTrackerSettings);
onMic(state => {
  if (state === 'off' && S?.running) {
    stopAll();
    setFeedback('麦克风已关闭，本轮已暂停。点开始重新练。', 'warn');
  }
});

function stopAll() {
  if (!S) return;
  const wasRunning = S.running;
  $('#p-guide').disabled = false; $('#p-tempo').disabled = false;
  S.running = false; S.demo = false;
  metro.stop();
  (S.demoSrc || []).forEach((s) => { try { s.stop(); } catch {} });
  S.demoSrc = [];
  clearTimeout(S.countTimer); clearTimeout(S.finishTimer);
  S.request = null;
  $('#lane-msg').textContent = '';
  $('#p-start').textContent = '开始'; $('#p-demo').textContent = '示范';
  if (wasRunning) logDiag('practice', practiceSnapshot('stop'));
}

// ---------- 控件 ----------
$$('#p-mode button').forEach((b) => (b.onclick = () => {
  if (!S) return;
  stopAll(); S.mode = S.lastMode = b.dataset.v; resetRun(); remember();
  $$('#p-mode button').forEach((x) => x.classList.toggle('on', x === b));
  setFeedback(S.mode === 'wait' ? '等我：弹对了才往下走，不用管快慢' : '跟拍：先响 1 小节预备拍，然后跟着节拍弹', '');
  updateNow();
  logDiag('practice', practiceSnapshot('mode'));
}));
$('#p-tempo').oninput = (e) => { if (!S) return; S.bpm = +e.target.value; $('#p-bpm').textContent = S.bpm; remember(); };
$('#p-start').onclick = async () => {
  if (!S) return;
  if (S.running || S.demo) { stopAll(); setFeedback('已暂停', ''); return; }
  const session = S, request = Symbol(); S.request = request;
  if (!(await needMic())) return;
  await engine.unlock();
  if (S !== session || S.request !== request) return;
  remember();
  if (S.tracker.done || S.res.some((r) => r.state !== 'pending')) resetRun();
  $('#p-guide').disabled = true; $('#p-tempo').disabled = true;
  S.running = true; S.startedAt = performance.now();
  $('#p-start').textContent = '停止';
  logDiag('practice', practiceSnapshot('start'));
  if (S.mode === 'wait') { setFeedback('开始弹吧 🎸', ''); updateNow(); }
  else startAlong();
};
$('#p-restart').onclick = () => { if (!S) return; stopAll(); resetRun(); updateNow(); setFeedback('从头开始', ''); };
$('#p-demo').onclick = async () => {
  if (!S) return;
  if (S.demo) { stopAll(); return; }
  stopAll(); resetRun();
  releaseMicForPlayback('（示范时只播放；点「开始」会重新打开）');
  const session = S, request = Symbol(); S.request = request;
  await engine.unlock();
  if (S !== session || S.request !== request) return;
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
  const offset = S.pickup ? beats - S.pickup : 0;
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
  if (t >= S.t0 - 0.2 && t <= S.lastEnd + 0.2) S.samples.push({ time: fr.time, raw: fr.raw, status: fr.status });
  while (S.idx < S.pitched.length && t >= S.t0 + (S.pitched[S.idx].start + S.pitched[S.idx].beats) * S.spb) S.idx++;
  if (t > S.lastEnd + 0.35) finish();
}
function centsTo(freq, midi) {
  return snapCents(centsBetween(freq, midiToFreq(midi, settings.a4)), settings.octaveFree);
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
  // 等我模式（容差 / 标准音 / 八度选项中途改了立刻生效）
  syncTrackerSettings();
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
    logPracticeScore(ev, n, r, fr.time);
    if (S.tracker.done) S.finishTimer = setTimeout(finish, 350);
  } else if (Math.abs(ev.cents) < 100) {
    setFeedback(`${ev.cents > 0 ? '偏高' : '偏低'} ${Math.abs(Math.round(ev.cents))} 音分，再来`, 'warn');
    logPracticeScore(ev, n, r, fr.time);
  } else {
    const want = S.drill ? posText(n.string, n.fret) : n.name + ' · ' + pitchLabels(n.midi).fixed;
    setFeedback(`弹成了 ${midiName(ev.playedMidi)} · 应该是 ${want}`, 'bad');
    logPracticeScore(ev, n, r, fr.time);
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
  if (!S.drill) {
    const label = pitchLabels(n.midi, melodyTonic(S.song));
    $('#p-pos').textContent = label.name + ' · ' + label.fixed;
    $('#p-note').textContent = '简谱 ' + label.number + (nx ? ' · 下一个 ' + nx.name : '');
    markMelody(n.start); return;
  }
  if (S.names) { $('#p-pos').textContent = n.name.replace(/\d+$/, ''); $('#p-note').textContent = `${n.name} · 在哪根弦？`; }
  else { $('#p-pos').textContent = posText(n.string, n.fret); $('#p-note').textContent = `${n.name}${nx ? ' · 下一个 ' + posText(nx.string, nx.fret) : ''}`; }
  markBoard($('#p-board'), S.names ? null : n, S.names ? null : nx);
}

// ---------- 结束 ----------
function finish() {
  if (!S || !S.running) return;
  const along = S.mode === 'along';
  let review = null;
  if (along) {
    review = reviewPhrase(S.pitched, S.samples, S.onsets.filter(t => t >= S.t0 - 0.3 + settings.latencyMs / 1000 && t <= S.lastEnd + 0.3 + settings.latencyMs / 1000), { ...settings, t0: S.t0, spb: S.spb });
    review.rows.forEach((row,i) => {
      S.res[i].state = row.outcome; S.res[i].cents = row.cents;
      logDiag('score', { mode: 'along', index: i, targetMidi: S.pitched[i].midi, audioTime: S.t0 + S.pitched[i].start * S.spb,
        decision: row.outcome, frames: row.voiced, tolCents: settings.tolCents, octaveFree: settings.octaveFree, ...row });
    });
  }
  const rows = review?.rows || S.pitched.map((n,i) => ({ bar: n.bar, note: n.name, previous: S.pitched[i-1]?.name || null, outcome: S.res[i].state, errorMs: null }));
  S.hard = difficulty(rows);
  remember();
  $('#p-previous-hard').hidden = !S.hard || S.focusBar !== null;
  if (S.hard) $('#p-previous-hard').textContent = '重练' + barLabel(S.hard.bar);
  $('#p-guide').disabled = false; $('#p-tempo').disabled = false;
  S.running = false; metro.stop();
  $('#p-start').textContent = '开始';
  const total = S.pitched.length;
  const hits = S.res.filter((r) => r.state === 'hit' || r.state === 'retry').length;
  const first = S.res.filter((r) => r.state === 'hit').length;
  const centsArr = S.res.filter((r) => r.cents !== null && (r.state === 'hit' || r.state === 'retry')).map((r) => Math.abs(r.cents));
  const avgC = centsArr.length ? centsArr.reduce((a, b) => a + b, 0) / centsArr.length : 0;
  let score, stats, rhythm = null;
  const secs = Math.round((performance.now() - S.startedAt) / 1000);
  if (along) {
    rhythm = summarizeRhythm(review.match);
    score = review.pitch === null ? null : 0.6 * review.pitch + 0.4 * rhythm.accuracy;
    stats = [[review.pitch === null ? '未评' : pct(review.pitch), '音准'], [pct(rhythm.accuracy), '节奏'],
      [review.wrong, '音高不符'], [review.missing, '未检出拨弦'], [review.unclear, '没听清'], [review.rows.filter(r => r.recovered).length, '音高确认 · 起音未确认']];
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
    const bad = along ? (r.state === 'wrong' || r.state === 'missing' ? 1 : 0) : Math.max(0, r.attempts - 1);
    if (!bad) return;
    const n = S.pitched[k], key = `${n.string}-${n.fret}`;
    const e = tr.get(key) || { n, c: 0 }; e.c += bad; tr.set(key, e);
  });
  const trouble = [...tr.values()].sort((a, b) => b.c - a.c).slice(0, 3);
  const songTitle = S.song.title;
  const scopeLabel = rangeLabel(S.range), guideLabel = $('#p-guide').selectedOptions[0].textContent;
  const prior = loadHistory().reverse().find(e => e.id === S.song.id && e.scopeLabel === scopeLabel && e.guideLabel === guideLabel && e.bpm === S.bpm && e.mode === S.mode && e.score != null);
  addHistory({ scopeLabel, guideLabel, range: S.range, transition: S.hard, unclear: review?.unclear, wrong: review?.wrong, missing: review?.missing,
    type: S.drill ? 'drill' : 'song', id: S.song.id, title: songTitle, mode: S.mode, stars, score: score === null ? null : Math.round(score * 100),
    pitch: along ? (review.pitch === null ? null : Math.round(review.pitch * 100)) : Math.round(hits / total * 100), rhythm: rhythm ? Math.round(rhythm.accuracy * 100) : null, avgCents: centsArr.length ? Math.round(avgC) : null, bpm: S.bpm, seconds: secs });
  logDiag('practice', { ...practiceSnapshot('finish'), stars, score: score === null ? null : Math.round(score * 100), hits, total, avgCents: centsArr.length ? Math.round(avgC) : null, seconds: secs, rhythm: rhythm ? { accuracy: rhythm.accuracy, meanErrorMs: rhythm.meanErrorMs, meanAbsErrorMs: rhythm.meanAbsErrorMs } : null });
  // 弹窗
  $('#r-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
  $('#r-title').textContent = stars === 3 ? '太棒了！' : stars === 2 ? '很不错！' : stars === 1 ? '完成了，继续加油' : '再试一次吧';
  $('#r-stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#r-trouble').innerHTML = (trouble.length
    ? `<div class="trouble">要多练的音：${trouble.map((t) => `<b>${S.drill ? posText(t.n.string, t.n.fret) : pitchLabels(t.n.midi).fixed}</b>（${t.n.name}）×${t.c}`).join('，')}</div>` : '') +
    (along && rhythm && Math.abs(rhythm.meanErrorMs) > 25 ? `<div class="trouble">整体${rhythm.meanErrorMs > 0 ? '偏晚（拖拍）' : '偏早（抢拍）'} ${Math.abs(Math.round(rhythm.meanErrorMs))} ms${settings.latencyMs === 0 ? '，还没校准延迟，去设置里校准一下' : ''}</div>` : '') +
    (!along && stars >= 2 && !S.drill ? `<div class="trouble">下一步：试试「跟拍」模式，或者把速度调快一点。</div>` : '') +
    (avgC > 15 ? `<div class="trouble">平均偏差 ${Math.round(avgC)} 音分：先去「调音」把琴调准，按弦时手指靠近品丝。</div>` : '');
  if (score === null) { $('#r-title').textContent = '音高证据不足'; $('#r-stars').textContent = ''; }
  const hard = S.hard;
  const comparison = prior && score !== null ? ` 同范围同速度，上次 ${prior.score} 分，本次 ${Math.round(score * 100)} 分。` : '';
  const reason = hard && (hard.outcome === 'wrong' ? '音高不符' : hard.outcome === 'missing' ? '未检出拨弦' :
    hard.outcome === 'retry' ? '重复尝试' : `${hard.errorMs > 0 ? '晚' : '早'} ${Math.abs(hard.errorMs)} ms`);
  $('#r-review').textContent = (hard ? `${barLabel(hard.bar)} · ${hard.previous ? hard.previous + ' → ' : ''}${hard.note}：${reason}。` : '') + comparison;
  $('#r-phrase').hidden = S.drill;
  $('#r-focus').hidden = !hard || S.focusBar !== null;
  if (hard) $('#r-focus').textContent = '重练' + barLabel(hard.bar);
  $('#r-lead').hidden = S.focusBar === null || S.focusBar <= S.fullNotes[0].bar;
  $('#r-parent').hidden = !S.parent;
  S.samples = [];
  if (S.range && $('#p-loop').checked && !S.drill) {
    setFeedback(rangeLabel(S.range) + ' · 开始下一遍', '');
    resetRun(); updateNow(); $('#p-start').click(); return;
  }
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
  const W = S.drill ? cv.clientWidth : 600, H = cv.clientHeight || 180;
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
  if (!S.drill) {
    markMelody(S.mode === 'wait' && !S.demo ? (S.pitched[S.idx]?.start ?? Infinity) : S.pos);
    return;
  }
  const top = 22, bottom = H - 18, gap = (bottom - top) / 5, y = (s) => top + (s - 1) * gap;
  // 拍线与小节线
  const b0 = Math.floor(S.pos - hitX / ppb) - 1, b1 = Math.ceil(S.pos + (W - hitX) / ppb) + 1;
  const pk = S.pickup || 0, beats = S.song.beats;
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


function practiceSnapshot(action) {
  if (!S) return { action };
  const n = S.pitched[S.idx];
  return {
    action, mode: S.mode, running: !!S.running, bpm: S.bpm, idx: S.idx,
    song: S.song && (S.song.id || S.song.title), range: S.range, guide: S.guide,
    drill: !!S.drill, names: !!S.names,
    target: n ? { midi: n.midi, name: n.name, string: n.string, fret: n.fret } : null,
    tolCents: settings.tolCents, octaveFree: !!(settings.octaveFree || S.names), a4: settings.a4, latencyMs: settings.latencyMs,
  };
}
function logPracticeScore(ev, n, r, audioTime) {
  const raw = ev.freq != null ? centsBetween(ev.freq, midiToFreq(n.midi, settings.a4)) : null;
  const oct = raw != null && ev.cents != null ? Math.round((raw - ev.cents) / 1200) : 0;
  logDiag('score', {
    mode: 'wait', audioTime,
    decision: ev.type === 'hit' ? (r.attempts > 1 ? 'retry' : 'hit') : 'miss',
    index: ev.index, targetMidi: n.midi, targetName: n.name, string: n.string, fret: n.fret,
    freq: ev.freq ?? null, playedMidi: ev.playedMidi,
    cents: ev.cents, centsRaw: raw, octaveSnap: oct || undefined,
    tolCents: settings.tolCents, octaveFree: !!(settings.octaveFree || S.names), a4: settings.a4,
    attempts: r.attempts,
  });
}

diag.setContextProvider(() => {
  if (!S) return { view: typeof location !== 'undefined' ? (location.hash || '#home') : undefined };
  return { view: typeof location !== 'undefined' ? (location.hash || '#home') : undefined, practice: practiceSnapshot('context') };
});

export const practiceState = () => S;
