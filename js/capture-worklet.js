// 把麦克风样本按 1024 一批连同精确的起始帧号发回主线程
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.startFrame = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      if (this.n === 0) this.startFrame = currentFrame + i;
      const take = Math.min(ch.length - i, this.size - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.size) {
        this.port.postMessage({ frame: this.startFrame, data: this.buf.slice(0) });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
