// core.js — 全局状态：设置、存储、音频引擎、麦克风、音高/起音数据流
import { AudioEngine, Metronome } from './audio.js';
import { detectPitch, noteFromFreq, centsBetween, OnsetDetector, rms, SPEAKER_BAND } from './dsp.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- 设置 ----------
const LS_SET = 'guitar-practice:settings', LS_HIST = 'guitar-practice:history';
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
export const settings = Object.assign({
  a4: 440, gateDb: -50, autoGate: true, latencyMs: 0, sens: 3, outMode: 'speaker', volume: 0.9,
  tolCents: 30, octaveFree: false, theme: 'dark', deviceId: '', checked: {},
}, json(localStorage.getItem(LS_SET)) || {});
const setListeners = new Set();
export function saveSettings() { localStorage.setItem(LS_SET, JSON.stringify(settings)); setListeners.forEach((f) => f(settings)); }
export function onSettings(fn) { setListeners.add(fn); }
export function markChecked(k) { if (!settings.checked[k]) { settings.checked[k] = true; saveSettings(); } }

export function loadHistory() { return json(localStorage.getItem(LS_HIST)) || []; }
export function addHistory(e) {
  const hst = loadHistory(); hst.push({ at: new Date().toISOString(), ...e });
  while (hst.length > 300) hst.shift();
  localStorage.setItem(LS_HIST, JSON.stringify(hst));
}
export function clearHistory() { localStorage.removeItem(LS_HIST); }

// ---------- 音频 ----------
export const engine = new AudioEngine();
export const metro = new Metronome(engine);
metro.volume = settings.volume;

// 自动门限：最近约 10 秒块电平的第 5 百分位为底噪，门限 = 底噪 + 12 dB
const noise = { blocks: [], floorDb: -55 };
function trackNoise(data) {
  const db = 20 * Math.log10(rms(data) + 1e-9);
  noise.blocks.push(db); if (noise.blocks.length > 470) noise.blocks.shift();
  if (noise.blocks.length >= 20 && noise.blocks.length % 10 === 0) {
    const s = noise.blocks.slice().sort((a, b) => a - b);
    noise.floorDb = s[Math.floor(s.length * 0.05)];
  }
}
export const noiseFloorDb = () => noise.floorDb;
export const gateDb = () => (settings.autoGate ? Math.max(-65, Math.min(-40, noise.floorDb + 12)) : settings.gateDb);
export const gateRms = () => Math.pow(10, gateDb() / 20);
export function onsetOpts() {
  const s = settings.sens;
  const o = { thresholdMult: [2.2, 1.9, 1.6, 1.45, 1.3][s - 1], delta: [0.11, 0.07, 0.04, 0.03, 0.02][s - 1], rmsGate: gateRms() * 0.8, minIntervalMs: 70 };
  if (settings.outMode === 'speaker') Object.assign(o, SPEAKER_BAND, { delta: o.delta * 1.25 });
  return o;
}

// ---------- 数据流：每帧音高 / 每次起音 / 电平 ----------
const pitchSubs = new Set(), onsetSubs = new Set(), micSubs = new Set();
export const onPitch = (fn) => (pitchSubs.add(fn), () => pitchSubs.delete(fn));   // fn({freq, raw, held, note, cents, time, db})
export const onOnset = (fn) => (onsetSubs.add(fn), () => onsetSubs.delete(fn));   // fn(timeSec)
export const onMic = (fn) => (micSubs.add(fn), () => micSubs.delete(fn));         // fn(state)
export const live = { db: -100, freq: null, note: null, onsets: 0, micError: '' };

let loopStarted = false, onsetDet = null;
export function resetOnsetDetector() { if (engine.ctx) onsetDet = new OnsetDetector(engine.ctx.sampleRate, onsetOpts()); }
onSettings(() => { resetOnsetDetector(); metro.volume = settings.volume; metro.sound = settings.outMode !== 'silent'; });

function startLoop() {
  if (loopStarted) return; loopStarted = true;
  const sr = engine.ctx.sampleRate, N = sr > 60000 ? 4096 : 2048;
  const buf = new Float32Array(N), scratch = new Float32Array(N);
  resetOnsetDetector();
  engine.onChunk((data, t) => {
    trackNoise(data);
    onsetDet.gate = gateRms() * 0.8;
    for (const o of onsetDet.process(data, t)) { live.onsets++; onsetSubs.forEach((f) => f(o)); }
  });
  const hist = [];
  let held = null, last = 0;
  const tick = (now) => {
    requestAnimationFrame(tick);
    if (!engine.micOn || now - last < 40) return;
    last = now;
    engine.latest(N, buf);
    const level = rms(buf, N - 1024);
    live.db = level > 0 ? 20 * Math.log10(level) : -100;
    const r = detectPitch(buf, sr, { rmsGate: gateRms(), minFreq: 60, maxFreq: 1400, _scratch: scratch });
    if (r) {
      if (hist.length && Math.abs(centsBetween(r.freq, median(hist))) > 80) hist.length = 0;
      hist.push(r.freq); if (hist.length > 5) hist.shift();
      held = { f: median(hist), t: now };
    } else hist.length = 0;
    const smooth = hist.length ? median(hist) : null;
    const show = smooth || (held && now - held.t < 800 ? held.f : null);
    live.freq = smooth;
    live.note = smooth ? noteFromFreq(smooth, settings.a4) : null;
    if (smooth) markChecked('heard');
    // 帧时间：缓冲区中心对应的音频时钟时间
    const time = engine.lastFrameTime - N / 2 / sr;
    const frame = { raw: r ? r.freq : null, freq: smooth, show, held: !smooth && !!show, time, db: live.db };
    pitchSubs.forEach((f) => f(frame));
  };
  requestAnimationFrame(tick);
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

export async function enableMic() {
  live.micError = '';
  try {
    micSubs.forEach((f) => f('pending'));
    try { await engine.startMic(settings.deviceId || undefined); }
    catch (e) {
      if (settings.deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { settings.deviceId = ''; saveSettings(); await engine.startMic(); }
      else throw e;
    }
    startLoop();
    markChecked('mic');
    micSubs.forEach((f) => f('on'));
    return true;
  } catch (e) {
    const name = e.code || e.name;
    live.micError =
      name === 'insecure' ? '麦克风需要 HTTPS 页面（或 localhost）才能使用。'
      : name === 'unsupported' ? '这个浏览器不支持麦克风。请用新版 Chrome / Edge / Safari / Firefox；微信里请点右上角「在浏览器打开」。'
      : name === 'NotAllowedError' || name === 'SecurityError' ? '麦克风权限被拒绝。点地址栏左边的 🔒 图标把「麦克风」改成允许，再刷新页面。iPhone：设置 → Safari → 麦克风。'
      : name === 'NotFoundError' ? '没找到麦克风，请检查系统的输入设备。'
      : name === 'NotReadableError' ? '麦克风被别的程序占用了（会议软件、录音软件），关掉再试。'
      : '开启麦克风失败：' + (e.message || name);
    micSubs.forEach((f) => f('error'));
    return false;
  }
}
export function disableMic() { engine.stopMic(); live.freq = null; live.note = null; micSubs.forEach((f) => f('off')); }
export async function switchDevice(id) {
  settings.deviceId = id; saveSettings();
  if (engine.micOn) { engine.stopMic(); await enableMic(); }
}
export async function needMic() { return engine.micOn || (await enableMic()); }

// ---------- 主题 ----------
export function applyTheme() {
  const t = settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#f6f7f9' : '#0e1014';
}
onSettings(applyTheme);
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

export const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const fmtC = (c) => (c > 0 ? '+' : '') + Math.round(c);
export const pct = (x) => Math.round(x * 100) + '%';
export const STR_NAME = { 1: '1 弦', 2: '2 弦', 3: '3 弦', 4: '4 弦', 5: '5 弦', 6: '6 弦' };
export const posText = (s, f) => `${STR_NAME[s]} ${f === 0 ? '空弦' : f + ' 品'}`;
