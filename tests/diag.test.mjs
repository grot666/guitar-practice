// 开发者诊断日志：生命周期、上限、序列化、设置变更、代表性事件接入
import {
  createLogger, sanitizeSettings, sanitizeTrackSettings, settingsDiff,
  downloadTextFile, exportViaShareOrDownload, defaultFilename, formatElapsed,
  DIAG_SCHEMA, DIAG_SCHEMA_NAME, DIAG_APP, DIAG_BUILD, DIAG_NOTE_ZH, DEFAULT_LIMITS,
} from '../js/diag.js';
import { NoteSequenceTracker, midiToFreq, centsBetween, snapCents, noteFromFreq } from '../js/dsp.js';
import { RhythmSession, getPattern, METERS } from '../js/rhythm.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } };

function clock() {
  let t = 1_000_000;
  const now = () => t;
  now.advance = (ms) => { t += ms; return t; };
  return now;
}

function walk(obj, fn, path = '') {
  fn(obj, path);
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) walk(v, fn, path ? path + '.' + k : k);
  }
}

function hasRawAudio(obj) {
  const bad = [];
  walk(obj, (v, path) => {
    const key = path.split('.').pop();
    if (/^(pcm|wav|samples|audioBuffer|audioData|float32|int16|rawAudio|base64Audio)$/i.test(key || '')) bad.push(path);
    if (v && typeof v === 'object' && (ArrayBuffer.isView(v) || v instanceof ArrayBuffer)) bad.push(path);
  });
  return bad;
}

function hasSecrets(obj) {
  const bad = [];
  walk(obj, (v, path) => {
    const key = path.split('.').pop();
    if (['deviceId', 'groupId'].includes(key)) bad.push(path + '=' + v);
    if (key === 'label' && /(^|\.)(mic|track|device|environment|settings|browser)(\.|$)/i.test(path)) bad.push(path + '=' + v);
  });
  return bad;
}

console.log('== 1. 生命周期：开始 / 停止后不再记 / 导出 / 保留到新会话或清空');
{
  const now = clock();
  const log = createLogger({ now, limits: { maxEvents: 50, maxDurationMs: 60_000, pitchIntervalMs: 100 } });
  ok(log.status().state === 'idle' && !log.status().recording && !log.status().hasSession, '初始为空且未在记录');
  ok(log.log('pitch', { hz: 261 }) === false, '未开始时 log 必须是空操作');
  ok(log.exportObject() === null, '没有会话时不能导出');

  const s = log.start({ settings: { tolCents: 30, deviceId: 'secret-mic', a4: 440 } });
  ok(s.ok && log.status().recording && log.status().state === 'recording', 'start 进入记录中');
  ok(log.start().reason === 'already-recording', '重复 start 拒绝');
  ok(log.log('mic', { state: 'on' }), '记录中可以写入');
  now.advance(200);
  log.log('pitch', { hz: 261.63 });
  const mid = log.exportObject();
  ok(mid.recording === true && mid.session.stoppedAt === null, '进行中导出：recording=true，还没有 stoppedAt');
  ok(mid.events.some((e) => e.type === 'pitch' && e.hz === 261.63), '进行中导出走得到已有事件');

  const st = log.stop();
  ok(st.ok && !log.status().recording && log.status().state === 'stopped', 'stop 后 recording 必须为 false');
  const after = log.status().eventCount;
  ok(log.log('pitch', { hz: 999 }) === false, 'stop 之后不再写入');
  ok(log.status().eventCount === after, 'stop 之后事件数不变');
  const done = log.exportObject();
  ok(done.recording === false && typeof done.session.stoppedAt === 'string', '停止后导出：recording=false，有 stoppedAt');
  ok(!done.events.some((e) => e.hz === 999), '停止后的事件不得出现在导出里');

  ok(log.start().reason === 'unsaved', '已有日志时，不带 replace 不得偷偷开新会话');
  ok(log.status().eventCount === done.session.eventCount, '拒绝新会话后旧日志仍在');
  ok(log.start({ replace: true }).ok, '显式新会话可以覆盖');
  ok(log.status().recording && log.status().eventCount === 1, '新会话只有 start 事件');
  ok(!log.exportObject().events.some((e) => e.hz === 261.63), '旧事件已被新会话替换');

  log.stop();
  log.clear();
  ok(log.status().state === 'idle' && !log.status().hasSession && log.exportObject() === null, '清空后回到 idle');
}

console.log('== 2. 上限：事件数 / 时长，带 dropped 与 truncated 元数据');
{
  const now = clock();
  const log = createLogger({ now, limits: { maxEvents: 6, maxDurationMs: 60_000, pitchIntervalMs: 0 } });
  log.start();
  let accepted = 0;
  for (let i = 0; i < 20; i++) { if (log.log('misc', { i })) accepted++; }
  const st = log.status();
  ok(!st.recording && st.state === 'stopped', '达到事件上限后自动停止');
  ok(st.truncated && st.truncateReason === 'maxEvents', 'truncated + maxEvents');
  ok(st.eventCount === 6, '事件数正好封顶（含 start/stop）: ' + st.eventCount);
  ok(st.dropped >= 1, '超出的事件计入 dropped: ' + st.dropped);
  const obj = log.exportObject();
  ok(obj.session.truncated && obj.session.dropped === st.dropped, '导出里带同样的截断元数据');
}

{
  const now = clock();
  const log = createLogger({ now, limits: { maxEvents: 4000, maxDurationMs: 5_000, pitchIntervalMs: 0 } });
  log.start();
  log.log('mic', { state: 'on' });
  now.advance(5_000);
  ok(log.log('pitch', { hz: 110 }) === false, '超过时长的事件被拒绝');
  const st = log.status();
  ok(!st.recording && st.truncated && st.truncateReason === 'maxDuration', '超时自动停止并标记 maxDuration');
  ok(st.dropped >= 1, '超时拒绝计入 dropped');
}

console.log('== 3. 序列化：版本 / 时间戳 / 构标识 / 中文说明 / 不含原始音频与设备标识');
{
  const now = clock();
  const log = createLogger({
    now,
    settingsProvider: () => ({ tolCents: 30, deviceId: 'abc-device', a4: 442, octaveFree: false }),
    envProvider: () => ({
      browser: { userAgent: 'TestAgent/1.0', language: 'zh-CN' },
      audio: { sampleRate: 48000, state: 'running', baseLatency: 0.005 },
      mic: { active: true, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    }),
  });
  log.start({ settings: { tolCents: 30, deviceId: 'abc-device', a4: 442, volume: 0.9 } });
  now.advance(50);
  log.log('mic', { state: 'on', error: '', track: sanitizeTrackSettings({ sampleRate: 48000, deviceId: 'abc-device', groupId: 'g1', label: 'USB Mic', echoCancellation: false }) });
  now.advance(50);
  log.logPitch({ raw: 261.63, freq: 261.6, midi: 60, name: 'C4', cents: 0.2, clarity: 0.97, db: -18.3, rms: 0.04 });
  log.stop();
  const obj = log.exportObject();
  const text = log.exportText();
  ok(obj.schema === DIAG_SCHEMA && obj.schemaName === DIAG_SCHEMA_NAME, 'schema');
  ok(obj.app === DIAG_APP && obj.build && obj.build.id === DIAG_BUILD, 'build identification');
  ok(typeof obj.exportedAt === 'string' && obj.exportedAt.endsWith('Z'), 'exportedAt ISO UTC');
  ok(typeof obj.session.startedAt === 'string' && typeof obj.session.stoppedAt === 'string', 'session timestamps');
  ok(typeof obj.session.durationMs === 'number' && obj.session.durationMs >= 100, 'durationMs');
  ok(obj.notes && obj.notes.zh === DIAG_NOTE_ZH && obj.notes.audio === false && obj.notes.uploaded === false, '中文说明：仅诊断、无录音、不上传');
  ok(obj.settings.tolCents === 30 && obj.settings.a4 === 442, '设置快照保留安全字段');
  ok(obj.settings.deviceId === undefined, '设置快照不含 deviceId');
  ok(obj.environment.audio.sampleRate === 48000 && obj.environment.mic.echoCancellation === false, '采样率与麦克风非标识设置');
  const secrets = hasSecrets(obj);
  ok(secrets.length === 0, '整份导出不含 deviceId/groupId/label: ' + secrets.join(','));
  const audioBits = hasRawAudio(obj);
  ok(audioBits.length === 0, '不含原始音频字段: ' + audioBits.join(','));
  const parsed = JSON.parse(text);
  ok(parsed.schema === DIAG_SCHEMA && parsed.events.length === obj.events.length, 'exportText 可解析且完整');
  ok(text.includes('不含原始录音') && text.includes('不会被自动上传'), '导出文本含中文说明');
}

console.log('== 4. 动态设置：中途改容差等会记入事件');
{
  const now = clock();
  let current = { tolCents: 30, octaveFree: false, a4: 440, deviceId: 'keep-secret' };
  const log = createLogger({ now, settingsProvider: () => current });
  log.start({ settings: current });
  now.advance(10);
  current = { ...current, tolCents: 50, a4: 442 };
  const diff = settingsDiff({ tolCents: 30, octaveFree: false, a4: 440, deviceId: 'keep-secret' }, current);
  ok(diff.tolCents && diff.tolCents.from === 30 && diff.tolCents.to === 50, '容差 diff');
  ok(diff.a4 && diff.a4.to === 442, 'A4 diff');
  ok(!diff.deviceId, 'deviceId 不得出现在 diff 里');
  log.log('settings', { changed: diff });
  log.stop();
  const ev = log.exportObject().events.find((e) => e.type === 'settings');
  ok(ev && ev.changed.tolCents.to === 50 && ev.changed.a4.to === 442, '设置变更事件已记录');
  ok(JSON.stringify(ev).indexOf('keep-secret') === -1, '设置变更事件不含设备 id');
}

console.log('== 5. 音高节流：平稳帧抽样，掉音和换音立即记');
{
  const now = clock();
  const log = createLogger({ now, limits: { maxEvents: 200, maxDurationMs: 60_000, pitchIntervalMs: 120 } });
  log.start();
  let kept = 0;
  for (let i = 0; i < 20; i++) {
    if (log.logPitch({ raw: 261.63, freq: 261.63, midi: 60, name: 'C4', cents: 0, clarity: 0.95, db: -16 })) kept++;
    now.advance(10);
  }
  ok(kept >= 1 && kept <= 4, '约 200ms 内平稳 C4 只抽到少量帧: ' + kept);
  now.advance(10);
  ok(log.logPitch({ raw: null, freq: null, db: -80 }), '掉音立即记录');
  now.advance(10);
  ok(log.logPitch({ raw: 65.41, freq: 65.41, midi: 36, name: 'C2', cents: 0, clarity: 0.99, db: -16 }), '换成 C2 立即记录');
  log.stop();
  const pitches = log.exportObject().events.filter((e) => e.type === 'pitch');
  ok(pitches.some((e) => e.drop) && pitches.some((e) => e.name === 'C2' && e.hz === 65.41), '导出含掉音和 C2');
  ok(pitches.length < 10, '节流后音高事件远少于原始帧: ' + pitches.length);
}

console.log('== 6. 接入代表性判定：音准跟踪器（含八度折回）+ 节奏早晚');
{
  const now = clock();
  const log = createLogger({ now });
  log.start({ settings: { tolCents: 30, octaveFree: false, a4: 440 } });

  // 等我模式：目标 C4，检测器给出 C2（低两个八度）——这是真实会出现的误判
  const tracker = new NoteSequenceTracker([60], { tolCents: 30, stableFrames: 3, a4: 440, octaveFree: false });
  const fC2 = midiToFreq(36);
  let ev = null;
  for (let i = 0; i < 4; i++) ev = tracker.update({ freq: fC2, time: i * 0.04, onset: i === 0 }) || ev;
  ok(ev && ev.type === 'hit', 'C2 对目标 C4 经 snapCents 后应判 hit（现有八度安全网）');
  const raw = centsBetween(ev.freq, midiToFreq(60));
  const snapped = ev.cents;
  const oct = Math.round((raw - snapped) / 1200);
  ok(Math.abs(raw + 2400) < 1 && oct === -2, `原始音分约 -2400，折回 2 个八度（raw=${raw.toFixed(1)}, snap=${snapped.toFixed(1)}）`);
  log.log('score', {
    mode: 'wait', decision: ev.type, index: ev.index, targetMidi: 60, targetName: 'C4',
    freq: ev.freq, playedMidi: 36, cents: snapped, centsRaw: raw, octaveSnap: oct,
    tolCents: 30, octaveFree: false,
  });

  // 跟拍窗口：多数帧在容差外
  const frames = [-2400, -2395, 12, 8, 5].map((c) => c);
  const good = frames.filter((c) => Math.abs(snapCents(c, false)) <= 30);
  const okAlong = good.length >= Math.max(1, Math.ceil(frames.length * 0.3));
  log.log('score', {
    mode: 'along', decision: okAlong ? 'hit' : 'miss', index: 0, targetMidi: 60, targetName: 'C4',
    frames: frames.length, good: good.length, need: Math.max(1, Math.ceil(frames.length * 0.3)),
    tolCents: 30, octaveFree: false,
  });
  ok(okAlong, '跟拍在折回后应有足够好帧');

  // 节奏训练：早 / 晚
  const sess = new RhythmSession({ pattern: getPattern('e'), meter: METERS['4/4'], tol: { green: 30, yellow: 60 } });
  const bar = sess.addBar(0, 1.0, 0.5);
  const early = sess.hit(1.0 - 0.040);
  const late = sess.hit(1.0 + 0.5 + 0.055);
  ok(early.grade && early.errMs < 0, '早击为负误差');
  ok(late.grade && late.errMs > 0, '晚击为正误差');
  log.log('beat', { kind: 'hit', errMs: early.errMs, grade: early.grade, at: early.at, label: early.label, extra: !!early.extra, tolG: 30, tolY: 60, bpm: 120, latencyMs: 0 });
  log.log('beat', { kind: 'hit', errMs: late.errMs, grade: late.grade, at: late.at, label: late.label, extra: !!late.extra, tolG: 30, tolY: 60, bpm: 120, latencyMs: 0 });
  const closed = sess.closeBar(bar, true);
  log.log('beat', { kind: 'bar', index: closed.index, accuracy: closed.accuracy, miss: closed.miss, extras: closed.extras.length, ok: closed.ok, notes: closed.notes.map((n) => ({ at: n.at, errMs: n.errMs, grade: n.grade })) });

  log.stop();
  const obj = log.exportObject();
  const score = obj.events.filter((e) => e.type === 'score');
  const beats = obj.events.filter((e) => e.type === 'beat');
  ok(score.length === 2 && score[0].centsRaw < -2300 && score[0].octaveSnap === -2 && score[0].decision === 'hit', '音准事件含原始音分、折回和判定');
  ok(score[1].mode === 'along' && score[1].frames === 5 && score[1].good >= 3, '跟拍事件含帧数与好帧数');
  ok(beats.some((e) => e.kind === 'hit' && e.errMs < 0) && beats.some((e) => e.kind === 'hit' && e.errMs > 0), '节奏事件含早/晚');
  ok(beats.some((e) => e.kind === 'bar' && Array.isArray(e.notes)), '小节结算事件');
  ok(hasSecrets(obj).length === 0 && hasRawAudio(obj).length === 0, '集成导出仍无密钥和原始音频');
}

console.log('== 7. 清洗与下载失败路径（诚实报告，不假装成功）');
{
  const s = sanitizeSettings({ a4: 440, deviceId: 'X', foo: 1, tolCents: 40, checked: { mic: true } });
  ok(s.a4 === 440 && s.tolCents === 40 && s.checked.mic === true && s.deviceId === undefined && s.foo === undefined, 'settings 白名单');
  const t = sanitizeTrackSettings({ sampleRate: 44100, deviceId: 'X', groupId: 'g', label: 'Mic', echoCancellation: true, channelCount: 1 });
  ok(t.sampleRate === 44100 && t.echoCancellation === true && t.deviceId === undefined && t.groupId === undefined && t.label === undefined, 'track 去掉标识');

  ok(downloadTextFile('a.json', '{}').reason === 'no-document', 'Node 环境没有 document 时诚实失败');
  ok(downloadTextFile('a.json', '{}', { document: {}, Blob: null, URL: { createObjectURL() {} } }).reason === 'no-blob', '没有 Blob 时诚实失败');
  ok(downloadTextFile('a.json', '{}', { document: { createElement() { return {}; } }, Blob: class {}, URL: null }).reason === 'no-object-url', '没有 createObjectURL 时诚实失败');

  let clicked = 0, revoked = 0;
  const el = { href: '', download: '', rel: '', style: { display: '' }, click() { clicked++; }, remove() {} };
  const fakeDoc = {
    createElement: (tag) => (tag === 'a' ? el : {}),
    body: { appendChild(node) { this.last = node; } },
  };
  const fakeURL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => { revoked++; } };
  const d = downloadTextFile('guitar-practice-diag.json', '{"ok":1}', { document: fakeDoc, Blob, URL: fakeURL });
  ok(d.ok && d.method === 'download' && clicked === 1 && el.download === 'guitar-practice-diag.json', '可下载时用 <a download>');

  const cancelled = await exportViaShareOrDownload('f.json', '{}', {
    navigator: { share: async () => { const e = new Error('nope'); e.name = 'AbortError'; throw e; }, canShare: () => true },
    File,
  });
  ok(cancelled.reason === 'cancelled', '用户取消分享不假装导出成功');

  ok(formatElapsed(0) === '0:00' && formatElapsed(65000) === '1:05', '耗时格式');
  ok(defaultFilename('2026-11-20T12:03:04.000+08:00').startsWith('guitar-practice-diag-'), '文件名有前缀');
}

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
