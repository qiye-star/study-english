import { describe, expect, it, vi } from "vitest";
import { createPcmPlayer } from "./pcm-player";
import { FakeAudioContext, asContext } from "~/test/fake-audio";

const chunk = (n = 2400, v = 8000) => new Int16Array(n).fill(v); // 2400 个采样 @ 24 kHz = 100 ms

describe("createPcmPlayer", () => {
  it("schedules chunks back to back after a jitter lead", () => {
    const ctx = new FakeAudioContext(48000);
    ctx.currentTime = 1;
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    player.play(1, chunk());
    expect(ctx.started.map((s) => Number(s.when.toFixed(3)))).toEqual([1.12, 1.22]);
    expect(player.playing).toBe(true);
    expect(player.level()).toBeGreaterThan(0.2);
  });

  it("drops chunks of an older turn and stops the old turn when a newer one starts", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(2, chunk());
    const first = ctx.createBufferSource.mock.results[0].value;
    player.play(1, chunk());
    expect(ctx.started).toHaveLength(1);
    player.play(3, chunk());
    expect(first.stop).toHaveBeenCalled();
    expect(ctx.started).toHaveLength(2);
  });

  it("stop clears everything and the next chunk gets a fresh lead", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    player.play(1, chunk());
    player.stop();
    expect(player.playing).toBe(false);
    expect(player.level()).toBe(0);
    ctx.currentTime = 5;
    player.play(1, chunk());
    expect(ctx.started.at(-1)!.when).toBeCloseTo(5.12);
  });

  it("reports drained after the last chunk ends, and close makes play a no-op", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    const drained = vi.fn();
    player.onDrained(drained);
    player.play(1, chunk());
    player.play(1, chunk());
    const sources = ctx.createBufferSource.mock.results.map((r) => r.value);
    sources[0].onended();
    expect(drained).not.toHaveBeenCalled();
    sources[1].onended();
    expect(drained).toHaveBeenCalledTimes(1);
    player.close();
    player.play(2, chunk());
    expect(ctx.started).toHaveLength(2);
    expect(ctx.gain.disconnect).toHaveBeenCalled();
  });

  it("fires no drained callback after stop, even if a stopped source still reports ended", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    const drained = vi.fn();
    player.onDrained(drained);
    player.play(1, chunk());
    const source = ctx.createBufferSource.mock.results[0].value;
    const onended = source.onended;
    player.stop();
    expect(source.onended).toBeNull();
    onended?.();
    expect(drained).not.toHaveBeenCalled();
  });

  it("stop disconnects scheduled sources and tolerates sources that refuse to stop", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    const source = ctx.createBufferSource.mock.results[0].value;
    source.stop.mockImplementation(() => {
      throw new Error("InvalidStateError");
    });
    expect(() => player.stop()).not.toThrow();
    expect(source.disconnect).toHaveBeenCalled();
  });

  it("uses the supplied context without closing it, and releases every node on close", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    const drained = vi.fn();
    player.onDrained(drained);
    player.play(1, chunk());
    const source = ctx.createBufferSource.mock.results[0].value;
    player.close();
    player.close();
    expect(ctx.close).not.toHaveBeenCalled();
    expect(source.stop).toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(ctx.gain.disconnect).toHaveBeenCalledTimes(1);
    expect(player.playing).toBe(false);
    expect(drained).not.toHaveBeenCalled();
  });

  it("onDrained unsubscribe works and empty chunks are ignored", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    const drained = vi.fn();
    const off = player.onDrained(drained);
    off();
    player.play(1, new Int16Array(0));
    expect(ctx.started).toHaveLength(0);
    player.play(1, chunk());
    ctx.createBufferSource.mock.results[0].value.onended();
    expect(drained).not.toHaveBeenCalled();
  });

  it("does not schedule in the past when the queue underruns", () => {
    const ctx = new FakeAudioContext();
    const player = createPcmPlayer(asContext(ctx));
    player.play(1, chunk());
    ctx.currentTime = 3; // 远超已排程末尾,但源尚未触发 onended
    player.play(1, chunk());
    expect(ctx.started[1].when).toBeCloseTo(3);
  });
});
