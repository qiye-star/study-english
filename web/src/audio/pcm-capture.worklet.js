/* AudioWorklet:把麦克风输入按 2048 个采样一包发回主线程(原生采样率,降采样在主线程做)。
 * 主线程释放时发 "stop":之后 process() 返回 false,处理器可被回收(页面级上下文从不关闭,review W1 I-2)。 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data !== "stop") return;
      this.stopped = true;
      this.buffer = null;
      this.port.onmessage = null;
      if (this.port.close) this.port.close();
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.length++] = channel[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
