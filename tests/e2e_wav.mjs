// 生成端到端测试用的假麦克风录音（WAV），写到 argv[2] 目录
import { writeFileSync } from 'fs';
import { pluck, addNoise, mixAt, rng } from './synth.mjs';
const SR = 48000, dir = process.argv[2] || '/tmp';
function wav(x, path) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}
const F = [165, 196, 220, 247];
// 1) 内置节拍器：100 BPM 八分音符，拍上准、后半拍一律晚 45 ms
{
  const x = new Float32Array(60 * SR);
  for (let k = 0; 0.5 + k * 0.6 < 59; k++) {
    mixAt(x, pluck(F[k % 4], 0.5, SR, 0.45, 10 + k).x, Math.round((0.5 + k * 0.6) * SR));
    mixAt(x, pluck(F[(k + 2) % 4], 0.4, SR, 0.4, 500 + k).x, Math.round((0.5 + k * 0.6 + 0.3 + 0.045) * SR));
  }
  wav(addNoise(x, 0.002), dir + '/beat-int.wav');
}
// 2) 外部节拍器：96 BPM 的「嗒」，7 秒后开始每拍弹一下，四拍的偏差依次 0 / −30 / +40 / +60 ms
{
  const x = new Float32Array(60 * SR), P = 0.625, r = rng(3);
  const click = (amp) => { const n = Math.round(0.03 * SR), c = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; c[i] = amp * (Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t / 0.003) + 0.3 * Math.sin(2 * Math.PI * 1100 * t) * Math.exp(-t / 0.004)); } return c; };
  const offs = [0, -0.03, 0.04, 0.06];
  for (let k = 0; 0.3 + k * P < 59; k++) {
    const t = 0.3 + k * P + (r() - 0.5) * 0.001;
    mixAt(x, click(0.2), Math.round(t * SR));
    if (t > 7) mixAt(x, pluck(F[k % 4], 0.55, SR, 0.45, 900 + k).x, Math.round((0.3 + k * P + offs[k % 4]) * SR));
  }
  wav(addNoise(x, 0.002), dir + '/beat-ext.wav');
  // 只有节拍器（设置里的「外部节拍器测试」）
  const y = new Float32Array(30 * SR);
  for (let k = 0; 0.3 + k * P < 29; k++) mixAt(y, click(0.2), Math.round((0.3 + k * P + (r() - 0.5) * 0.002) * SR));
  wav(addNoise(y, 0.002), dir + '/beat-clicks.wav');
}
// 3) 安静的房间（只有底噪）：自动测延迟用
wav(addNoise(new Float32Array(20 * SR), 0.003, 9), dir + '/room.wav');
console.log('ok');
