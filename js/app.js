import { AudioEngine, Metronome } from './audio.js';
import {
  detectPitch, noteFromFreq, midiToFreq, midiName, parseNoteName, centsBetween,
  OnsetDetector, matchOnsets, summarizeRhythm, estimateLatency, NoteSequenceTracker, gradeOf, rms,
} from './dsp.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const OPEN = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4（6→1 弦）
const STRING_LABEL = ['6 弦', '5 弦', '4 弦', '3 弦', '2 弦', '1 弦'];

// ---------------- 设置 / 存储 ----------------
const LS_SET = 'guitar-practice:settings', LS_HIST = 'guitar-practice:history';
const settings = Object.assign({ a4: 440, gateDb: -50, latencyMs: 0, sens: 3 }, safeJSON(localStorage.getItem(LS_SET)) || {});
function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }
function saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(settings)); }
function loadHistory() { return safeJSON(localStorage.getItem(LS_HIST)) || []; }
function addHistory(entry) {
  const h = loadHistory(); h.push(entry);
  while (h.length > 300) h.shift();
  localStorage.setItem(LS_HIST, JSON.stringify(h));
  renderHistory();
}
const gateRms = () => Math.pow(10, settings.gateDb / 20);
function onsetOpts() {
  const s = settings.sens; // 1..5
  return { thresholdMult: [2.2, 1.9, 1.6, 1.45, 1.3][s - 1], delta: [0.11, 0.07, 0.04, 0.03, 0.02][s - 1], rmsGate: gateRms() * 0.8, minIntervalMs: 70 };
}

// ---------------- 运行状态（提前声明，避免 TDZ） ----------------
let pp = null; // 音准练习 { tracker, items, startedAt }
const rh = { active: false, expected: [], onsets: [], countInEnd: 0, endTime: 0, det: null, liveErrs: [], timer: null, countInOnsets: 0 };
const cal = { active: false, det: null, onsets: [], expected: [], end: 0 };

// ---------------- 音频引擎 ----------------
const engine = new AudioEngine();
const metro = new Metronome(engine);

async function enableMic() {
  const err = $('#mic-error');
  err.hidden = true;
  try {
    $('#mic-status').textContent = '正在请求麦克风权限…（请在浏览器弹窗里点「允许」）';
    await engine.startMic();
    $('#mic-bar').classList.add('on');
    $('#mic-btn').textContent = '⏹ 关闭麦克风';
    $('#mic-status').textContent = `麦克风已开启 · 采样率 ${engine.ctx.sampleRate} Hz`;
    $('#set-info').textContent = `采样率 ${engine.ctx.sampleRate} Hz，输出延迟（浏览器报告）≈ ${Math.round(((engine.ctx.outputLatency || 0) + (engine.ctx.baseLatency || 0)) * 1000)} ms，采集方式：${window.AudioWorkletNode ? 'AudioWorklet' : 'ScriptProcessor'}`;
    startLoops();
    return true;
  } catch (e) {
    let msg;
    const name = e.code || e.name;
    if (name === 'insecure') msg = '麦克风需要 HTTPS 页面才能使用。请通过 https://grot666.github.io/guitar-practice/ 打开（本地调试可用 http://localhost）。';
    else if (name === 'unsupported') msg = '这个浏览器不支持麦克风采集（getUserMedia）。请换用新版 Chrome / Edge / Safari / Firefox。在微信等内置浏览器里打开时，请点右上角用系统浏览器打开。';
    else if (name === 'NotAllowedError' || name === 'SecurityError') msg = '麦克风权限被拒绝了。请点地址栏左边的🔒/ⓘ图标，把「麦克风」改成「允许」，然后刷新页面再点「开启麦克风」。iPhone：设置 → Safari → 麦克风。';
    else if (name === 'NotFoundError' || name === 'OverconstrainedError') msg = '没找到麦克风设备。请插上麦克风或声卡，或检查系统声音设置里的输入设备。';
    else if (name === 'NotReadableError') msg = '麦克风被其他程序占用（比如会议软件、DAW）。关掉它们后再试。';
    else msg = '开启麦克风失败：' + (e.message || name);
    err.textContent = msg; err.hidden = false;
    $('#mic-status').textContent = '麦克风未开启';
    return false;
  }
}
function disableMic() {
  stopRhythm(false); stopPitchPractice(false);
  engine.stopMic();
  $('#mic-bar').classList.remove('on');
  $('#mic-btn').textContent = '🎤 开启麦克风';
  $('#mic-status').textContent = '麦克风已关闭';
}
$('#mic-btn').onclick = () => (engine.micOn ? disableMic() : enableMic());
async function needMic() { return engine.micOn || (await enableMic()); }

// ---------------- 标签页 ----------------
let currentTab = 'tuner';
$$('.tabs button').forEach((b) => (b.onclick = () => {
  currentTab = b.dataset.tab;
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + currentTab));
  if (currentTab === 'history') renderHistory();
  history.replaceState(null, '', '#' + currentTab);
}));
const initial = location.hash.slice(1);
if (initial) { const b = document.querySelector(`.tabs button[data-tab="${initial}"]`); if (b) b.click(); }

// ---------------- 音高分析循环 ----------------
let loopsStarted = false, pitchBuf = null, scratch = null;
const pitchHistory = []; // 最近几帧频率，做中值平滑
let onsetFlag = false;   // 自上次音高帧以来是否有新的起音（用于判断同音重弹）
let pitchOnsetDet = null;
function startLoops() {
  if (loopsStarted) return; loopsStarted = true;
  const sr = engine.ctx.sampleRate;
  const N = sr > 60000 ? 4096 : 2048;
  pitchBuf = new Float32Array(N); scratch = new Float32Array(N);
  pitchOnsetDet = new OnsetDetector(sr, onsetOpts());
  engine.onChunk((data, t) => {
    if (pitchOnsetDet.process(data, t).length) onsetFlag = true;
    rhythmOnChunk(data, t);
    calOnChunk(data, t);
  });
  let last = 0;
  const tick = (now) => {
    requestAnimationFrame(tick);
    if (!engine.micOn) return;
    engine.latest(pitchBuf.length, pitchBuf);
    // 电平表
    const level = rms(pitchBuf, pitchBuf.length - 1024);
    const db = level > 0 ? 20 * Math.log10(level) : -100;
    $('#meter-fill').style.width = Math.max(0, Math.min(100, ((db + 80) / 80) * 100)) + '%';
    if (now - last < 40) return; // ~25 次/秒
    last = now;
    if (currentTab !== 'tuner' && currentTab !== 'pitch') return;
    const r = detectPitch(pitchBuf, sr, { rmsGate: gateRms(), minFreq: 60, maxFreq: 1400, _scratch: scratch });
    if (r) { pitchHistory.push(r.freq); if (pitchHistory.length > 3) pitchHistory.shift(); }
    else pitchHistory.length = 0;
    const f = pitchHistory.length ? median(pitchHistory) : null;
    if (currentTab === 'tuner') updateTuner(f);
    else updatePitchPractice(r ? r.freq : null, f);
  };
  requestAnimationFrame(tick);
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
function updateMeterGate() { $('#meter-gate').style.left = ((settings.gateDb + 80) / 80) * 100 + '%'; }

// ---------------- 调音器 ----------------
let lockedString = -1; // -1 = 自动
(function buildTuner() {
  const ticks = $('#tu-ticks');
  for (let c = -50; c <= 50; c += 10) {
    const a = (c / 50) * (Math.PI / 2.4), major = c % 50 === 0 || c === 0;
    const r1 = 90, r2 = major ? 76 : 82;
    const x1 = Math.sin(a) * r1, y1 = -Math.cos(a) * r1, x2 = Math.sin(a) * r2, y2 = -Math.cos(a) * r2;
    ticks.insertAdjacentHTML('beforeend', `<line class="tick ${major ? 'major' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    if (major) ticks.insertAdjacentHTML('beforeend', `<text x="${Math.sin(a) * 66}" y="${-Math.cos(a) * 66 + 3}">${c > 0 ? '+' + c : c}</text>`);
  }
  const za = (5 / 50) * (Math.PI / 2.4);
  $('#tu-zone').setAttribute('d', `M ${-Math.sin(za) * 90} ${-Math.cos(za) * 90} A 90 90 0 0 1 ${Math.sin(za) * 90} ${-Math.cos(za) * 90}`);
  const wrap = $('#tu-strings');
  wrap.insertAdjacentHTML('beforeend', `<button data-s="-1" class="active">自动</button>`);
  OPEN.forEach((m, i) => wrap.insertAdjacentHTML('beforeend', `<button data-s="${i}">${STRING_LABEL[i]} ${midiName(m)}</button>`));
  wrap.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    lockedString = +b.dataset.s;
    wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (lockedString >= 0) playRef(midiToFreq(OPEN[lockedString], settings.a4));
  }));
})();
function playRef(freq) { // 点弦时播放参考音
  const ctx = engine.ensureContext();
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 1.6);
}
function setNeedle(cents) {
  const c = Math.max(-50, Math.min(50, cents));
  const deg = (c / 50) * (180 / 2.4);
  const n = $('#tu-needle');
  n.style.transform = `rotate(${deg}deg)`;
  n.classList.toggle('in', Math.abs(cents) <= 5);
}
function updateTuner(f) {
  const strBtns = $$('#tu-strings button');
  if (!f) { $('#tu-verdict').textContent = '弹一根弦试试'; $('#tu-verdict').className = 'verdict'; $('#tu-needle').classList.add('idle'); return; }
  $('#tu-needle').classList.remove('idle');
  let name, oct, cents, nearIdx = -1;
  // 最近的空弦
  let best = Infinity;
  OPEN.forEach((m, i) => { const d = Math.abs(centsBetween(f, midiToFreq(m, settings.a4))); if (d < best) { best = d; nearIdx = i; } });
  if (lockedString >= 0) {
    const m = OPEN[lockedString];
    cents = centsBetween(f, midiToFreq(m, settings.a4));
    name = midiName(m).replace(/-?\d+$/, ''); oct = Math.floor(m / 12) - 1;
  } else {
    const n = noteFromFreq(f, settings.a4);
    name = n.name; oct = n.octave; cents = n.cents;
  }
  $('#tu-note').textContent = name; $('#tu-oct').textContent = oct;
  $('#tu-freq').textContent = f.toFixed(1) + ' Hz';
  $('#tu-cents').textContent = (cents > 0 ? '+' : '') + cents.toFixed(1) + ' 音分';
  setNeedle(cents);
  const v = $('#tu-verdict');
  if (Math.abs(cents) > 300) { v.textContent = '离目标弦太远了（差 ' + Math.round(cents / 100) + ' 个半音）'; v.className = 'verdict bad'; }
  else if (Math.abs(cents) <= 5) { v.textContent = '✓ 准了'; v.className = 'verdict ok'; }
  else if (cents > 0) { v.textContent = '偏高 ↓ 放松一点'; v.className = 'verdict warn'; }
  else { v.textContent = '偏低 ↑ 拧紧一点'; v.className = 'verdict warn'; }
  strBtns.forEach((b) => b.classList.toggle('near', +b.dataset.s === nearIdx && best < 50));
}

// ---------------- 音准练习 ----------------
// 每条序列用 [弦, 品]（弦 0 = 6 弦低音 E）
const SEQS = {
  open: { name: '空弦 EADGBE', pos: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]] },
  cmaj: { name: 'C 大调音阶（第一把位）', pos: [[1, 3], [2, 0], [2, 2], [2, 3], [3, 0], [3, 2], [4, 0], [4, 1]] },
  gmaj: { name: 'G 大调音阶（两个八度）', pos: [[0, 3], [1, 0], [1, 2], [1, 3], [2, 0], [2, 2], [2, 4], [3, 0], [3, 2], [4, 0], [4, 1], [4, 3], [5, 0], [5, 2], [5, 3]] },
  emPent: { name: 'E 小调五声（开放把位）', pos: [[0, 0], [0, 3], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 2], [4, 0], [4, 3], [5, 0], [5, 3]] },
  amPent: { name: 'A 小调五声（第 5 把位）', pos: [[0, 5], [0, 8], [1, 5], [1, 7], [2, 5], [2, 7], [3, 5], [3, 7], [4, 5], [4, 8], [5, 5], [5, 8]] },
  chrom: { name: '单弦半音阶（0–12 品）', chromatic: true },
  custom: { name: '自定义音符', custom: true },
};
(function buildPitch() {
  const sel = $('#pp-seq');
  for (const [k, v] of Object.entries(SEQS)) sel.insertAdjacentHTML('beforeend', `<option value="${k}">${v.name}</option>`);
  sel.value = 'emPent';
  sel.onchange = () => { $('#pp-string-wrap').hidden = !SEQS[sel.value].chromatic; $('#pp-custom-wrap').hidden = !SEQS[sel.value].custom; previewSeq(); };
  ['#pp-dir', '#pp-string', '#pp-custom'].forEach((s) => ($(s).onchange = previewSeq));
  $('#pp-start').onclick = startPitchPractice;
  $('#pp-stop').onclick = () => stopPitchPractice(true);
  previewSeq();
})();
function buildTargets() {
  const k = $('#pp-seq').value, def = SEQS[k];
  let items; // {midi, pos?}
  if (def.chromatic) {
    const s = +$('#pp-string').value;
    items = Array.from({ length: 13 }, (_, f) => ({ midi: OPEN[s] + f, pos: [s, f] }));
  } else if (def.custom) {
    items = $('#pp-custom').value.split(/[\s,，]+/).filter(Boolean).map(parseNoteName).filter((m) => m !== null && m >= 36 && m <= 88).map((midi) => ({ midi }));
  } else items = def.pos.map(([s, f]) => ({ midi: OPEN[s] + f, pos: [s, f] }));
  const dir = $('#pp-dir').value;
  if (dir === 'updown') items = items.concat(items.slice(0, -1).reverse());
  if (dir === 'random') { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } }
  return items;
}
function posText(p) { return p ? `${STRING_LABEL[p[0]]} ${p[1] === 0 ? '空弦' : '第 ' + p[1] + ' 品'}` : ''; }
function previewSeq() { if (!pp) renderChips(buildTargets(), null); }
function renderChips(items, tracker) {
  $('#pp-chips').innerHTML = items.map((it, i) => {
    let cls = 'chip';
    if (tracker) {
      const r = tracker.results[i];
      if (r.hit) cls += r.attempts > 1 ? ' retry' : ' hit';
      else if (i < tracker.idx) cls += ' missed';
      if (i === tracker.idx) cls += ' cur';
    }
    const extra = tracker && tracker.results[i].hit ? ` <small>${fmtC(tracker.results[i].cents)}</small>` : '';
    return `<span class="${cls}" title="${posText(it.pos)}">${midiName(it.midi)}${extra}</span>`;
  }).join('');
}
const fmtC = (c) => (c > 0 ? '+' : '') + Math.round(c);
async function startPitchPractice() {
  if (!(await needMic())) return;
  const items = buildTargets();
  if (!items.length) { $('#pp-msg').textContent = '没有可练习的音符，检查一下自定义输入。'; return; }
  const tol = Math.max(5, Math.min(50, +$('#pp-tol').value || 20));
  pp = {
    items, startedAt: Date.now(), tol,
    tracker: new NoteSequenceTracker(items.map((i) => i.midi), { tolCents: tol, stableFrames: 3, a4: settings.a4, octaveFree: $('#pp-oct').checked, advanceOnMiss: $('#pp-adv').checked }),
  };
  $('#pp-start').disabled = true; $('#pp-stop').disabled = false; $('#pp-result').hidden = true;
  $('#pp-zone').style.left = 50 - (tol / 50) * 50 + '%'; $('#pp-zone').style.width = (tol / 50) * 100 + '%';
  $('#pp-msg').textContent = '开始！按顺序弹，每个音弹清楚、稍微保持一下。'; $('#pp-msg').className = 'verdict';
  showTarget();
}
function showTarget() {
  const t = pp.tracker;
  if (t.done) return;
  const it = pp.items[t.idx];
  $('#pp-target').textContent = midiName(it.midi);
  $('#pp-pos').textContent = posText(it.pos);
  renderChips(pp.items, t);
}
function updatePitchPractice(rawFreq, smoothF) {
  if (!smoothF) { $('#pp-heard').textContent = '—'; $('#pp-dev').textContent = ''; }
  if (!pp) {
    if (smoothF) { const n = noteFromFreq(smoothF, settings.a4); $('#pp-heard').textContent = n.name + n.octave; $('#pp-dev').textContent = fmtC(n.cents) + ' 音分'; }
    return;
  }
  const t = pp.tracker;
  const onset = onsetFlag; onsetFlag = false;
  if (smoothF && !t.done) {
    const n = noteFromFreq(smoothF, settings.a4);
    let c = centsBetween(smoothF, midiToFreq(t.current, settings.a4));
    if (t.octaveFree) c -= 1200 * Math.round(c / 1200);
    $('#pp-heard').textContent = n.name + n.octave;
    $('#pp-dev').textContent = Math.abs(c) < 100 ? `与目标差 ${fmtC(c)} 音分` : `差 ${(c / 100).toFixed(1)} 个半音`;
    const x = Math.max(-50, Math.min(50, c));
    $('#pp-needle').style.left = 50 + x + '%';
    $('#pp-needle').style.background = Math.abs(c) <= pp.tol ? 'var(--ok)' : 'var(--bad)';
  }
  const ev = t.update({ freq: rawFreq, time: performance.now(), onset });
  if (ev) {
    const m = $('#pp-msg');
    if (ev.type === 'hit') { m.textContent = `✓ ${midiName(ev.target)} 命中（${fmtC(ev.cents)} 音分）`; m.className = 'verdict ok'; }
    else if (Math.abs(ev.cents) < 100) { m.textContent = `✗ 音准不够：${fmtC(ev.cents)} 音分（容差 ±${pp.tol}）${t.advanceOnMiss ? '' : '，再弹一次'}`; m.className = 'verdict warn'; }
    else { m.textContent = `✗ 弹成了 ${midiName(ev.playedMidi)}，目标是 ${midiName(ev.target)}${t.advanceOnMiss ? '' : '，再弹一次'}`; m.className = 'verdict bad'; }
    if (t.done) stopPitchPractice(true); else showTarget();
  }
}
function stopPitchPractice(save) {
  if (!pp) return;
  const t = pp.tracker, s = t.summary(), dur = (Date.now() - pp.startedAt) / 1000;
  renderChips(pp.items, t);
  $('#pp-start').disabled = false; $('#pp-stop').disabled = true;
  if (save && s.attempts > 0) {
    const name = SEQS[$('#pp-seq').value].name;
    const res = $('#pp-result'); res.hidden = false;
    res.innerHTML = `<h3>${t.done ? '完成 🎉' : '已结束'} · ${name}</h3>
      <div class="stats">
        ${stat(pct(s.accuracy), '命中率（命中 / 判定次数）')}
        ${stat(pct(s.firstTryRate), '一次就弹准的音')}
        ${stat(s.meanAbsCents.toFixed(1) + ' 音分', '命中音平均偏差')}
        ${stat((s.meanCents > 0 ? '+' : '') + s.meanCents.toFixed(1), '整体倾向（+ 偏高 / − 偏低）')}
        ${stat(`${s.completed}/${s.total}`, '完成进度')}
        ${stat(dur.toFixed(0) + ' 秒', '用时')}
      </div>
      <p class="small muted">${advicePitch(s)}</p>`;
    addHistory({ type: 'pitch', at: new Date().toISOString(), name, tol: pp.tol, ...s, seconds: Math.round(dur) });
  }
  window.__gp.lastTracker = t;
  pp = null;
}
function advicePitch(s) {
  if (s.meanCents > 8) return '整体偏高：左手按弦可能太用力或把弦推歪了，试着放松、按在品丝后面。';
  if (s.meanCents < -8) return '整体偏低：检查调音，或者按弦不到位。';
  if (s.accuracy < 0.7) return '错音较多：放慢速度，先看指板位置再弹。';
  return '音准不错，可以收紧容差或换更难的音阶。';
}
const pct = (x) => Math.round(x * 100) + '%';
const stat = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;

// ---------------- 节奏练习 ----------------
(function buildRhythm() {
  const bpm = $('#rh-bpm');
  bpm.oninput = () => { $('#rh-bpm-val').textContent = bpm.value; metro.bpm = +bpm.value; };
  $('#rh-beats').onchange = () => { metro.beatsPerBar = +$('#rh-beats').value; buildBeatDots(); };
  $('#rh-sub').onchange = () => (metro.subdiv = +$('#rh-sub').value);
  $('#rh-sound').onchange = () => (metro.sound = $('#rh-sound').checked);
  $('#rh-accent').onchange = () => (metro.accent = $('#rh-accent').checked);
  $('#rh-metro').onclick = toggleMetroOnly;
  $('#rh-start').onclick = startRhythm;
  $('#rh-stop').onclick = () => stopRhythm(true);
  buildBeatDots(); drawRhythm();
})();
function buildBeatDots() {
  const n = +$('#rh-beats').value;
  $('#rh-beats-vis').innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i === 0 ? 'first' : ''}"></span>`).join('');
}
function readMetroSettings() {
  metro.bpm = +$('#rh-bpm').value; metro.beatsPerBar = +$('#rh-beats').value; metro.subdiv = +$('#rh-sub').value;
  metro.sound = $('#rh-sound').checked; metro.accent = $('#rh-accent').checked;
}
function flashAt(time, info) {
  const delay = Math.max(0, (time - engine.ctx.currentTime) * 1000);
  setTimeout(() => {
    if (info.sub !== 0) return;
    const dots = $$('#rh-beats-vis span');
    dots.forEach((d, i) => d.classList.toggle('flash', i === info.beat));
    setTimeout(() => dots[info.beat] && dots[info.beat].classList.remove('flash'), 110);
  }, delay);
}
function toggleMetroOnly() {
  if (rh.active) return;
  if (metro.running) { metro.stop(); $('#rh-metro').textContent = '▶ 只开节拍器'; return; }
  readMetroSettings();
  metro.onTick = flashAt;
  metro.start();
  $('#rh-metro').textContent = '⏸ 停止节拍器';
}
async function startRhythm() {
  if (!(await needMic())) return;
  if (metro.running) { metro.stop(); $('#rh-metro').textContent = '▶ 只开节拍器'; }
  readMetroSettings();
  const perBar = metro.beatsPerBar * metro.subdiv, bars = +$('#rh-bars').value;
  const countInTicks = perBar, total = perBar * bars;
  Object.assign(rh, { active: true, expected: [], onsets: [], liveErrs: [], countInOnsets: 0, total, countInTicks,
    det: new OnsetDetector(engine.ctx.sampleRate, onsetOpts()), settings: { bpm: metro.bpm, beats: metro.beatsPerBar, subdiv: metro.subdiv, bars } });
  const start = metro.start(0.3);
  const iv = metro.tickInterval;
  rh.countInEnd = start + countInTicks * iv;
  for (let i = 0; i < total; i++) rh.expected.push(rh.countInEnd + i * iv);
  rh.endTime = rh.expected[rh.expected.length - 1] + Math.min(0.3, iv / 2) + 0.15;
  metro.onTick = (time, info) => {
    flashAt(time, info);
    if (info.index >= countInTicks + total) metro.stop();
  };
  $('#rh-start').disabled = true; $('#rh-stop').disabled = false; $('#rh-metro').disabled = true; $('#rh-result').hidden = true;
  $('#rh-last').textContent = '—';
  rh.timer = setInterval(() => {
    const now = engine.ctx.currentTime;
    if (now < rh.countInEnd) $('#rh-state').textContent = '预备 ' + (Math.floor((now - start) / (iv * metro.subdiv)) + 1 || 1);
    else if (now < rh.endTime) {
      const k = Math.min(total, Math.floor((now - rh.countInEnd) / iv) + 1);
      $('#rh-state').textContent = `第 ${Math.ceil(k / perBar)}/${bars} 小节`;
    }
    // 等采集数据追上结束时间再结算
    if (engine.lastFrameTime > rh.endTime + 0.1) stopRhythm(true);
  }, 50);
  drawRhythm();
}
function rhythmOnChunk(data, t) {
  if (!rh.active) return;
  const lat = settings.latencyMs / 1000;
  for (const o of rh.det.process(data, t)) {
    const adj = o - lat;
    if (adj < rh.countInEnd - metro.tickInterval / 2) { if (o > rh.countInEnd - metro.tickInterval * rh.countInTicks) rh.countInOnsets++; continue; }
    if (adj > rh.endTime) continue;
    rh.onsets.push(o);
    // 实时反馈：找最近的期望拍
    let best = null;
    for (const e of rh.expected) if (!best || Math.abs(adj - e) < Math.abs(adj - best)) best = e;
    const err = (adj - best) * 1000;
    const idx = rh.expected.indexOf(best);
    rh.liveErrs.push({ idx, err });
    const g = gradeOf(err), label = { perfect: '完美', good: '好', ok: '一般', off: '偏差大' }[g];
    $('#rh-last').textContent = `${Math.abs(err) < 3 ? '正好' : err < 0 ? '早' : '晚'} ${Math.abs(Math.round(err))}ms · ${label}`;
    drawRhythm();
  }
}
function stopRhythm(save) {
  if (!rh.active) return;
  rh.active = false; metro.stop(); clearInterval(rh.timer);
  $('#rh-start').disabled = false; $('#rh-stop').disabled = true; $('#rh-metro').disabled = false;
  $('#rh-state').textContent = '已结束';
  const now = engine.ctx ? engine.ctx.currentTime : 0;
  // 提前停止时只统计已经过去的拍点
  const expected = rh.expected.filter((e) => e <= Math.min(now, engine.lastFrameTime) - 0.05);
  if (!save || expected.length < 2) { drawRhythm(); return; }
  const m = matchOnsets(rh.onsets, expected, { latencyMs: settings.latencyMs, windowMs: 150 });
  const s = summarizeRhythm(m);
  rh.lastMatch = m;
  drawRhythm(m);
  const st = rh.settings;
  const desc = `${st.bpm} BPM · ${st.beats} 拍 · ${['', '四分', '八分', '三连音', '十六分'][st.subdiv]} · ${st.bars} 小节`;
  const bleed = rh.countInOnsets >= Math.max(2, rh.countInTicks * 0.75) && metro.sound;
  const res = $('#rh-result'); res.hidden = false;
  res.innerHTML = `<h3>节奏结果 · ${desc}</h3>
    <div class="stats">
      ${stat(pct(s.accuracy), '节奏准确率')}
      ${stat(pct(s.hitRate), `命中率（${s.hit}/${s.expected}）`)}
      ${stat(s.meanAbsErrorMs.toFixed(1) + ' ms', '平均绝对误差')}
      ${stat((s.meanErrorMs > 0 ? '+' : '') + s.meanErrorMs.toFixed(1) + ' ms', '平均倾向（+ 拖 / − 抢）')}
      ${stat(s.stdMs.toFixed(1) + ' ms', '稳定性（标准差）')}
      ${stat(`${s.early} / ${s.late}`, '抢拍 / 拖拍 次数（>10ms）')}
      ${stat(s.missed, '漏掉的拍')}
      ${stat(s.extra, '多余的拨弦')}
    </div>
    <p class="small">评级：完美 ≤20ms ${s.grades.perfect} · 好 ≤45ms ${s.grades.good} · 一般 ≤90ms ${s.grades.ok} · 偏差大 ${s.grades.off}</p>
    <p class="small muted">${adviceRhythm(s)}</p>
    ${bleed ? '<p class="small" style="color:var(--bad)">⚠ 预备拍期间也检测到了很多“拨弦”，可能是麦克风收到了节拍器的声音。请戴耳机，或关掉「节拍器出声」。</p>' : ''}`;
  addHistory({ type: 'rhythm', at: new Date().toISOString(), name: desc, ...st, latencyMs: settings.latencyMs, ...s, grades: s.grades });
}
function adviceRhythm(s) {
  if (s.hitRate < 0.6) return '漏拍较多：先降低速度，或换成更少的细分。';
  if (s.meanErrorMs < -15) return '整体抢拍：试着在心里把拍子“等”出来，手腕放松。';
  if (s.meanErrorMs > 15) return '整体拖拍：如果你感觉自己是准的，可能需要重新校准延迟。';
  if (s.stdMs > 30) return '平均位置不错，但忽早忽晚：保持右手持续摆动（不弹时也空扫）。';
  return '很稳！可以提高 BPM 或换细分继续练。';
}
function drawRhythm(match) {
  const cv = $('#rh-canvas'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 600, H = 160;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  g.clearRect(0, 0, W, H);
  const range = 120, y = (ms) => H / 2 - (Math.max(-range, Math.min(range, ms)) / range) * (H / 2 - 8);
  g.fillStyle = 'rgba(46,157,91,.15)'; g.fillRect(0, y(20), W, y(-20) - y(20));
  g.strokeStyle = col('--line'); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.fillStyle = col('--muted'); g.font = '10px sans-serif';
  g.fillText('晚 +' + range + 'ms', 4, 12); g.fillText('早 −' + range + 'ms', 4, H - 4);
  const n = rh.total || rh.expected.length || 16, x = (i) => 30 + ((i + 0.5) / n) * (W - 40);
  const pts = match ? match.hits.map((h, i) => (h ? { idx: i, err: h.errorMs } : { idx: i, miss: true })) : rh.liveErrs;
  for (const p of pts) {
    if (p.miss) { g.fillStyle = col('--bad'); g.fillText('×', x(p.idx) - 3, H / 2 + 4); continue; }
    const gr = gradeOf(p.err);
    g.fillStyle = gr === 'perfect' ? col('--ok') : gr === 'good' ? col('--accent') : gr === 'ok' ? col('--warn') : col('--bad');
    g.beginPath(); g.arc(x(p.idx), y(p.err), 4, 0, Math.PI * 2); g.fill();
  }
}

// ---------------- 延迟校准 ----------------
$('#cal-start').onclick = async () => {
  if (cal.active || rh.active) return;
  if (!(await needMic())) return;
  if (metro.running) metro.stop();
  const saved = { bpm: metro.bpm, beatsPerBar: metro.beatsPerBar, subdiv: metro.subdiv, sound: metro.sound };
  Object.assign(metro, { bpm: 80, beatsPerBar: 4, subdiv: 1, sound: true });
  const start = metro.start(0.3), iv = metro.tickInterval;
  Object.assign(cal, { active: true, det: new OnsetDetector(engine.ctx.sampleRate, onsetOpts()), onsets: [], expected: [] });
  for (let i = 4; i < 16; i++) cal.expected.push(start + i * iv);
  cal.end = start + 16 * iv + 0.3;
  metro.onTick = (time, info) => { flashAt(time, info); if (info.index >= 15) metro.stop(); };
  $('#cal-status').textContent = '听 4 下预备拍，然后跟着拍子拨闷音（或者外放不弹）…';
  const timer = setInterval(() => {
    if (engine.lastFrameTime < cal.end) return;
    clearInterval(timer); cal.active = false;
    Object.assign(metro, saved);
    const est = estimateLatency(cal.onsets.filter((o) => o > cal.expected[0] - 0.3), cal.expected, 300);
    if (!est || est.n < 6) { $('#cal-status').textContent = `只检测到 ${est ? est.n : cal.onsets.length} 下，不够可靠，请再试一次（弹响一点或调低噪声门限）。`; return; }
    if (est.spreadMs > 40) { $('#cal-status').textContent = `测得的拨弦时间太分散（±${est.spreadMs.toFixed(0)} ms），没有采用。请跟紧拍子再测一次。`; return; }
    settings.latencyMs = Math.round(est.latencyMs); saveSettings(); syncSettingsUI();
    $('#cal-status').textContent = `校准完成：延迟 ${settings.latencyMs} ms（${est.n} 下，离散 ±${est.spreadMs.toFixed(0)} ms）${est.spreadMs > 20 ? '。离散偏大，建议再测一次。' : ''}`;
  }, 100);
};
function calOnChunk(data, t) { if (cal.active) cal.onsets.push(...cal.det.process(data, t)); }

// ---------------- 记录 ----------------
function renderHistory() {
  const h = loadHistory();
  const list = $('#hi-list');
  if (!h.length) { list.innerHTML = '<p class="muted">还没有记录。完成一次音准或节奏练习后会出现在这里。</p>'; drawHistoryChart(h); return; }
  list.innerHTML = h.slice().reverse().map((e) => {
    const d = new Date(e.at), when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const body = e.type === 'rhythm'
      ? `准确率 <b>${pct(e.accuracy)}</b> · 命中 ${e.hit}/${e.expected} · 平均误差 ${e.meanAbsErrorMs.toFixed(0)}ms（${e.meanErrorMs > 0 ? '+' : ''}${e.meanErrorMs.toFixed(0)}）`
      : `命中率 <b>${pct(e.accuracy)}</b> · 完成 ${e.completed}/${e.total} · 平均偏差 ${e.meanAbsCents.toFixed(1)} 音分`;
    return `<div class="hist-item"><div><span class="tag">${e.type === 'rhythm' ? '节奏' : '音准'}</span>${escapeHtml(e.name)}</div><div>${body}</div><div class="muted">${when}</div></div>`;
  }).join('');
  drawHistoryChart(h);
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function drawHistoryChart(h) {
  const cv = $('#hi-chart'), dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 600, H = 140;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  g.strokeStyle = css.getPropertyValue('--line'); g.fillStyle = css.getPropertyValue('--muted'); g.font = '10px sans-serif';
  [0, 50, 100].forEach((v) => { const yy = H - 10 - (v / 100) * (H - 20); g.beginPath(); g.moveTo(26, yy); g.lineTo(W, yy); g.stroke(); g.fillText(v + '%', 0, yy + 3); });
  const recent = h.slice(-30);
  const line = (type, color) => {
    const pts = recent.map((e, i) => [i, e]).filter(([, e]) => e.type === type);
    if (!pts.length) return;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2; g.beginPath();
    pts.forEach(([i, e], k) => { const xx = 30 + (i / Math.max(1, recent.length - 1)) * (W - 40), yy = H - 10 - e.accuracy * (H - 20); k ? g.lineTo(xx, yy) : g.moveTo(xx, yy); });
    g.stroke();
    pts.forEach(([i, e]) => { const xx = 30 + (i / Math.max(1, recent.length - 1)) * (W - 40), yy = H - 10 - e.accuracy * (H - 20); g.beginPath(); g.arc(xx, yy, 3, 0, 7); g.fill(); });
    g.lineWidth = 1;
  };
  line('rhythm', '#267CB9'); line('pitch', '#d48a12');
}
$('#hi-clear').onclick = () => { if (confirm('确定清空全部练习记录？此操作不能撤销。')) { localStorage.removeItem(LS_HIST); renderHistory(); } };
$('#hi-export').onclick = () => {
  const blob = new Blob([JSON.stringify(loadHistory(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'guitar-practice-history.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------------- 设置 UI ----------------
function syncSettingsUI() {
  $('#set-a4').value = settings.a4; $('#set-gate').value = settings.gateDb; $('#set-lat').value = settings.latencyMs; $('#set-sens').value = settings.sens;
  $('#set-gate-val').textContent = settings.gateDb + ' dB';
  $('#set-sens-val').textContent = ['很低', '低', '中', '高', '很高'][settings.sens - 1];
  $('#rh-lat').textContent = settings.latencyMs;
  updateMeterGate();
}
$('#set-a4').onchange = (e) => { settings.a4 = Math.max(415, Math.min(466, +e.target.value || 440)); saveSettings(); syncSettingsUI(); };
$('#set-gate').oninput = (e) => { settings.gateDb = +e.target.value; saveSettings(); syncSettingsUI(); };
$('#set-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); syncSettingsUI(); if (pitchOnsetDet) pitchOnsetDet = new OnsetDetector(engine.ctx.sampleRate, onsetOpts()); };
$('#set-lat').onchange = (e) => { settings.latencyMs = Math.round(+e.target.value || 0); saveSettings(); syncSettingsUI(); };
syncSettingsUI();
renderHistory();
document.addEventListener('visibilitychange', () => { if (document.hidden && rh.active) stopRhythm(true); });

// 供自动化测试使用
window.__gp = { engine, settings, rh, get pp() { return pp; } };
