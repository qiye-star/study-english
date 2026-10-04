import { vi } from "vitest";
import type { RecorderEnv } from "~/audio/recorder";

export class FakeMediaRecorder extends EventTarget {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/mp4";
  timeslice?: number;
  constructor(public readonly stream: MediaStream, public readonly options?: unknown) {
    super();
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  emit(bytes: number[]) {
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = new Blob([new Uint8Array(bytes)], { type: this.mimeType });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit([9]);
      this.dispatchEvent(new Event("stop"));
    });
  }
}

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: () => void;
  fireEnded(): void;
}

export function createFakeRecorderEnv(overrides: Partial<RecorderEnv> = {}) {
  const recorders: FakeMediaRecorder[] = [];
  const constraints: MediaStreamConstraints[] = [];
  let ended: () => void = () => {};
  const track: FakeTrack = {
    stop: vi.fn(),
    addEventListener: (type, fn) => { if (type === "ended") ended = fn; },
    removeEventListener: () => {},
    fireEnded: () => ended(),
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let now = 1_000;
  let timer: (() => void) | null = null;
  class Recorder extends FakeMediaRecorder {
    constructor(s: MediaStream, options?: unknown) {
      super(s, options);
      recorders.push(this);
    }
  }
  const env: RecorderEnv = {
    isSecureContext: true,
    getUserMedia: async (c) => { constraints.push(c); return stream; },
    MediaRecorder: Recorder as unknown as RecorderEnv["MediaRecorder"],
    now: () => now,
    document: doc as unknown as RecorderEnv["document"],
    setTimeout: (fn) => { timer = fn; return 1; },
    clearTimeout: () => { timer = null; },
    ...overrides,
  };
  return {
    env, recorders, track, constraints,
    fireTimer: () => timer?.(),
    setHidden: () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); },
    advance: (ms: number) => { now += ms; },
  };
}
