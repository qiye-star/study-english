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
  removeEventListener: (type: string, fn: () => void) => void;
  fireEnded(): void;
  listenerCount(): number;
}

export interface FakeBehavior {
  startError?: unknown;
  /** stop() never fires the "stop" event (Safari quirk). */
  silentStop: boolean;
}

export function createFakeRecorderEnv(overrides: Partial<RecorderEnv> = {}) {
  const recorders: FakeMediaRecorder[] = [];
  const constraints: MediaStreamConstraints[] = [];
  const behavior: FakeBehavior = { silentStop: false };
  const endedFns = new Set<() => void>();
  const track: FakeTrack = {
    stop: vi.fn(),
    addEventListener: (type, fn) => { if (type === "ended") endedFns.add(fn); },
    removeEventListener: (type, fn) => { if (type === "ended") endedFns.delete(fn); },
    fireEnded: () => [...endedFns].forEach((fn) => fn()),
    listenerCount: () => endedFns.size,
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const docTarget = new EventTarget();
  const docFns = new Set<EventListenerOrEventListenerObject>();
  const rawAdd = docTarget.addEventListener.bind(docTarget);
  const rawRemove = docTarget.removeEventListener.bind(docTarget);
  const doc = Object.assign(docTarget, {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, fn: EventListenerOrEventListenerObject | null) => {
      if (fn) docFns.add(fn);
      rawAdd(type, fn);
    },
    removeEventListener: (type: string, fn: EventListenerOrEventListenerObject | null) => {
      if (fn) docFns.delete(fn);
      rawRemove(type, fn);
    },
  });
  let now = 1_000;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  class Recorder extends FakeMediaRecorder {
    constructor(s: MediaStream, options?: unknown) {
      super(s, options);
      recorders.push(this);
    }
    start(timeslice?: number) {
      if (behavior.startError) throw behavior.startError;
      super.start(timeslice);
    }
    stop() {
      if (behavior.silentStop) {
        this.state = "inactive";
        return;
      }
      super.stop();
    }
  }
  const env: RecorderEnv = {
    isSecureContext: true,
    getUserMedia: async (c) => { constraints.push(c); return stream; },
    MediaRecorder: Recorder as unknown as RecorderEnv["MediaRecorder"],
    now: () => now,
    document: doc as unknown as RecorderEnv["document"],
    setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
    ...overrides,
  };
  return {
    env, recorders, track, constraints, behavior,
    /** Fires every pending timer (max-duration or stop fallback). */
    fireTimer: () => {
      const pending = [...timers.entries()];
      pending.forEach(([id, fn]) => { timers.delete(id); fn(); });
    },
    pendingTimers: () => timers.size,
    docListenerCount: () => docFns.size,
    emitError: (recorder: FakeMediaRecorder) => recorder.dispatchEvent(new Event("error")),
    setHidden: () => { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); },
    advance: (ms: number) => { now += ms; },
  };
}
