import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTranslateOn, translateKey, useTranslateToggle, writeTranslateOn } from "./use-translate-toggle";

beforeEach(() => localStorage.clear());

describe("translation toggle (D8, R-L32)", () => {
  it("is off by default and remembered per item on this device", () => {
    expect(readTranslateOn("a")).toBe(false);
    writeTranslateOn("a", true);
    expect(readTranslateOn("a")).toBe(true);
    expect(readTranslateOn("b")).toBe(false);
    expect(localStorage.getItem(translateKey("a"))).toBe("true");
    writeTranslateOn("a", false);
    expect(localStorage.getItem(translateKey("a"))).toBeNull();
  });

  it("stores nothing but the item id in the key and a boolean as the value", () => {
    writeTranslateOn("item-1", true);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.library.translate.item-1"]);
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem(translateKey("a"), "banana");
    expect(readTranslateOn("a")).toBe(false);
  });

  it("works through a hook and survives unavailable storage", () => {
    const { result } = renderHook(() => useTranslateToggle("x"));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(readTranslateOn("x")).toBe(true);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => act(() => result.current[1](false))).not.toThrow();
    expect(result.current[0]).toBe(false);
    spy.mockRestore();
  });
});
