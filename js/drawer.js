// drawer.js — 设置与测试面板：所有调整都在这里，带实时反馈，不用切页面
import { $, $$, settings, saveSettings, onSettings, markChecked, engine, metro, live, onPitch, onOnset, onMic, enableMic, disableMic,
  switchDevice, needMic, gateDb, noiseFloorDb, applyTheme, loadHistory, clearHistory, fmtC } from './core.js';
import { estimateLatency, midiToFreq } from './dsp.js';

let isOpen = false;
export function openDrawer() {
  isOpen = true;
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open'); $('#scrim').hidden = false;
  sync(); refreshDevices();
}
export function closeDrawer() {
  isOpen = false;
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open'); $('#scrim').hidden = true;
}
const SENS = ['很低', '低', '中', '高', '很高'];
const OUT_HINT = {
  speaker: '外放：节拍器从喇叭出来，会被麦克风听到。已经自动把节拍器的「嘀」声频段过滤掉，不会当成你的拨弦。',
  headphones: '耳机：麦克风听不到节拍器，检测最干净。蓝牙耳机延迟大，换了以后要重新校准。',
  silent: '静音：不出节拍器声，只看屏幕上的拍点。',
};

function sync() {
  $('#s-auto').checked = settings.autoGate;
  $('#s-gate').value = Math.round(gateDb()); $('#s-gate').disabled = settings.autoGate;
  $('#s-gate-v').textContent = `${Math.round(gateDb())} dB${settings.autoGate ? '（自动）' : ''}`;
  $('#s-sens').value = settings.sens; $('#s-sens-v').textContent = SENS[settings.sens - 1];
  $$('#s-out button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.outMode));
  $('#s-out-hint').textContent = OUT_HINT[settings.outMode];
  $('#s-vol').value = Math.round(settings.volume * 100); $('#s-vol-v').textContent = Math.round(settings.volume * 100) + '%';
  $('#s-lat-v').textContent = settings.latencyMs;
  $('#s-tol').value = settings.tolCents; $('#s-tol-v').textContent = `±${settings.tolCents} 音分`;
  $('#s-oct').checked = settings.octaveFree;
  $('#s-a4').value = settings.a4; $('#s-a4-v').textContent = settings.a4 + ' Hz';
  $$('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.theme));
  $('#s-mic').textContent = engine.micOn ? '关闭麦克风' : '开启麦克风';
  $('#s-mic').className = 'btn ' + (engine.micOn ? '' : 'primary');
  $$('#checklist [data-k]').forEach((d) => d.classList.toggle('done', !!(settings.checked || {})[d.dataset.k]));
}

async function refreshDevices() {
  const list = await engine.listInputs().catch(() => []);
  const sel = $('#s-device');
  sel.innerHTML = `<option value="">默认输入设备</option>` + list.map((d, i) => `<option value="${d.deviceId}">${d.label || '麦克风 ' + (i + 1)}</option>`).join('');
  sel.value = list.some((d) => d.deviceId === settings.deviceId) ? settings.deviceId : '';
}

export function initDrawer() {
  $('#open-settings').onclick = () => (isOpen ? closeDrawer() : openDrawer());
  $('#close-settings').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeDrawer(); });
  onSettings(sync);
  onMic((st) => { sync(); if (st === 'on') refreshDevices(); if (st === 'error') $('#s-db').textContent = '不可用'; });

  $('#s-mic').onclick = async () => { if (engine.micOn) disableMic(); else { await enableMic(); engine.unlock(); } };
  $('#s-device').onchange = (e) => switchDevice(e.target.value);
  $('#s-auto').onchange = (e) => { settings.autoGate = e.target.checked; if (!settings.autoGate) settings.gateDb = Math.round(gateDb()); saveSettings(); };
  $('#s-gate').oninput = (e) => { settings.gateDb = +e.target.value; saveSettings(); };
  $('#s-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); };
  $$('#s-out button').forEach((b) => (b.onclick = () => { settings.outMode = b.dataset.v; saveSettings(); }));
  $('#s-vol').oninput = (e) => { settings.volume = +e.target.value / 100; saveSettings(); };
  $('#s-click').onclick = async () => {
    const was = metro.sound; metro.sound = true; metro.volume = Math.max(0.05, settings.volume);
    await metro.test(); metro.sound = was; markChecked('click');
    if (engine.ctx.state !== 'running') $('#s-out-hint').textContent = '浏览器还没允许播放声音，请再点一次。';
  };
  $('#s-ref').onclick = async () => { await engine.unlock(); engine.pluck(69, undefined, 1.8, 0.9); };
  $('#s-sound').onclick = async () => {
    const ok = await engine.unlock();
    const ctx = engine.ctx, t = ctx.currentTime + 0.05;
    [60, 64, 67, 72].forEach((m, i) => engine.pluck(m, t + i * 0.18, 0.9, 0.85));
    const st = { running: '运行中 ✓', suspended: '被暂停（再点一次）', interrupted: '被系统打断（再点一次）', closed: '已关闭' }[ctx.state] || ctx.state;
    $('#s-sound-info').innerHTML = `应该听到「哆咪嗦哆」4 个音。声音引擎：${st} · ${ctx.sampleRate} Hz` +
      (ctx.outputLatency ? ` · 输出延迟 ${Math.round(ctx.outputLatency * 1000)} ms` : '') + (engine.sessionType ? ` · 会话 ${engine.sessionType}` : '') +
      (engine.micOn ? `<br>⚠ 麦克风开着：iPhone 会从听筒出声、音量变小。只听声音时可以先 <a href="#" id="s-sound-mic">关掉麦克风</a>。` : '') +
      (!ok ? '<br>⚠ 浏览器还没允许出声：再点一次；微信里请用浏览器打开。' : '');
    const a = $('#s-sound-mic'); if (a) a.onclick = (e) => { e.preventDefault(); disableMic(); $('#s-sound').click(); };
  };
  $$('[data-lat]').forEach((b) => (b.onclick = () => { settings.latencyMs = Math.max(-100, Math.min(500, settings.latencyMs + +b.dataset.lat)); saveSettings(); }));
  $('#s-cal').onclick = runCalibration;
  $('#s-tol').oninput = (e) => { settings.tolCents = +e.target.value; saveSettings(); };
  $('#s-oct').onchange = (e) => { settings.octaveFree = e.target.checked; saveSettings(); };
  $('#s-a4').oninput = (e) => { settings.a4 = +e.target.value; saveSettings(); };
  $$('#s-theme button').forEach((b) => (b.onclick = () => { settings.theme = b.dataset.v; saveSettings(); applyTheme(); }));
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => settings.theme === 'auto' && applyTheme());
  $('#s-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ settings, history: loadHistory() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'guitar-practice-history.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#s-clear').onclick = () => { if (confirm('确定清空所有练习记录？')) { clearHistory(); location.reload(); } };
  $('#s-cal-dots').innerHTML = Array.from({ length: 12 }, () => '<span></span>').join('');

  // 实时读数
  onPitch((fr) => {
    if (!isOpen) return;
    $('#s-pitch').textContent = fr.freq ? `${live.note.name}${live.note.octave} ${fmtC(live.note.cents)}` : '—';
  });
  let blinkT = 0;
  onOnset((t) => {
    if (cal.active) onCalOnset(t);
    if (!isOpen) return;
    $('#s-onsets').textContent = live.onsets;
    const b = $('#s-blink'); b.classList.add('on'); clearTimeout(blinkT); blinkT = setTimeout(() => b.classList.remove('on'), 150);
  });
  const loop = () => {
    requestAnimationFrame(loop);
    if (!isOpen) return;
    const pos = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));
    const g = gateDb();
    $('#s-gate-mark').style.left = pos(g) + '%';
    if (engine.micOn) {
      $('#s-meter').style.width = pos(live.db) + '%';
      $('#s-meter').classList.toggle('loud', live.db > g);
      $('#s-db').textContent = Math.round(live.db) + ' dB';
    } else { $('#s-meter').style.width = '0%'; $('#s-db').textContent = '—'; }
    if (settings.autoGate) {
      const t = `${Math.round(g)} dB（自动，底噪 ${Math.round(noiseFloorDb())}）`;
      if ($('#s-gate-v').textContent !== t) { $('#s-gate-v').textContent = t; $('#s-gate').value = Math.round(g); }
    }
  };
  requestAnimationFrame(loop);
}

// ---------- 延迟校准：80 BPM，4 下预备 + 12 下跟拨 ----------
const cal = { active: false, onsets: [], expected: [] };
function onCalOnset(t) { cal.onsets.push(t); markDot(t); }
function markDot(t) {
  let k = -1, best = 0.3;
  cal.expected.forEach((e, i) => { const d = Math.abs(t - e); if (d < best) { best = d; k = i; } });
  if (k >= 0) { const s = $$('#s-cal-dots span')[k]; s.classList.add('hit'); s.textContent = Math.round((t - cal.expected[k]) * 1000); }
}
async function runCalibration() {
  if (cal.active) return;
  if (!(await needMic())) return;
  await engine.unlock();
  const st = $('#s-cal-status'), dots = $$('#s-cal-dots span');
  dots.forEach((d) => { d.className = ''; d.textContent = ''; });
  const saved = { bpm: metro.bpm, beatsPerBar: metro.beatsPerBar, subdiv: metro.subdiv, sound: metro.sound, onTick: metro.onTick };
  metro.stop();
  Object.assign(metro, { bpm: 80, beatsPerBar: 4, subdiv: 1, sound: true, volume: Math.max(0.3, settings.volume) });
  const start = metro.start(0.3), iv = metro.tickInterval;
  cal.onsets = []; cal.expected = []; cal.active = true;
  for (let i = 4; i < 16; i++) cal.expected.push(start + i * iv);
  const end = start + 16 * iv + 0.3;
  $('#s-cal').disabled = true;
  metro.onTick = (time, info) => {
    if (info.index >= 15) metro.stop();
    setTimeout(() => {
      if (!cal.active) return;
      if (info.index < 4) st.textContent = `预备 ${4 - info.index}…`;
      else { st.textContent = `跟着拨！还剩 ${15 - info.index} 下`; dots[info.index - 4].classList.add('tick'); }
    }, Math.max(0, (time - engine.ctx.currentTime) * 1000));
  };
  st.textContent = '先听 4 下预备拍，然后每一下「嘀」拨一次闷音…';
  await new Promise((res) => { const t = setInterval(() => { if (engine.lastFrameTime >= end) { clearInterval(t); res(); } }, 100); });
  cal.active = false; $('#s-cal').disabled = false;
  Object.assign(metro, saved);
  const est = estimateLatency(cal.onsets.filter((o) => o > cal.expected[0] - 0.3), cal.expected, 300);
  if (!est || est.n < 6) { st.textContent = `只检测到 ${est ? est.n : cal.onsets.length} 下，不够。弹响一点（电平条要过红线），或者把拨弦灵敏度调高再试。`; return; }
  if (est.spreadMs > 40) { st.textContent = `拨弦时间太分散（±${Math.round(est.spreadMs)} ms），没有采用。跟紧拍子再测一次。`; return; }
  settings.latencyMs = Math.round(est.latencyMs); markChecked('cal'); saveSettings();
  st.textContent = `✓ 校准完成：延迟 ${settings.latencyMs} ms（${est.n} 下，离散 ±${Math.round(est.spreadMs)} ms）${est.spreadMs > 20 ? '，离散偏大，可以再测一次' : ''}`;
}
