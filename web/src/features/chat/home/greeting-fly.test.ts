import { describe, expect, it, vi } from "vitest";
import { FLY_LAND_AT, FLY_MS, FLY_STAGGER_MS, canFly, flyTransform, greetingTargets, playGreetingFlyIn } from "./greeting-fly";
import type { GreetingExitTargets } from "./greeting-modal";

describe("flyTransform (FLIP)", () => {
  it("moves the top-left corner and scales by the font ratio", () => {
    expect(flyTransform({ left: 24, top: 300, width: 300, height: 40 }, { left: 60, top: 500, width: 250, height: 30 }, 30, 15)).toEqual({ dx: 36, dy: 200, scale: 0.5 });
  });
  it("does not scale when a font size is unknown", () => {
    expect(flyTransform({ left: 0, top: 0, width: 1, height: 1 }, { left: 5, top: 7, width: 1, height: 1 }, 0, 16).scale).toBe(1);
  });
  it("is the identity when source and target coincide", () => {
    const b = { left: 10, top: 20, width: 100, height: 20 };
    expect(flyTransform(b, b, 16, 16)).toEqual({ dx: 0, dy: 0, scale: 1 });
  });
});

describe("canFly", () => {
  it("needs equal, non-zero line counts and motion", () => {
    expect(canFly(3, 3, false)).toBe(true);
    expect(canFly(3, 2, false)).toBe(false);
    expect(canFly(0, 0, false)).toBe(false);
    expect(canFly(3, 3, true)).toBe(false);
  });
  it("timing constants follow the demo", () => {
    expect([FLY_MS, FLY_STAGGER_MS, FLY_LAND_AT]).toEqual([640, 70, 0.72]);
  });
});

function targets(lines: number, reduced = false): GreetingExitTargets {
  const el = () => document.createElement("div");
  return { root: el(), bg: el(), date: el(), bottom: el(), lines: Array.from({ length: lines }, el), reduced };
}

describe("playGreetingFlyIn", () => {
  it("resolves at once without Web Animations (jsdom) and for reduced motion", async () => {
    await expect(playGreetingFlyIn(targets(3), [])).resolves.toBeUndefined();
    await expect(playGreetingFlyIn(targets(3, true), [])).resolves.toBeUndefined();
  });

  it("falls back to one fade of the whole modal when the line count differs from the bubbles", async () => {
    const t = targets(3);
    const animate = vi.fn(() => ({ addEventListener: (_: string, cb: () => void) => cb() }));
    Object.assign(t.root, { animate });
    const lineAnimate = vi.fn();
    t.lines.forEach((l) => Object.assign(l, { animate: lineAnimate }));
    await playGreetingFlyIn(t, [document.createElement("div")]);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(lineAnimate).not.toHaveBeenCalled();
  });

  it("flies every line when the counts match, staggering them", async () => {
    const t = targets(3);
    const calls: Array<{ delay: number }> = [];
    const fake = (_kf: unknown, opts: { delay?: number }) => { calls.push({ delay: opts.delay ?? 0 }); return { addEventListener: (_: string, cb: () => void) => cb() }; };
    [t.root, t.bg, t.date, t.bottom, ...t.lines].forEach((e) => Object.assign(e, { animate: fake }));
    await playGreetingFlyIn(t, [1, 2, 3].map(() => document.createElement("div")));
    expect(calls.slice(0, 3).map((c) => c.delay)).toEqual([0, 70, 140]);
    expect(calls).toHaveLength(6); // 3 lines + date + bottom + bg
  });
});

describe("greetingTargets", () => {
  it("returns the bubble text of the greeting lines in order", () => {
    document.body.innerHTML = `
      <div data-greet-target="1"><div data-lookup-context id="b"></div></div>
      <div data-greet-target="0"><div data-lookup-context id="a"></div></div>
      <div data-greet-target="2"></div>`;
    const found = greetingTargets();
    expect(found.map((e) => e.id)).toEqual(["a", "b", ""]);
    document.body.innerHTML = "";
  });
});
