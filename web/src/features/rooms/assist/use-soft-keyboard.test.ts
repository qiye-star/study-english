import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSoftKeyboard } from "./use-soft-keyboard";

class FakeVisualViewport extends EventTarget {
  height = 812;
  width = 375;
  scale = 1;
}

describe("useSoftKeyboard", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  let vv: FakeVisualViewport;

  beforeEach(() => {
    vv = new FakeVisualViewport();
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  });
  afterEach(() => {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
  });

  const resize = (height: number) => act(() => {
    vv.height = height;
    vv.dispatchEvent(new Event("resize"));
  });

  it("follows the visual viewport shrinking and growing back", () => {
    const { result } = renderHook(() => useSoftKeyboard());
    resize(812);
    expect(result.current).toBe(false);
    resize(480);
    expect(result.current).toBe(true);
    resize(812);
    expect(result.current).toBe(false);
  });

  it("does not take a pinch-zoom for the keyboard (review m4)", () => {
    const { result } = renderHook(() => useSoftKeyboard());
    resize(812);
    act(() => {
      vv.scale = 1.5; // iOS ignores user-scalable=no: zooming shrinks the visual viewport by the zoom factor
      vv.height = 812 / 1.5;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false);
    act(() => {
      vv.scale = 1;
      vv.height = 812;
      vv.dispatchEvent(new Event("resize"));
    });
    resize(480);
    expect(result.current).toBe(true); // the keyboard itself is still detected
  });

  it("treats a small shrink (browser toolbars) as no keyboard", () => {
    const { result } = renderHook(() => useSoftKeyboard());
    resize(812);
    resize(760);
    expect(result.current).toBe(false);
  });

  it("starts measuring from a new maximum after a rotation", () => {
    const { result } = renderHook(() => useSoftKeyboard());
    resize(812);
    act(() => {
      vv.width = 812;
      vv.height = 375;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false); // landscape is not a keyboard
    resize(200);
    expect(result.current).toBe(true);
  });

  it("stops listening when unmounted", () => {
    const { result, unmount } = renderHook(() => useSoftKeyboard());
    resize(812);
    unmount();
    resize(400);
    expect(result.current).toBe(false);
  });
});

describe("useSoftKeyboard without visualViewport", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const originalMatch = window.matchMedia;
  beforeEach(() => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: null });
    window.matchMedia = ((query: string) => ({ matches: query === "(pointer: coarse)", media: query,
      addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
    window.matchMedia = originalMatch;
    document.body.innerHTML = "";
  });

  it("uses input focus on touch devices", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    const { result } = renderHook(() => useSoftKeyboard());
    expect(result.current).toBe(false);
    act(() => input.focus());
    expect(result.current).toBe(true);
    act(() => button.focus());
    expect(result.current).toBe(false);
  });
});
