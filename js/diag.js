// diag.js — 开发者诊断日志（纯逻辑，浏览器与 Node 共用）
// 只记录结构化诊断信息，不含原始录音，也不上传。

export const DIAG_SCHEMA = 1;
export const DIAG_SCHEMA_NAME = 'guitar-practice-diag';
export const DIAG_APP = 'guitar-practice';
export const DIAG_BUILD = '2026-11-20-pitch-2';

export const DEFAULT_LIMITS = {
  maxEvents: 4000,
  maxDurationMs: 15 * 60 * 1000,
  pitchIntervalMs: 120,
};

export const SETTINGS_KEYS = ['a4', 'gateDb', 'autoGate', 'latencyMs', 'sens', 'outMode', 'volume', 'tolCents', 'octaveFree', 'theme', 'checked'];
export const SENSITIVE_TRACK_KEYS = ['deviceId', 'groupId', 'label'];

export const DIAG_NOTE_ZH = '本文件只含诊断信息（音高、判定、设置、麦克风状态），不含原始录音，也不会被自动上传。';

export function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return {};
  const out = {};
  for (const k of SETTINGS_KEYS) {
    if (s[k] !== undefined) out[k] = cloneJson(s[k]);
  }
  return out;
}

export function sanitizeTrackSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (SENSITIVE_TRACK_KEYS.includes(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : {};
}

export function settingsDiff(prev, next) {
  const a = sanitizeSettings(prev), b = sanitizeSettings(next);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = {};
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed[k] = { from: a[k], to: b[k] };
  }
  return changed;
}

export function round(n, d = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

export function defaultFilename(startedAt) {
  const d = startedAt ? new Date(startedAt) : new Date();
  if (Number.isNaN(d.getTime())) return 'guitar-practice-diag.json';
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `guitar-practice-diag-${stamp}.json`;
}

export function collectBrowserEnv(nav = (typeof navigator !== 'undefined' ? navigator : null), win = (typeof window !== 'undefined' ? window : null)) {
  if (!nav) return null;
  return omitUndef({
    userAgent: nav.userAgent,
    language: nav.language,
    platform: nav.platform,
    vendor: nav.vendor,
    maxTouchPoints: nav.maxTouchPoints,
    isSecureContext: win ? win.isSecureContext : undefined,
  });
}

export function collectAudioEnv(engine) {
  if (!engine) return { audio: null, mic: { active: false } };
  const ctx = engine.ctx;
  const audio = ctx ? omitUndef({
    sampleRate: ctx.sampleRate,
    state: ctx.state,
    baseLatency: typeof ctx.baseLatency === 'number' ? ctx.baseLatency : undefined,
    outputLatency: typeof ctx.outputLatency === 'number' ? ctx.outputLatency : undefined,
    sessionType: engine.sessionType || undefined,
  }) : null;
  const mic = engine.micTrackInfo ? engine.micTrackInfo() : { active: !!engine.micOn };
  return { audio, mic };
}

function cloneJson(v) {
  if (v == null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

function omitUndef(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 创建会话式日志器。
 * state: idle（无日志）| recording（正在记）| stopped（已停，日志还在，可导出）
 * 再次 start() 在已有日志时默认拒绝，需 { replace: true } 才会开新会话。
 */
export function createLogger(opts = {}) {
  const now = opts.now || (() => Date.now());
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const listeners = new Set();

  let state = 'idle';
  let session = null;
  let lastPitchAt = -Infinity;
  let lastPitchKey = '';
  let envProvider = opts.envProvider || null;
  let settingsProvider = opts.settingsProvider || null;
  let contextProvider = opts.contextProvider || null;

  const elapsed = () => (session ? Math.max(0, (state === 'recording' ? now() : (session.stoppedAtMs || now())) - session.startedAtMs) : 0);

  function status() {
    if (state === 'recording' && session && now() - session.startedAtMs >= limits.maxDurationMs) autoStop('maxDuration');
    return {
      state,
      recording: state === 'recording',
      hasSession: !!session,
      eventCount: session ? session.events.length : 0,
      dropped: session ? session.dropped : 0,
      truncated: !!(session && session.truncated),
      truncateReason: session ? session.truncateReason : null,
      startedAt: session ? session.startedAt : null,
      stoppedAt: session ? session.stoppedAt : null,
      durationMs: elapsed(),
      limits: { ...limits },
    };
  }

  function emit() { listeners.forEach((f) => { try { f(status()); } catch {} }); }

  function start(startOpts = {}) {
    if (state === 'recording') return { ok: false, reason: 'already-recording' };
    if (session && !startOpts.replace) return { ok: false, reason: 'unsaved' };
    const t = now();
    const settings = sanitizeSettings(startOpts.settings ?? (settingsProvider ? settingsProvider() : {}));
    const env = startOpts.env ?? (envProvider ? envProvider() : null);
    session = {
      startedAt: new Date(t).toISOString(),
      startedAtMs: t,
      stoppedAt: null,
      stoppedAtMs: null,
      settings,
      env: env || null,
      events: [],
      dropped: 0,
      truncated: false,
      truncateReason: null,
    };
    lastPitchAt = -Infinity;
    lastPitchKey = '';
    state = 'recording';
    const ctx = contextProvider ? contextProvider() : null;
    session.events.push(compact({
      t: 0,
      type: 'session',
      action: 'start',
      view: ctx && ctx.view,
      settings,
    }));
    emit();
    return { ok: true, startedAt: session.startedAt };
  }

  function stop(reason = 'user') {
    if (state !== 'recording') return { ok: false, reason: 'not-recording' };
    const t = now();
    session.stoppedAtMs = t;
    session.stoppedAt = new Date(t).toISOString();
    state = 'stopped';
    if (session.events.length < limits.maxEvents) {
      session.events.push(compact({ t: t - session.startedAtMs, type: 'session', action: 'stop', reason }));
    }
    emit();
    return { ok: true, reason, stoppedAt: session.stoppedAt };
  }

  function autoStop(reason) {
    if (state !== 'recording') return;
    session.truncated = true;
    session.truncateReason = reason;
    stop(reason);
  }

  function clear() {
    if (state === 'recording') stop('clear');
    session = null;
    state = 'idle';
    lastPitchAt = -Infinity;
    lastPitchKey = '';
    emit();
    return { ok: true };
  }

  function log(type, payload = {}) {
    if (state !== 'recording' || !session) return false;
    if (now() - session.startedAtMs >= limits.maxDurationMs) {
      session.dropped++;
      autoStop('maxDuration');
      return false;
    }
    if (session.events.length >= limits.maxEvents) {
      session.dropped++;
      autoStop('maxEvents');
      return false;
    }
    const ev = compact({ t: now() - session.startedAtMs, type, ...payload });
    session.events.push(ev);
    return true;
  }

  /**
   * 节流后的音高帧。电平 / 频率突变、音符变化、从有到无（掉音）立即记；
   * 平稳持续的音按 pitchIntervalMs 抽样。
   */
  function logPitch(frame = {}, extra = {}) {
    if (state !== 'recording') return false;
    const hz = numOrNull(frame.raw ?? frame.hz ?? frame.freq);
    const sm = numOrNull(frame.freq ?? frame.sm);
    const drop = !(hz > 0);
    const midi = Number.isFinite(frame.midi) ? frame.midi : extra.midi;
    const key = drop ? (frame.status || 'drop') : String(midi ?? Math.round(hz || 0));
    const t = now();
    const changed = key !== lastPitchKey;
    const due = (t - lastPitchAt) >= limits.pitchIntervalMs;
    if (!changed && !due) return false;
    lastPitchAt = t;
    lastPitchKey = key;
    const ctx = contextProvider ? contextProvider() : null;
    const practice = extra.practice || (ctx && ctx.practice) || undefined;
    return log('pitch', compact({
      status: frame.status, audioTime: frame.audioTime, gate: frame.gate,
      hz: hz == null ? null : round(hz, 2),
      sm: sm == null ? null : round(sm, 2),
      midi: Number.isFinite(midi) ? midi : undefined,
      name: frame.name || extra.name,
      cents: numOrNull(frame.cents) != null ? round(frame.cents, 1) : undefined,
      clarity: numOrNull(frame.clarity) != null ? round(frame.clarity, 3) : undefined,
      db: numOrNull(frame.db) != null ? round(frame.db, 1) : undefined,
      rms: numOrNull(frame.rms) != null ? round(frame.rms, 5) : undefined,
      held: frame.held || undefined,
      drop: drop || undefined,
      view: (ctx && ctx.view) || extra.view,
      target: practice && practice.target,
      mode: practice && practice.mode,
      running: practice && practice.running,
    }));
  }

  function exportObject() {
    if (!session) return null;
    if (state === 'recording' && now() - session.startedAtMs >= limits.maxDurationMs) autoStop('maxDuration');
    const envNow = envProvider ? envProvider() : null;
    const ctx = contextProvider ? contextProvider() : null;
    return {
      schema: DIAG_SCHEMA,
      schemaName: DIAG_SCHEMA_NAME,
      app: DIAG_APP,
      build: { id: DIAG_BUILD },
      exportedAt: new Date(now()).toISOString(),
      recording: state === 'recording',
      session: {
        startedAt: session.startedAt,
        stoppedAt: session.stoppedAt,
        durationMs: elapsed(),
        eventCount: session.events.length,
        dropped: session.dropped,
        truncated: session.truncated,
        truncateReason: session.truncateReason,
      },
      environment: mergeEnv(session.env, envNow, ctx),
      settings: cloneJson(session.settings),
      events: session.events,
      notes: { zh: DIAG_NOTE_ZH, audio: false, uploaded: false },
    };
  }

  function exportText() {
    const obj = exportObject();
    return obj ? JSON.stringify(obj, null, 2) : null;
  }

  return {
    start, stop, clear, log, logPitch, exportObject, exportText, status,
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    setEnvProvider: (fn) => { envProvider = fn; },
    setSettingsProvider: (fn) => { settingsProvider = fn; },
    setContextProvider: (fn) => { contextProvider = fn; },
    get limits() { return { ...limits }; },
  };
}

function mergeEnv(start, nowEnv, ctx) {
  const a = start || {}, b = nowEnv || {};
  return compact({
    browser: b.browser || a.browser || null,
    audio: b.audio || a.audio || null,
    mic: b.mic || a.mic || null,
    view: (ctx && ctx.view) || b.view || a.view || undefined,
  });
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function dep(deps, name, fallback) {
  return Object.prototype.hasOwnProperty.call(deps, name) ? deps[name] : fallback;
}

export function downloadTextFile(filename, text, deps = {}) {
  const doc = dep(deps, 'document', typeof document !== 'undefined' ? document : null);
  const B = dep(deps, 'Blob', typeof Blob !== 'undefined' ? Blob : null);
  const U = dep(deps, 'URL', typeof URL !== 'undefined' ? URL : null);
  if (!doc) return { ok: false, reason: 'no-document' };
  if (!B) return { ok: false, reason: 'no-blob' };
  if (!U || typeof U.createObjectURL !== 'function') return { ok: false, reason: 'no-object-url' };
  try {
    const blob = new B([text], { type: 'application/json' });
    const url = U.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    (doc.body || doc.documentElement).appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); U.revokeObjectURL(url); } catch {} }, 2000);
    return { ok: true, method: 'download', filename };
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e && e.message) || e) };
  }
}

export async function exportViaShareOrDownload(filename, text, deps = {}) {
  const nav = deps.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
  const FileCtr = deps.File ?? (typeof File !== 'undefined' ? File : null);
  if (nav && typeof nav.share === 'function' && FileCtr) {
    try {
      const file = new FileCtr([text], filename, { type: 'application/json' });
      const can = typeof nav.canShare !== 'function' || nav.canShare({ files: [file] });
      if (can) {
        await nav.share({ files: [file], title: filename, text: DIAG_NOTE_ZH });
        return { ok: true, method: 'share', filename };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      // 分享失败则改走下载
    }
  }
  return downloadTextFile(filename, text, deps);
}

export const diag = createLogger();
export const logDiag = (type, payload) => diag.log(type, payload);
