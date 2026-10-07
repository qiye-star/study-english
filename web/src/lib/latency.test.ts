import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishLatencyTrace, latencyLog, latencySpans, markLatency, resetLatencyForTest, startLatencyTrace } from "./latency";

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
    startLatencyTrace("voice");
    finishLatencyTrace();
    expect(info).not.toHaveBeenCalled();
    localStorage.setItem("enjoy-web.debug.latency", "1");
    startLatencyTrace("voice");
    finishLatencyTrace();
    expect(info).toHaveBeenCalledWith("[latency]", expect.any(Object));
    localStorage.removeItem("enjoy-web.debug.latency");
  });
});
