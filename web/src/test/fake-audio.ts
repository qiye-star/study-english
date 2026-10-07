import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  stop = vi.fn();
  kind = "audio";
}

export function fakeStream(): MediaStream & { track: FakeTrack } {
  const track = new FakeTrack();
  return { track, getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream & { track: FakeTrack };
}

export class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

export class FakeWorkletNode extends FakeNode {
  port = { onmessage: null as null | ((e: MessageEvent) => void), postMessage: vi.fn() };
  emit(samples: Float32Array) {
    this.port.onmessage?.({ data: samples } as MessageEvent);
  }
}

export class FakeScriptProcessor extends FakeNode {
  onaudioprocess: null | ((e: AudioProcessingEvent) => void) = null;
  emit(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent);
  }
}

export class FakeAudioContext {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = new FakeNode();
  resume = vi.fn(async () => { this.setState("running"); });
  close = vi.fn(async () => { this.state = "closed"; });
  worklet = { addModule: vi.fn(async (_url: string) => undefined) };
  audioWorklet: { addModule: (url: string) => Promise<void> } | undefined = this.worklet;
  source = new FakeNode();
  processor = new FakeScriptProcessor();
  gain = Object.assign(new FakeNode(), { gain: { value: 1 } });
  param = (value: number) => ({ value });
  compressor = Object.assign(new FakeNode(), {
    threshold: this.param(-24), knee: this.param(30), ratio: this.param(12), attack: this.param(0.003), release: this.param(0.25),
  });
  /** 默认没有压缩器(旧测试的音频图不变);测试按需打开:`ctx.createDynamicsCompressor = ctx.makeCompressor` */
  createDynamicsCompressor: undefined | (() => FakeNode) = undefined;
  makeCompressor = vi.fn(() => this.compressor);
  streamDestination = Object.assign(new FakeNode(), { stream: { id: "dest-stream" } });
  createMediaStreamDestination: undefined | (() => FakeNode & { stream: unknown }) = undefined;
  makeStreamDestination = vi.fn(() => this.streamDestination);
  private stateListeners = new Set<() => void>();
  addEventListener = vi.fn((type: string, cb: () => void) => { if (type === "statechange") this.stateListeners.add(cb); });
  removeEventListener = vi.fn((type: string, cb: () => void) => { if (type === "statechange") this.stateListeners.delete(cb); });
  /** 改变状态并触发 statechange(iOS 打断、手势解锁) */
  setState(state: AudioContextState | "interrupted") {
    this.state = state as AudioContextState;
    [...this.stateListeners].forEach((cb) => cb());
  }
  get stateListenerCount() {
    return this.stateListeners.size;
  }
  started: Array<{ when: number; duration: number; buffer: { samples: Float32Array } }> = [];
  constructor(public sampleRate = 48000) {}
  createMediaStreamSource = vi.fn(() => this.source);
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => this.gain);
  createBuffer = vi.fn((_channels: number, length: number, rate: number) => {
    const samples = new Float32Array(length);
    return { duration: length / rate, length, sampleRate: rate, samples, getChannelData: () => samples, copyToChannel: (src: Float32Array) => samples.set(src) };
  });
  createBufferSource = vi.fn(() => {
    const node = Object.assign(new FakeNode(), {
      buffer: null as null | { duration: number; samples: Float32Array },
      onended: null as null | (() => void),
      start: vi.fn((when: number) => this.started.push({ when, duration: node.buffer!.duration, buffer: node.buffer! })),
      stop: vi.fn(),
    });
    return node;
  });
}

export const asContext = (ctx: FakeAudioContext) => ctx as unknown as AudioContext;
