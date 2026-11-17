// latency.js — 两个「设备测试」：回环延迟（自动测）、外部节拍器（听一段，测速度和抖动）
// 两个都只测设备 / 节拍器，不测人。设置面板和节奏训练页共用
import { engine, metro, settings, saveSettings, needMic, markChecked, gateRms } from './core.js';
import { makeChirp, calibSchedule, estimateLoopback, ExternalClickTracker, fitGrid } from './rhythm.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;
export const testBusy = () => busy;

/** 录音：从现在起收集麦克风数据块，stop() 返回连续信号和起点时间 */
function recorder() {
  const chunks = [];
  const off = engine.onChunk((d, t) => chunks.push([t, new Float32Array(d)]));
  return {
    stop() {
      off();
      if (!chunks.length) return null;
      const sr = engine.ctx.sampleRate, t0 = chunks[0][0], last = chunks[chunks.length - 1];
      const sig = new Float32Array(Math.round((last[0] - t0) * sr) + last[1].length);
      for (const [t, d] of chunks) sig.set(d.subarray(0, Math.max(0, Math.min(d.length, sig.length - Math.round((t - t0) * sr)))), Math.max(0, Math.round((t - t0) * sr)));
      return { sig, sr, t0 };
    },
  };
}

/**
 * 回环延迟：喇叭放 8 下随机间隔的「啾」，麦克风录下来，互相关找每一下到达的时间
 * onProgress(i, n) 每放一下调用一次。成功时写入 settings.latencyMs
 * @returns 结果对象（见 rhythm.js estimateLoopback）+ {applied}
 */
export async function runLoopback({ n = 8, onProgress, apply = true } = {}) {
  if (busy) return { ok: false, reason: 'busy' };
  if (!(await needMic())) return { ok: false, reason: 'mic' };
  busy = true;
  try {
    await engine.unlock();
    metro.stop();
    const ctx = engine.ctx, sr = ctx.sampleRate, tpl = makeChirp(sr);
    const sched = calibSchedule(n, (Date.now() & 0xffff) + 1), first = ctx.currentTime + 0.6;
    const times = sched.map((o) => first + o);
    const rec = recorder();
    const vol = Math.max(0.6, Math.min(1, settings.volume + 0.2));
    times.forEach((t) => engine.playSamples(tpl.c, t, vol));
    const end = times[n - 1] + 0.75, deadline = performance.now() + (end - ctx.currentTime) * 1000 + 3000;
    let shown = -1;
    while (engine.lastFrameTime < end && performance.now() < deadline) {
      const k = times.filter((t) => t <= ctx.currentTime).length - 1;
      if (k !== shown && onProgress) { shown = k; onProgress(k, n); }
      await sleep(40);
    }
    const r = rec.stop();
    if (!r) return { ok: false, reason: 'nodata' };
    const est = estimateLoopback(r.sig, r.sr, r.t0, times, { template: tpl });
    if (est.ok && apply && est.confidence !== 'low') { settings.latencyMs = Math.round(est.latencyMs); markChecked('cal'); saveSettings(); est.applied = true; }
    return est;
  } finally { busy = false; }
}
export function loopbackMessage(est) {
  if (est.reason === 'busy') return '正在测另一个项目…';
  if (est.reason === 'mic') return '需要麦克风才能测。';
  if (!est.ok) {
    return `没听清测试音（${est.n || 0}/${est.total || 8} 下）。试试：① 用外放，别戴耳机（耳机里的声音麦克风听不到）；② 把媒体音量调大；③ 周围安静一点，测的时候别弹琴；④ 部分手机会自动消除回声，可以换个浏览器再试。也可以用 −5 / +5 手动调。`;
  }
  const conf = { high: '可信度高', medium: '可信度中', low: '可信度低' }[est.confidence];
  return `${est.applied ? '✓ 已采用' : '未采用'}：设备延迟 ${Math.round(est.latencyMs)} ms（${est.n}/${est.total} 下，离散 ±${est.spreadMs.toFixed(1)} ms，${conf}）` +
    (est.confidence === 'low' ? '。每一下差得太多，没有采用——再测一次，或把音量调大。' : est.confidence === 'medium' ? '。还可以，想更准可以再测一次。' : '');
}

/**
 * 听外部节拍器（另一台手机上的节拍器 App）seconds 秒：只听，不弹琴
 * onClick(t, count) 每听到一下调用
 * @returns fitGrid 结果 + {heard, ok}
 */
export async function listenExternal({ seconds = 8, bpm = null, onClick } = {}) {
  if (busy) return { ok: false, reason: 'busy' };
  if (!(await needMic())) return { ok: false, reason: 'mic' };
  busy = true;
  try {
    metro.stop();
    const tr = new ExternalClickTracker(engine.ctx.sampleRate, { gate: gateRms() * 0.8, bpm, lockN: 1e9 });
    const times = [];
    const off = engine.onChunk((d, t) => { tr.setGate(gateRms() * 0.8); for (const e of tr.process(d, t)) if (e.type === 'cand') { times.push(e.t); onClick && onClick(e.t, times.length); } });
    const end = engine.lastFrameTime + seconds;
    while (engine.lastFrameTime < end) await sleep(50);
    off();
    const fit = fitGrid(times, { bpm });
    if (!fit || fit.inliers < 4) return { ok: false, reason: 'few', heard: times.length };
    return { ok: true, heard: times.length, ...fit };
  } finally { busy = false; }
}
export function externalMessage(r) {
  if (r.reason === 'busy') return '正在测另一个项目…';
  if (r.reason === 'mic') return '需要麦克风才能测。';
  if (!r.ok) return `只听到 ${r.heard || 0} 下，凑不成规律的拍子。把那台手机的节拍器音量调大、放近一点（30–50 cm），每拍响一下，再试。`;
  const q = r.jitterMs < 3 ? '很稳 ✓（起音检测工作正常）' : r.jitterMs < 8 ? '还行' : '抖得厉害：可能有回声或别的声音混进来';
  return `测到 ${r.bpm.toFixed(1)} BPM · 抖动 ±${r.jitterMs.toFixed(1)} ms（最大 ${r.maxDevMs.toFixed(1)} ms）· ${r.inliers}/${r.heard} 下落在拍子上 · ${q}`;
}
