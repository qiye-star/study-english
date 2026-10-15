import { afterEach, describe, expect, it } from "vitest";
import { initGlassQuality, isLowMemory } from "./glass-quality";

function fakeWindow(deviceMemory?: number): Window {
  return Object.assign(Object.create(window), { navigator: { deviceMemory }, document });
}

describe("initGlassQuality", () => {
  afterEach(() => document.documentElement.classList.remove("lite"));

  it.each([2, 4])("marks html.lite on devices with %s GB memory", (gb) => {
    expect(initGlassQuality(fakeWindow(gb))).toBe(true);
    expect(document.documentElement.classList.contains("lite")).toBe(true);
  });

  it("isLowMemory is the same rule without touching the DOM", () => {
    expect(isLowMemory(fakeWindow(4))).toBe(true);
    expect(isLowMemory(fakeWindow(8))).toBe(false);
    expect(document.documentElement.classList.contains("lite")).toBe(false);
  });

  it.each([8, undefined])("keeps full glass when deviceMemory is %s", (gb) => {
    expect(initGlassQuality(fakeWindow(gb))).toBe(false);
    expect(document.documentElement.classList.contains("lite")).toBe(false);
  });
});
