// bass.js — 低音音色合成（纯函数，没有 Web Audio，Node 里可以直接测试）
//   直接把一个音算成采样数组：加法合成（正弦 + 2、3、4… 次谐波）+ 随时间关小的低通 + 起音/衰减包络 + 轻微饱和。
//   低音的基频（65–123 Hz）手机扬声器基本放不出来，耳朵靠 2 倍、3 倍频（130–370 Hz）「脑补」出音高，
//   所以每种音色都保留一定的 2、3 次谐波；再用低通把 1 kHz 以上压下去，听起来温暖、不刺耳。

export const BASS_TONES = {
  warm:    { name: '温暖电贝斯', desc: '圆润、有弹性，像指弹电贝斯', gain: 1 },
  upright: { name: '低音提琴拨弦', desc: '木头味、颗粒感，衰减快一点，像爵士里的拨弦低音提琴', gain: 1.35 },
  guitar:  { name: '吉他低音弦', desc: '吉他 5、6 弦的拨弦音，和伴奏吉他融在一起', gain: 1 },
};
export const DEFAULT_BASS = 'warm';
/** 低音音区：E2–D#3（82–156 Hz）。比 C2 那一档高一点，2、3 次谐波落在手机扬声器放得出的 160–470 Hz */
export const bassRegister = (pc) => 40 + ((((pc - 4) % 12) + 12) % 12);

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** 柔和起音：raised-cosine，a 秒内从 0 到 1（避免爆音） */
const attackEnv = (t, a) => (t >= a ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t / a));
/** 二阶低通的幅度响应（巴特沃斯），用来给第 k 次谐波加权：效果等同于把合成后的声音过一个低通滤波器 */
const lp2 = (f, fc) => 1 / Math.sqrt(1 + Math.pow(f / fc, 4));

/**
 * 加法合成一个低音。p：
 *   harm  各次谐波的基础幅度（第 1 项 = 基频）
 *   floor 谐波的「最低保留」比例（1 = 不随时间变暗），保证 2、3 次谐波一直在，手机上听得见音高
 *   bright 谐波变暗的速度（1/秒）
 *   fc0, fc1, fcTau  低通截止频率：从 fc0 在 fcTau 秒内降到 fc1（拨弦的「哇」→ 圆润）
 *   attack 起音时间（秒）；sustain, decayTau 起音后衰减到的持续电平与时间常数；fade 整体慢衰减时间常数
 *   drive 饱和量（tanh）
 */
function additive(midi, sr, seconds, p) {
  const f0 = hz(midi), n = Math.round(sr * seconds), x = new Float32Array(n);
  const K = Math.min(p.harm.length, Math.floor(4000 / f0));
  // 每个谐波用「旋转」递推正弦（比逐点 Math.sin 快很多）；谐波幅度和低通按 32 个样本一块更新（控制速率）
  const cs = [], sn = [], cw = [], sw = [];
  for (let k = 1; k <= K; k++) { const ph = (k - 1) * 0.3, w = 2 * Math.PI * f0 * k / sr; cs.push(Math.cos(ph)); sn.push(Math.sin(ph)); cw.push(Math.cos(w)); sw.push(Math.sin(w)); }
  const amp = new Float64Array(K), BLK = 32;
  for (let i0 = 0; i0 < n; i0 += BLK) {
    const t = i0 / sr, fc = p.fc1 + (p.fc0 - p.fc1) * Math.exp(-t / p.fcTau);
    for (let k = 1; k <= K; k++) {
      const fl = k === 1 ? 1 : p.floor[Math.min(k - 2, p.floor.length - 1)];
      amp[k - 1] = p.harm[k - 1] * (fl + (1 - fl) * Math.exp(-t * p.bright * (k - 1))) * lp2(k * f0, fc);
    }
    const end = Math.min(n, i0 + BLK);
    for (let i = i0; i < end; i++) {
      let s = 0;
      for (let k = 0; k < K; k++) {
        s += amp[k] * sn[k];
        const c = cs[k] * cw[k] - sn[k] * sw[k]; sn[k] = sn[k] * cw[k] + cs[k] * sw[k]; cs[k] = c;
      }
      const tt = i / sr;
      x[i] = s * attackEnv(tt, p.attack) * (p.sustain + (1 - p.sustain) * Math.exp(-tt / p.decayTau)) * Math.exp(-tt / p.fade);
    }
    // 防止递推的数值漂移：每块把 (cos, sin) 重新归一化
    for (let k = 0; k < K; k++) { const r = Math.hypot(cs[k], sn[k]); cs[k] /= r; sn[k] /= r; }
  }
  if (p.thump) { // 低音提琴：手指拨弦那一下的「噗」（低通噪声，15 ms）
    let seed = midi * 131 + 7, y = 0;
    const a = Math.exp(-2 * Math.PI * 350 / sr), m = Math.round(sr * 0.03);
    for (let i = 0; i < m && i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280; const r = seed / 233280 * 2 - 1;
      y = a * y + (1 - a) * r;
      x[i] += p.thump * y * Math.exp(-i / sr / 0.012) * attackEnv(i / sr, 0.002) * 6;
    }
  }
  return x;
}

/** Karplus-Strong 拨弦（吉他低音弦），全通小数延迟调准音高，阻尼偏大让低频更圆 */
function ks(midi, sr, seconds, damp = 0.5) {
  const f = hz(midi), n = Math.round(sr * seconds), x = new Float32Array(n);
  const P = sr / f; let L = Math.floor(P + 0.5), d = P + 0.5 - L;
  if (d < 0.1) { L -= 1; d += 1; }
  const C = (1 - d) / (1 + d), line = new Float32Array(L);
  let seed = (midi * 7919 + 104729) % 233280;
  for (let i = 0; i < L; i++) { seed = (seed * 9301 + 49297) % 233280; line[i] = (seed / 233280) * 2 - 1; }
  for (let k = 0; k < 3; k++) for (let i = 1; i < L; i++) line[i] = 0.5 * (line[i] + line[i - 1]); // 拨在弦中间、用指肉：初始波形更圆
  { let m = 0; for (let i = 0; i < L; i++) m += line[i]; m /= L; for (let i = 0; i < L; i++) line[i] -= m; }
  let idx = 0, apX = 0, apY = 0;
  const g = 0.9985;
  for (let i = 0; i < n; i++) {
    const a = line[idx], b = line[(idx + 1) % L];
    x[i] = a;
    const avg = g * ((1 - damp) * a + damp * b); // damp = 0.5 是标准平均滤波
    const y = C * avg + apX - C * apY; apX = avg; apY = y;
    line[idx] = y; idx = (idx + 1) % L;
  }
  for (let i = 0, a = Math.round(sr * 0.004); i < a && i < n; i++) x[i] *= attackEnv(i / sr, 0.004);
  return x;
}

const PRESETS = {
  warm: { harm: [1, 0.8, 0.66, 0.46, 0.26, 0.13, 0.06], floor: [0.85, 0.75, 0.6], bright: 2.2,
    fc0: 1500, fc1: 850, fcTau: 0.09, attack: 0.007, sustain: 0.55, decayTau: 0.28, fade: 2.6, drive: 1.5 },
  upright: { harm: [1, 0.7, 0.62, 0.45, 0.28, 0.15, 0.08, 0.04], floor: [0.65, 0.5, 0.35], bright: 5,
    fc0: 1900, fc1: 750, fcTau: 0.035, attack: 0.005, sustain: 0.3, decayTau: 0.16, fade: 1.0, drive: 1.2, thump: 0.18 },
};

/**
 * 渲染一个低音（Float32Array，峰值归一化到 0.6，开头从 0 起、结尾 30 ms 淡出）。
 * tone：warm | upright | guitar；seconds：渲染长度（播放时再用增益包络在需要的时值止音）
 */
export function renderBass(tone, midi, sr, seconds = 2.5) {
  let x;
  if (tone === 'guitar') {
    const m = midi < 40 ? midi + 12 : midi; // 吉他最低音是 6 弦空弦 E2
    x = ks(m, sr, seconds, 0.62);
    // 叠一点点基频正弦（「下潜」），弥补 KS 低频偏薄
    const f = hz(m), w = 2 * Math.PI * f / sr;
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = 0.85 * x[i] + 0.15 * Math.sin(w * i) * attackEnv(t, 0.006) * Math.exp(-t / 0.9); }
    // 两级一阶低通（≈1.3 kHz）：去掉 KS 在高频的「沙沙」声，只留温暖的拨弦
    const c = Math.exp(-2 * Math.PI * 1300 / sr);
    for (let pass = 0; pass < 2; pass++) { let y = 0; for (let i = 0; i < x.length; i++) { y = c * y + (1 - c) * x[i]; x[i] = y; } }
  } else {
    const p = PRESETS[tone] || PRESETS.warm;
    x = additive(midi, sr, seconds, p);
    // 轻微饱和：tanh 把波峰磨圆，多出一点 2、3 次谐波，听起来更「实」
    let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
    const k = p.drive / (pk || 1), norm = Math.tanh(p.drive);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / norm;
  }
  // 去直流（tanh 不对称时会产生一点），结尾淡出，峰值归一化
  { let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length; for (let i = 0; i < x.length; i++) x[i] -= m * Math.min(1, i / (sr * 0.01)); }
  const fade = Math.round(sr * 0.03);
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk > 0) { const k = 0.6 / pk; for (let i = 0; i < x.length; i++) x[i] *= k; }
  return x;
}
