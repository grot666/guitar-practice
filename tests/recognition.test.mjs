import assert from 'node:assert/strict';
import { PitchRecognizer } from '../js/recognition.js';
import { midiToFreq, NoteSequenceTracker, pitchWindowVerdict } from '../js/dsp.js';
import { createLogger } from '../js/diag.js';

for (const sr of [22050, 44100, 48000, 96000]) {
  // E2、静音、E4，块长与音符边界故意不对齐。
  const pcm = Float32Array.from({ length: sr }, (_, i) => {
    if (i / sr >= 0.3 && i / sr < 0.55) return 0;
    const midi = i / sr < 0.3 ? 40 : 64;
    return 0.3 * Math.sin(2 * Math.PI * midiToFreq(midi) * i / sr);
  });
  function replay(block) {
    const recognizer = new PitchRecognizer(sr);
    const frames = [];
    for (let i = 0; i < pcm.length; i += block) {
      recognizer.process(pcm.subarray(i, i + block), i / sr, 0.005, (f) => frames.push(f));
    }
    return frames;
  }
  const frames = replay(1024);
  assert.deepEqual(frames.map(f => f.raw), replay(317).map(f => f.raw));
  assert.ok(frames.some(f => f.held && f.raw === null && f.status === 'below_gate'));
  const tracker = new NoteSequenceTracker([64], { stableFrames: 3 });
  const decisions = frames.map(f => tracker.update({ time: f.time, freq: f.raw })).filter(Boolean);
  assert.deepEqual(decisions.map(e => e.type), ['miss', 'hit']);
  assert.ok(Math.abs(decisions[0].cents + 2400) < 3);
  const recognizer = new PitchRecognizer(sr);
  recognizer.process(pcm.subarray(0, sr / 4), 0, 0.005, () => {});
  recognizer.process(new Float32Array(recognizer.window.length), 10, 0.005, f => assert.equal(f.show, null));
}
const lowTone = Float32Array.from({ length: 4800 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 65.41 * i / 48000));
new PitchRecognizer(48000).process(lowTone, 0, 0.005, frame => assert.equal(frame.status, 'unresolved'));
assert.equal(pitchWindowVerdict([0], 10, 30).reason, 'insufficient');
assert.equal(pitchWindowVerdict([-2400, -2400], 3, 30).reason, 'off_pitch');
assert.equal(pitchWindowVerdict([1, -2, 3], 10, 30).reason, 'hit');
const logger = createLogger();
logger.start();
logger.logPitch({ raw: null, status: 'below_gate', gate: 0.005, audioTime: 2 });
logger.logPitch({ raw: null, status: 'unresolved', gate: 0.005, audioTime: 2.04 });
const drops = logger.exportObject().events.filter(e => e.type === 'pitch');
assert.deepEqual(drops.map(e => [e.status, e.gate, e.audioTime]), [
  ['below_gate', 0.005, 2], ['unresolved', 0.005, 2.04],
]);
console.log('PCM 回放、严格八度、跟拍证据和掉音日志通过');
