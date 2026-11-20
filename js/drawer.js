// drawer.js — 设置与测试面板：所有调整都在这里，带实时反馈，不用切页面
import { $, $$, settings, saveSettings, onSettings, markChecked, engine, metro, live, onPitch, onOnset, onMic, enableMic, disableMic,
  switchDevice, needMic, gateDb, noiseFloorDb, applyTheme, loadHistory, clearHistory, fmtC } from './core.js';
import { runLoopback, loopbackMessage, listenExternal, externalMessage } from './latency.js';
import { diag, formatElapsed, defaultFilename, exportViaShareOrDownload, DIAG_NOTE_ZH } from './diag.js';

let isOpen = false;
export function openDrawer(opts = {}) {
  isOpen = true;
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open'); $('#scrim').hidden = false;
  sync(); refreshDevices(); syncLogUi();
  if (opts.scrollTo) {
    const el = typeof opts.scrollTo === 'string' ? $(opts.scrollTo) : opts.scrollTo;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
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
  $('#s-cal-dots').innerHTML = Array.from({ length: 8 }, () => '<span></span>').join('');
  $('#s-ext').onclick = runExternalTest;

  initLogUi();

  // 实时读数
  onPitch((fr) => {
    if (!isOpen) return;
    $('#s-pitch').textContent = fr.freq ? `${live.note.name}${live.note.octave} ${fmtC(live.note.cents)}` : '—';
  });
  let blinkT = 0;
  onOnset((t) => {
    if (!isOpen) return;
    $('#s-onsets').textContent = live.onsets;
    const b = $('#s-blink'); b.classList.add('on'); clearTimeout(blinkT); blinkT = setTimeout(() => b.classList.remove('on'), 150);
  });
  const loop = () => {
    requestAnimationFrame(loop);
    if (!isOpen && (!$('#log-chip') || $('#log-chip').hidden)) return;
    if (diag.status().recording && (loop._logN = (loop._logN || 0) + 1) % 20 === 0) syncLogUi();
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

// ---------- 设备延迟：回环自动测（喇叭 → 麦克风），不需要人跟拍 ----------
export async function runCalibration() {
  const st = $('#s-cal-status'), dots = $$('#s-cal-dots span'), btn = $('#s-cal');
  dots.forEach((d) => { d.className = ''; d.textContent = ''; });
  btn.disabled = true; st.textContent = '准备…保持安静，不用弹琴';
  const est = await runLoopback({ onProgress: (i, n) => { if (i >= 0) { dots[i] && dots[i].classList.add('tick'); st.textContent = `正在放测试音 ${i + 1}/${n}…`; } } });
  btn.disabled = false;
  if (est.lagsMs) est.lagsMs.forEach((v, i) => { const d = dots[i]; if (!d) return; d.classList.remove('tick'); if (v === null) { d.classList.add('miss'); d.textContent = '×'; } else { d.classList.add('hit'); d.textContent = Math.round(v); } });
  st.textContent = loopbackMessage(est);
  return est;
}
// ---------- 外部节拍器测试 ----------
async function runExternalTest() {
  const btn = $('#s-ext'), st = $('#s-ext-status'), box = $('#s-ext-dots');
  btn.disabled = true; box.innerHTML = ''; st.textContent = '在听…（8 秒，别弹琴）'; $('#s-ext-n').textContent = '';
  const r = await listenExternal({ seconds: 8, onClick: (t, n) => { $('#s-ext-n').textContent = n + ' 下'; box.insertAdjacentHTML('beforeend', '<span class="hit"></span>'); } });
  btn.disabled = false;
  if (r.ok) box.innerHTML = r.residualsMs.map((e) => `<span class="${Math.abs(e) < 3 ? 'hit' : Math.abs(e) < 8 ? 'warn' : 'miss'}" title="${e.toFixed(1)} ms">${e >= 0 ? '+' : ''}${e.toFixed(0)}</span>`).join('');
  st.textContent = externalMessage(r);
}


// ---------- 开发者诊断日志 ----------
function logStatusText(st) {
  if (!st.hasSession && !st.recording) return '未在记录';
  const ev = `${st.eventCount} 条`;
  const time = formatElapsed(st.durationMs);
  const drop = st.dropped ? `，另有 ${st.dropped} 条因上限未写入` : '';
  const trunc = st.truncated ? `已达上限（${st.truncateReason === 'maxDuration' ? '时长' : '条数'}）并自动停止。` : '';
  if (st.recording) return `正在记录 · 已进行 ${time} · ${ev}${drop}。导出不会停止记录。`;
  return `已停止 · 共 ${time} · ${ev}${drop}。${trunc}日志会保留，直到开始新的记录或点「清空日志」。`;
}

function syncLogUi() {
  const st = diag.status();
  const start = $('#s-log-start'), stop = $('#s-log-stop'), exp = $('#s-log-export'), clear = $('#s-log-clear');
  const status = $('#s-log-status'), sec = $('#s-log-sec'), chip = $('#log-chip'), chipT = $('#log-chip-text');
  if (!start) return;
  start.disabled = st.recording;
  start.textContent = st.hasSession && !st.recording ? '开始新的记录' : '开始记录日志';
  stop.disabled = !st.recording;
  exp.disabled = !st.hasSession;
  exp.textContent = st.recording ? '导出日志（进行中）' : '导出日志';
  clear.disabled = !st.hasSession || st.recording;
  if (status) status.textContent = logStatusText(st);
  if (sec) sec.classList.toggle('rec', st.recording);
  if (chip) {
    // 未在记录时必须隐藏，不能显示成「记录中」
    chip.hidden = !st.recording;
    if (st.recording && chipT) chipT.textContent = `记录中 ${formatElapsed(st.durationMs)} · ${st.eventCount}条`;
  }
}

function initLogUi() {
  const start = $('#s-log-start');
  if (!start || start._bound) return;
  start._bound = true;
  $('#s-log-start').onclick = () => {
    const st = diag.status();
    if (st.recording) return;
    if (st.hasSession && !confirm('开始新的记录会清空当前还没导出的日志，确定吗？')) return;
    const r = diag.start({ replace: true, settings });
    if (!r.ok) { toast(r.reason === 'already-recording' ? '已经在记录了。' : '无法开始记录。'); return; }
    toast('开始记录诊断日志。不含原始录音，也不会上传。');
    syncLogUi();
  };
  $('#s-log-stop').onclick = () => {
    const r = diag.stop();
    if (!r.ok) { toast('当前没有在记录。'); syncLogUi(); return; }
    const st = diag.status();
    toast(st.truncated ? '已达上限，记录已停止，可以导出日志。' : `已停止记录，共 ${st.eventCount} 条。可以导出，或开始新的记录。`);
    syncLogUi();
  };
  $('#s-log-export').onclick = () => exportLog();
  $('#s-log-clear').onclick = () => {
    if (diag.status().recording) { toast('请先停止记录，再清空。'); return; }
    if (!diag.status().hasSession) return;
    if (!confirm('确定清空已保存的诊断日志？清空后无法再导出。')) return;
    diag.clear();
    toast('已清空诊断日志。');
    syncLogUi();
  };
  const chip = $('#log-chip');
  if (chip) chip.onclick = () => openDrawer({ scrollTo: '#s-log-sec' });
  let wasRec = false;
  diag.onChange((st) => {
    if (wasRec && !st.recording && st.truncated) toast('日志已达上限，已自动停止。可以导出。');
    wasRec = st.recording;
    syncLogUi();
  });
  syncLogUi();
}

async function exportLog() {
  const st = diag.status();
  if (!st.hasSession) { toast('还没有日志可以导出。'); return; }
  const obj = diag.exportObject();
  const text = diag.exportText();
  if (!obj || !text) { toast('无法生成日志文件。'); return; }
  const name = defaultFilename(obj.session.startedAt);
  const r = await exportViaShareOrDownload(name, text);
  if (r.ok) {
    toast(r.method === 'share' ? '已打开系统分享，把 JSON 发给开发者即可。' : `已导出 ${name}。${st.recording ? '记录仍在继续。' : ''}`);
    return;
  }
  if (r.reason === 'cancelled') return;
  // 下载或分享都失败：尝试复制到剪贴板，并说明原因
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      toast('这个浏览器不能直接下载文件，日志已复制到剪贴板。请粘贴到备忘录或发给开发者。');
      return;
    }
  } catch {}
  const why = r.reason === 'no-blob' || r.reason === 'no-object-url' ? '当前浏览器不支持生成下载文件。'
    : r.reason === 'no-document' ? '当前环境无法保存文件。'
    : '导出失败。';
  toast(why + '请换用 Safari / Chrome，或截图把设置和「听到」的音名发给开发者。');
}

