import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dock } from "./dock";
import { useDockSpace } from "./use-dock-space";

const space = () => document.documentElement.style.getPropertyValue("--dock-space");
let heights: Record<string, number>;
let observers: { cb: () => void; observed: Element[]; disconnected: boolean }[];

beforeEach(() => {
  heights = {};
  observers = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = heights[this.dataset.id ?? ""] ?? 0;
    return { height: h, top: 0, bottom: h, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  vi.stubGlobal("ResizeObserver", class {
    rec = { cb: () => {}, observed: [] as Element[], disconnected: false };
    constructor(cb: () => void) { this.rec.cb = cb; observers.push(this.rec); }
    observe(el: Element) { this.rec.observed.push(el); }
    unobserve() {}
    disconnect() { this.rec.disconnected = true; }
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Probe({ id }: { id: string }) {
  const ref = useDockSpace();
  return <div ref={ref} data-id={id} />;
}

describe("useDockSpace", () => {
  it("writes the dock's height as --dock-space while mounted and removes it on unmount", () => {
    heights.a = 66;
    const { unmount } = render(<Probe id="a" />);
    expect(space()).toBe("66px");
    unmount();
    expect(space()).toBe("");
  });
  it("re-measures when the dock resizes (ResizeObserver) and on window resize", () => {
    heights.a = 66;
    const { unmount } = render(<Probe id="a" />);
    heights.a = 90;
    act(() => observers[0].cb());
    expect(space()).toBe("90px");
    heights.a = 40;
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(space()).toBe("40px");
    unmount();
    expect(observers[0].disconnected).toBe(true);
  });
  it("writes the MAX of several docks and falls back to the next one on unmount", () => {
    heights.a = 66; heights.b = 120;
    const a = render(<Probe id="a" />);
    const b = render(<Probe id="b" />);
    expect(space()).toBe("120px");
    b.unmount();
    expect(space()).toBe("66px");
    a.unmount();
    expect(space()).toBe("");
  });
  it("measures from the dock's top to the bottom of <main> minus its padding (the space above the tab bar)", () => {
    const main = document.createElement("main");
    main.style.paddingBottom = "78px";
    document.body.append(main);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      const r = this === main ? { top: 0, bottom: 800 } : { top: 640, bottom: 712 };
      return { ...r, height: r.bottom - r.top, left: 0, right: 0, width: 0, x: 0, y: r.top, toJSON: () => ({}) } as DOMRect;
    });
    const { unmount } = render(<Dock data-testid="d" />, { container: main.appendChild(document.createElement("div")) });
    expect(space()).toBe("82px"); // 800 - 78 - 640: the dock's 72 + its 10 px gap above the content edge
    unmount();
    main.remove();
  });
  it("is safe without ResizeObserver", () => {
    vi.unstubAllGlobals();
    heights.a = 10;
    const { unmount } = render(<Probe id="a" />);
    expect(space()).toBe("10px");
    unmount();
    expect(space()).toBe("");
  });
});
