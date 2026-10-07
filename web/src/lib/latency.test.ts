import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abortLatencyTrace, finishLatencyTrace, latencyLog, latencySpans, markLatency, resetLatencyForTest, startLatencyTrace } from "./latency";

let now = 0;
beforeEach(() => {
  now = 1000;
  resetLatencyForTest(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("latency trace", () => {
  it("computes spans from marks of one voice turn", () => {
    startLatencyTrace("voice");
    markLatency("release");
    now = 1300; markLatency("audio_ready");
    now = 2500; markLatency("transcript");
    now = 2700; markLatency("reply_first_delta");
    now = 4000; markLatency("reply_done");
    now = 4100; markLatency("tts_request");
    now = 4900; markLatency("first_audio"); // 结束该记录
    const [record] = latencyLog();
    expect(record.kind).toBe("voice");
    expect(record.spans).toEqual({ transcriptMs: 1500, replyMs: 1500, firstAudioAfterReplyMs: 900, firstAudioAfterReleaseMs: 3900 });
    expect((globalThis as unknown as { __enjoyLatency: unknown }).__enjoyLatency).toBe(latencyLog());
  });

  it("keeps only the first occurrence of a mark and ignores marks without a trace", () => {
    markLatency("release"); // 没有进行中的记录:忽略
    expect(latencyLog()).toHaveLength(0);
    startLatencyTrace("voice");
    markLatency("release");
    now = 5000; markLatency("release");
    finishLatencyTrace();
    expect(latencyLog()[0].marks.release).toBe(1000);
  });

  it("starting a new trace finishes the open one and the log is capped at 50", () => {
    for (let i = 0; i < 60; i++) {
      startLatencyTrace("text");
      markLatency("reply_done");
    }
    finishLatencyTrace();
    expect(latencyLog()).toHaveLength(50);
    expect(latencyLog()[49].id).toBe(60);
  });

  it("a negative first-audio span (pipelined read-aloud) is kept as is", () => {
    expect(latencySpans({ reply_done: 5000, first_audio: 4200 }).firstAudioAfterReplyMs).toBe(-800);
  });

  it("logs to the console only when the debug flag is set", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      startLatencyTrace("voice");
      finishLatencyTrace();
      expect(info).not.toHaveBeenCalled();
      localStorage.setItem("enjoy-web.debug.latency", "1");
      startLatencyTrace("voice");
      finishLatencyTrace();
      expect(info).toHaveBeenCalledWith("[latency]", expect.any(Object));
    } finally {
      localStorage.removeItem("enjoy-web.debug.latency");
    }
  });

  it("a complete record has status complete; a superseded or aborted one is published as aborted", () => {
    startLatencyTrace("voice");
    markLatency("release");
    startLatencyTrace("voice"); // 取代上一条
    markLatency("release");
    abortLatencyTrace();
    startLatencyTrace("voice");
    markLatency("release");
    markLatency("transcript");
    markLatency("reply_first_delta");
    markLatency("reply_done");
    markLatency("first_audio");
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted", "aborted", "complete"]);
  });

  it("ignores marks of another turn and late marks after the turn was replaced", () => {
    const first = startLatencyTrace("voice");
    markLatency("release", first);
    const second = startLatencyTrace("voice");
    markLatency("release", second);
    now = 2000; markLatency("transcript", first); // 上一轮的迟到标记
    markLatency("transcript", second);
    abortLatencyTrace(first); // 过期的中止不影响新一轮
    markLatency("reply_first_delta", second);
    expect(latencyLog()).toHaveLength(1); // 只有被取代的第一轮
    finishLatencyTrace();
    expect(latencyLog()[1].marks.transcript).toBe(2000);
    expect(latencyLog()[1].marks.reply_first_delta).toBeDefined();
  });

  it("a manual read-aloud cannot attach to a voice trace that has no reply yet", () => {
    startLatencyTrace("voice");
    markLatency("release");
    markLatency("tts_request");
    markLatency("first_audio");
    expect(latencyLog()).toHaveLength(0); // first_audio 被拒绝,记录仍在进行
    finishLatencyTrace("aborted");
    expect(latencyLog()[0].marks.first_audio).toBeUndefined();
    expect(latencyLog()[0].marks.tts_request).toBeUndefined();
  });

  it("a turn-scoped finish only closes that turn", () => {
    const voice = startLatencyTrace("voice");
    const text = startLatencyTrace("text"); // 取代了 voice(voice 记为 aborted)
    finishLatencyTrace("complete", voice); // 迟到的 voice 收尾不能关掉 text
    expect(latencyLog().map((r) => [r.kind, r.status])).toEqual([["voice", "aborted"]]);
    finishLatencyTrace("complete", text);
    expect(latencyLog().map((r) => [r.kind, r.status])).toEqual([["voice", "aborted"], ["text", "complete"]]);
  });

  it("reply marks need a transcript on a voice trace", () => {
    startLatencyTrace("voice");
    markLatency("release");
    markLatency("reply_first_delta");
    markLatency("reply_done");
    finishLatencyTrace("aborted");
    expect(latencyLog()[0].marks).toEqual({ release: 1000 });
  });

  it("expires an unfinished trace after the timeout and publishes it as aborted", () => {
    vi.useFakeTimers();
    try {
      startLatencyTrace("voice");
      markLatency("release");
      vi.advanceTimersByTime(121_000);
      expect(latencyLog()).toHaveLength(1);
      expect(latencyLog()[0].status).toBe("aborted");
      markLatency("transcript"); // 已无进行中的记录
      expect(latencyLog()[0].marks.transcript).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires lazily by the clock when a late mark arrives", () => {
    startLatencyTrace("voice");
    markLatency("release");
    now += 200_000;
    markLatency("transcript");
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0].status).toBe("aborted");
  });

  it("marks after first_audio finished the record are ignored", () => {
    startLatencyTrace("voice");
    for (const m of ["release", "transcript", "reply_first_delta", "reply_done", "first_audio"] as const) markLatency(m);
    markLatency("tts_request");
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0].marks.tts_request).toBeUndefined();
  });

  it("never throws into product code (broken clock, frozen global, throwing console)", () => {
    startLatencyTrace("voice");
    resetLatencyForTest(() => { throw new Error("clock"); });
    expect(() => { startLatencyTrace("voice"); markLatency("release"); finishLatencyTrace(); abortLatencyTrace(); }).not.toThrow();
    resetLatencyForTest(() => now);
    const original = Object.getOwnPropertyDescriptor(globalThis, "__enjoyLatency");
    Object.defineProperty(globalThis, "__enjoyLatency", { get: () => undefined, set: () => { throw new Error("frozen"); }, configurable: true });
    try {
      localStorage.setItem("enjoy-web.debug.latency", "1");
      vi.spyOn(console, "info").mockImplementation(() => { throw new Error("console"); });
      expect(() => { startLatencyTrace("voice"); finishLatencyTrace(); }).not.toThrow();
    } finally {
      localStorage.removeItem("enjoy-web.debug.latency");
      if (original) Object.defineProperty(globalThis, "__enjoyLatency", original);
      else delete (globalThis as Record<string, unknown>).__enjoyLatency;
    }
  });

  it("works without performance and without localStorage", () => {
    vi.stubGlobal("performance", undefined);
    vi.stubGlobal("localStorage", undefined);
    try {
      resetLatencyForTest(); // 默认时钟:退到 Date.now
      startLatencyTrace("voice");
      markLatency("release");
      finishLatencyTrace();
      expect(latencyLog()[0].marks.release).toBeTypeOf("number");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
