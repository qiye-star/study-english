import { afterEach, describe, expect, it } from "vitest";
import { browserFrames, motionAllowed } from "./motion";

const html = document.documentElement;
const win = (reduce: boolean) =>
  Object.assign(Object.create(window), { document, matchMedia: (q: string) => ({ matches: reduce && q.includes("reduce") }) }) as Window;

afterEach(() => html.classList.remove("lite"));

describe("motionAllowed (R-L28)", () => {
  it("is true by default", () => {
    expect(motionAllowed(win(false))).toBe(true);
  });

  it("is false with prefers-reduced-motion", () => {
    expect(motionAllowed(win(true))).toBe(false);
  });

  it("is false on low-end devices (html.lite, layout/glass-quality.ts)", () => {
    html.classList.add("lite");
    expect(motionAllowed(win(false))).toBe(false);
  });

  it("survives a window without matchMedia", () => {
    const bare = Object.assign(Object.create(window), { document, matchMedia: undefined }) as Window;
    expect(motionAllowed(bare)).toBe(true);
  });

  it("exposes the browser frame source", () => {
    expect(typeof browserFrames.now()).toBe("number");
    const id = browserFrames.request(() => {});
    expect(typeof id).toBe("number");
    browserFrames.cancel(id);
  });
});
