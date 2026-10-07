import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { latencyLog, markLatency, resetLatencyForTest, startLatencyTrace } from "~/lib/latency";
import { useAutoSpeak } from "./use-auto-speak";

function setup(over: { enabled?: boolean } = {}) {
  const failures: Array<(err: unknown) => void> = [];
  const options = {
    isEnabled: () => over.enabled ?? true,
    voiceIdle: () => true,
    hasVoice: () => true,
    prime: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(async (_k: string, _t: string, onError: (err: unknown) => void) => { failures.push(onError); }),
    onError: vi.fn(),
  };
  const hook = renderHook(() => useAutoSpeak(options));
  return { ...hook, failures };
}

function voiceTurnUntilReply() {
  startLatencyTrace("voice");
  markLatency("release");
  markLatency("transcript");
  markLatency("reply_first_delta");
}

describe("auto-speak closes the latency trace when there will be no first_audio", () => {
  beforeEach(() => resetLatencyForTest());

  it("marks reply_done and keeps the trace open while it speaks", () => {
    const t = setup();
    voiceTurnUntilReply();
    act(() => { t.result.current.begin("b1"); t.result.current.complete("b1", "Hello there.", "done"); });
    expect(latencyLog()).toHaveLength(0);
    markLatency("tts_request");
    markLatency("first_audio");
    expect(latencyLog()[0]).toMatchObject({ status: "complete" });
    expect(latencyLog()[0].marks.reply_done).toBeDefined();
  });

  it("auto-speak off: the trace is aborted so a later manual read-aloud cannot attach", () => {
    const t = setup({ enabled: false });
    voiceTurnUntilReply();
    act(() => { t.result.current.begin("b1"); t.result.current.complete("b1", "Hello there.", "done"); });
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
    markLatency("tts_request");
    markLatency("first_audio");
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0].marks.first_audio).toBeUndefined();
  });

  it("a reply error aborts the trace", () => {
    const t = setup();
    voiceTurnUntilReply();
    act(() => { t.result.current.begin("b1"); t.result.current.complete("b1", "oops", "error"); });
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
  });

  it("a TTS failure aborts the trace", async () => {
    const t = setup();
    voiceTurnUntilReply();
    act(() => { t.result.current.begin("b1"); t.result.current.complete("b1", "Hello there.", "done"); });
    act(() => t.failures[0](new Error("tts down")));
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
  });
});
