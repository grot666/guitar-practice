// Usage: node tools/replay-pitch.mjs mono-pcm16.wav E2
import { readFileSync } from 'node:fs';
import { PitchRecognizer } from '../js/recognition.js';
import { centsBetween, midiToFreq, parseNoteName } from '../js/dsp.js';

const [file, expected] = process.argv.slice(2);
const midi = parseNoteName(expected || '');
if (!file || midi === null) throw new Error('用法：node tools/replay-pitch.mjs 单音.wav E2');
const wav = readFileSync(file);
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('需要 RIFF WAV 文件');
let rate, pcm;
for (let i = 12; i + 8 <= wav.length;) {
  const tag = wav.toString('ascii', i, i + 4);
  const size = wav.readUInt32LE(i + 4);
  const start = i + 8;
  if (start + size > wav.length) throw new Error('WAV 数据不完整');
  if (tag === 'fmt ') {
    if (size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 || wav.readUInt16LE(start + 14) !== 16)
      throw new Error('仅支持单声道 16-bit PCM WAV');
    rate = wav.readUInt32LE(start + 4);
  }
  if (tag === 'data') pcm = wav.subarray(start, start + size);
  i = start + size + size % 2;
}
if (!pcm?.length || pcm.length % 2 || !(rate >= 8000 && rate <= 192000)) throw new Error('缺少有效音频数据或采样率超出范围');
const recognizer = new PitchRecognizer(rate);
const targetHz = midiToFreq(midi);
let total = 0, voiced = 0, within30 = 0, wrongOctave = 0, firstMatchSec = null;
for (let i = 0; i < pcm.length; i += 2048) {
  const block = new Float32Array(Math.min(2048, pcm.length - i) / 2);
  for (let j = 0; j < block.length; j++) block[j] = pcm.readInt16LE(i + j * 2) / 32768;
  recognizer.process(block, i / 2 / rate, 0.005, frame => {
    total++;
    if (!frame.raw) return;
    voiced++;
    const cents = centsBetween(frame.raw, targetHz);
    if (Math.abs(cents) <= 30) { within30++; firstMatchSec ??= frame.time; }
    const octaves = Math.round(cents / 1200);
    if (octaves && Math.abs(cents - 1200 * octaves) <= 30) wrongOctave++;
  });
}
console.log(JSON.stringify({ expected, rate, a4: 440, gate: 0.005, total, voiced, within30, wrongOctave, firstMatchSec }, null, 2));
