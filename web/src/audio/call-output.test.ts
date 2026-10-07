import { describe, expect, it, vi } from "vitest";
import { FakeAudioContext, asContext } from "~/test/fake-audio";
import { createCallOutput, elementOutputAllowed, type OutputEnv } from "./call-output";

function fakeElement(play: () => Promise<void> = async () => undefined) {
  return { srcObject: null as unknown, autoplay: false, play: vi.fn(play), pause: vi.fn(), setAttribute: vi.fn() };
}

function env(over: Partial<OutputEnv> = {}, el = fakeElement()): OutputEnv & { el: ReturnType<typeof fakeElement> } {
  return { elementAllowed: true, createAudioElement: () => el as unknown as HTMLAudioElement, ...over, el };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createCallOutput (AEC reference through a media element)", () => {
  it("plays the call through a MediaStreamDestination and an <audio> element when supported", async () => {
    const ctx = new FakeAudioContext();
    ctx.createMediaStreamDestination = ctx.makeStreamDestination;
    const e = env();
    const out = createCallOutput(asContext(ctx), e);
    expect(out.node).toBe(ctx.streamDestination);
    expect(e.el.srcObject).toBe(ctx.streamDestination.stream);
    expect(e.el.play).toHaveBeenCalled();
    expect(out.via).toBe("element");
    out.release();
    expect(e.el.pause).toHaveBeenCalled();
    expect(e.el.srcObject).toBeNull();
    expect(ctx.streamDestination.disconnect).toHaveBeenCalled();
  });

  it("falls back to ctx.destination when the element refuses to play", async () => {
    const ctx = new FakeAudioContext();
    ctx.createMediaStreamDestination = ctx.makeStreamDestination;
    const e = env({}, fakeElement(async () => { throw new DOMException("no", "NotAllowedError"); }));
    const out = createCallOutput(asContext(ctx), e);
    const fellBack = vi.fn();
    out.onFallback(fellBack);
    await flush();
    expect(fellBack).toHaveBeenCalledWith(ctx.destination);
    expect(out.via).toBe("destination");
    expect(e.el.srcObject).toBeNull();
  });

  it("uses ctx.destination directly where the element route is not allowed or not supported", () => {
    const ctx = new FakeAudioContext();
    expect(createCallOutput(asContext(ctx), env()).node).toBe(ctx.destination); // 没有 createMediaStreamDestination
    ctx.createMediaStreamDestination = ctx.makeStreamDestination;
    const blocked = env({ elementAllowed: false });
    const out = createCallOutput(asContext(ctx), blocked);
    expect(out.node).toBe(ctx.destination);
    expect(out.via).toBe("destination");
    expect(blocked.el.play).not.toHaveBeenCalled();
    expect(() => out.release()).not.toThrow();
  });

  it("is not used on WebKit (iOS, Safari): the platform AEC already sees all output, and MediaStream playback there is unreliable", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const crios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0";
    expect(elementOutputAllowed(iphone, 5)).toBe(false);
    expect(elementOutputAllowed(crios, 5)).toBe(false);
    expect(elementOutputAllowed(ipad, 5)).toBe(false); // iPadOS 伪装成 Mac
    expect(elementOutputAllowed(ipad, 0)).toBe(false); // 桌面 Safari
    expect(elementOutputAllowed(chrome, 5)).toBe(true);
    expect(elementOutputAllowed(edge, 0)).toBe(true);
  });
});
