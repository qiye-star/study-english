import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_VOLUME, createPcmPlayer } from "./pcm-player";
import { FakeAudioContext, FakeNode, asContext } from "~/test/fake-audio";

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

  describe("volume and output (calls v2 Task 3)", () => {
    it("plays louder than unity by default, through a limiter so the boost does not clip", () => {
      const ctx = new FakeAudioContext();
      ctx.createDynamicsCompressor = ctx.makeCompressor;
      createPcmPlayer(asContext(ctx));
      expect(ctx.gain.gain.value).toBe(DEFAULT_PLAYER_VOLUME);
      expect(DEFAULT_PLAYER_VOLUME).toBeCloseTo(1.8);
      expect(ctx.gain.connect).toHaveBeenCalledWith(ctx.compressor);
      expect(ctx.compressor.connect).toHaveBeenCalledWith(ctx.destination);
      expect(ctx.gain.connect).not.toHaveBeenCalledWith(ctx.destination);
      expect(ctx.compressor.threshold.value).toBeLessThan(0);
      expect(ctx.compressor.ratio.value).toBeGreaterThanOrEqual(12);
    });

    it("setVolume changes the gain (clamped), and close releases the limiter too", () => {
      const ctx = new FakeAudioContext();
      ctx.createDynamicsCompressor = ctx.makeCompressor;
      const player = createPcmPlayer(asContext(ctx), { volume: 1 });
      expect(ctx.gain.gain.value).toBe(1);
      player.setVolume(2.2);
      expect(ctx.gain.gain.value).toBe(2.2);
      player.setVolume(99);
      expect(ctx.gain.gain.value).toBeLessThanOrEqual(4);
      player.setVolume(Number.NaN);
      expect(ctx.gain.gain.value).toBeLessThanOrEqual(4);
      player.close();
      expect(ctx.compressor.disconnect).toHaveBeenCalled();
      expect(ctx.gain.disconnect).toHaveBeenCalled();
    });

    it("without a compressor the gain goes straight to the output", () => {
      const ctx = new FakeAudioContext();
      createPcmPlayer(asContext(ctx));
      expect(ctx.gain.connect).toHaveBeenCalledWith(ctx.destination);
    });

    it("plays into the given output node and can be re-routed (media-element output falling back to the destination)", () => {
      const ctx = new FakeAudioContext();
      ctx.createDynamicsCompressor = ctx.makeCompressor;
      const output = new FakeNode();
      const player = createPcmPlayer(asContext(ctx), { output: output as unknown as AudioNode });
      expect(ctx.compressor.connect).toHaveBeenCalledWith(output);
      player.route(asContext(ctx).destination);
      expect(ctx.compressor.disconnect).toHaveBeenCalled();
      expect(ctx.compressor.connect).toHaveBeenLastCalledWith(ctx.destination);
    });
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
