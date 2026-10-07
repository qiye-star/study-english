import { frameRms, pcm16ToFloat } from "./pcm";

export interface PcmPlayer {
  play(turnId: number, pcm: Int16Array): void;
  stop(): void;
  readonly playing: boolean;
  onDrained(cb: () => void): () => void;
  level(): number;
  close(): void;
}

/**
 * 实时通话下行音频:按轮次排队,WebAudio 精确排程(设计文档 §5)。
 * 不自建 AudioContext(使用调用方提供的页面级上下文),也不关闭它;close() 只释放本模块创建的节点。
 */
export function createPcmPlayer(ctx: AudioContext, opts: { sampleRate?: number; leadMs?: number } = {}): PcmPlayer {
  const rate = opts.sampleRate ?? 24000;
  const lead = (opts.leadMs ?? 120) / 1000;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const sources = new Set<AudioBufferSourceNode>();
  const drained = new Set<() => void>();
  let turn = 0;
  let next = 0;
  let last = 0;
  let closed = false;

  function release(source: AudioBufferSourceNode): void {
    try {
      source.disconnect();
    } catch {
      /* 已断开 */
    }
  }

  function stop(): void {
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* 尚未开始或已结束 */
      }
      release(source);
    }
    sources.clear();
    next = 0;
    last = 0;
  }

  return {
    play(turnId, pcm) {
      if (closed || turnId < turn || !pcm.length) return;
      if (turnId > turn) {
        stop();
        turn = turnId;
      }
      const samples = pcm16ToFloat(pcm);
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const when = sources.size ? Math.max(next, ctx.currentTime) : ctx.currentTime + lead;
      source.onended = () => {
        if (!sources.has(source)) return; // 已被 stop() 清除的旧源
        sources.delete(source);
        release(source);
        if (!sources.size) [...drained].forEach((cb) => cb());
      };
      source.start(when);
      next = when + buffer.duration;
      sources.add(source);
      last = frameRms(samples);
    },
    stop,
    get playing() {
      return sources.size > 0;
    },
    onDrained(cb) {
      drained.add(cb);
      return () => drained.delete(cb);
    },
    level: () => (sources.size ? last : 0),
    close() {
      if (closed) return;
      closed = true;
      stop();
      drained.clear();
      try {
        gain.disconnect();
      } catch {
        /* 已断开 */
      }
    },
  };
}
