import { describe, expect, it, vi } from "vitest";
import source from "./pcm-capture.worklet.js?raw";

/** 在假的 AudioWorkletGlobalScope 里执行 worklet 源码,取回注册的处理器类。 */
function loadProcessor() {
  class AudioWorkletProcessor {
    port = { onmessage: null as null | ((e: { data: unknown }) => void), postMessage: vi.fn(), close: vi.fn() };
  }
  let registered: (new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean }) | undefined;
  const registerProcessor = (_name: string, ctor: typeof registered) => (registered = ctor);
  new Function("AudioWorkletProcessor", "registerProcessor", source)(AudioWorkletProcessor, registerProcessor);
  return new registered!();
}

describe("pcm-capture worklet (review W1 I-2)", () => {
  it("posts 2048-sample packets while running", () => {
    const p = loadProcessor();
    for (let i = 0; i < 16; i++) expect(p.process([[new Float32Array(128).fill(0.1)]])).toBe(true);
    expect(p.port.postMessage).toHaveBeenCalledTimes(1);
    expect((p.port.postMessage.mock.calls[0][0] as Float32Array).length).toBe(2048);
  });

  it("stops processing (returns false) and posts nothing after a stop message", () => {
    const p = loadProcessor();
    p.process([[new Float32Array(128)]]);
    p.port.onmessage?.({ data: "stop" });
    expect(p.process([[new Float32Array(2048)]])).toBe(false);
    expect(p.port.postMessage).not.toHaveBeenCalled();
    expect(p.port.close).toHaveBeenCalled();
  });
});
