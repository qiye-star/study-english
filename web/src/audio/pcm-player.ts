import { frameRms, pcm16ToFloat } from "./pcm";

export interface PcmPlayer {
  play(turnId: number, pcm: Int16Array): void;
  stop(): void;
  readonly playing: boolean;
  onDrained(cb: () => void): () => void;
  level(): number;
  /** 输出增益(0..MAX_PLAYER_VOLUME);> 1 的放大由后面的限幅压缩器兜住,不削波。 */
  setVolume(volume: number): void;
  /** 改接到另一个输出节点(媒体元素输出失败时退回 ctx.destination)。 */
  route(output: AudioNode): void;
  close(): void;
}

/** 默认增益:TTS 音量偏小,手机外放时尤其听不清(calls v2 Task 3)。 */
export const DEFAULT_PLAYER_VOLUME = 1.8;
export const MAX_PLAYER_VOLUME = 4;

/** 限幅:放大后的峰值压在约 -6 dBFS 以下,避免削波失真。 */
function createLimiter(ctx: AudioContext): DynamicsCompressorNode | null {
  if (typeof ctx.createDynamicsCompressor !== "function") return null;
  try {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -10;
    c.knee.value = 6;
    c.ratio.value = 12;
    c.attack.value = 0.003;
    c.release.value = 0.25;
    return c;
  } catch {
    return null;
  }
}

const clampVolume = (v: number) => (Number.isFinite(v) ? Math.min(MAX_PLAYER_VOLUME, Math.max(0, v)) : DEFAULT_PLAYER_VOLUME);

/**
 * 实时通话下行音频:按轮次排队,WebAudio 精确排程(设计文档 §5)。
 * 音频图:源 → 增益 → 限幅压缩器(有则用)→ 输出(默认 ctx.destination)。
 * 不自建 AudioContext(使用调用方提供的页面级上下文),也不关闭它;close() 只释放本模块创建的节点。
 */
export function createPcmPlayer(
  ctx: AudioContext,
  opts: { sampleRate?: number; leadMs?: number; volume?: number; output?: AudioNode } = {},
): PcmPlayer {
  const rate = opts.sampleRate ?? 24000;
  const lead = (opts.leadMs ?? 120) / 1000;
  const gain = ctx.createGain();
  gain.gain.value = clampVolume(opts.volume ?? DEFAULT_PLAYER_VOLUME);
  const limiter = createLimiter(ctx);
  if (limiter) gain.connect(limiter);
  const tail: AudioNode = limiter ?? gain;
  tail.connect(opts.output ?? ctx.destination);
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
    setVolume(volume) {
      if (!closed) gain.gain.value = clampVolume(volume);
    },
    route(output) {
      if (closed) return;
      try {
        tail.disconnect();
      } catch {
        /* 已断开 */
      }
      tail.connect(output);
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      drained.clear();
      for (const node of limiter ? [gain, limiter] : [gain]) {
        try {
          node.disconnect();
        } catch {
          /* 已断开 */
        }
      }
    },
  };
}
