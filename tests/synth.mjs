// 合成测试信号
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function sine(f, dur, sr, amp = 0.5) {
  const n = Math.round(dur * sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / sr);
  return x;
}
// 带谐波（基频偏弱、二次谐波强，模拟低音弦）
export function harmonic(f, dur, sr, amps = [0.35, 0.6, 0.3, 0.2, 0.1], inharm = 0.0004) {
  const n = Math.round(dur * sr), x = new Float32Array(n);
  amps.forEach((a, h) => {
    const k = h + 1, fk = f * k * Math.sqrt(1 + inharm * k * k);
    for (let i = 0; i < n; i++) x[i] += 0.5 * a * Math.sin((2 * Math.PI * fk * i) / sr) * Math.exp(-i / sr * (1 + k * 0.6));
  });
  return x;
}
// Karplus-Strong 拨弦
export function pluck(f, dur, sr, amp = 0.6, seed = 7, decay = 0.996) {
  const n = Math.round(dur * sr), x = new Float32Array(n);
  const p = sr / f, L = Math.floor(p), frac = p - L;
  const r = rng(seed), buf = new Float32Array(L);
  for (let i = 0; i < buf.length; i++) buf[i] = r() * 2 - 1;
  // 简单分数延迟：一阶全通近似用线性插值
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = buf[idx % buf.length];
    const b = buf[(idx + 1) % buf.length];
    const out = a;
    buf[idx % buf.length] = decay * 0.5 * (a + b);
    x[i] = out * amp;
    idx++;
  }
  // 结尾 20ms 淡出，避免截断产生假起音
  const fade = Math.min(n, Math.round(0.02 * sr));
  for (let i = 0; i < fade; i++) x[n - 1 - i] *= i / fade;
  // 递推 y[n] = 0.5(y[n-L] + y[n-L+1])，实际周期 L-0.5 样本
  return { x, f: sr / (L - 0.5) };
}
export function addNoise(x, level, seed = 3) {
  const r = rng(seed);
  for (let i = 0; i < x.length; i++) x[i] += (r() * 2 - 1) * level;
  return x;
}
export function mixAt(dst, src, startSample) {
  for (let i = 0; i < src.length && startSample + i < dst.length; i++) dst[startSample + i] += src[i];
}
export function click(sr, amp = 0.8, ms = 3) {
  const n = Math.round((ms / 1000) * sr), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * 2000 * i) / sr) * (1 - i / n);
  return x;
}
