import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSLATE_ON, readTranslateOn, translateKey, useTranslateToggle, writeTranslateOn } from "./use-translate-toggle";

beforeEach(() => localStorage.clear());

describe("translation toggle (D8, R-L32, R-W2)", () => {
  it("is on by default (D8) and remembers an explicit choice per item on this device", () => {
    expect(DEFAULT_TRANSLATE_ON).toBe(true);
    expect(readTranslateOn("a")).toBe(true);
    writeTranslateOn("a", false);
    expect(readTranslateOn("a")).toBe(false);
    expect(readTranslateOn("b")).toBe(true);
    expect(localStorage.getItem(translateKey("a"))).toBe("false");
    writeTranslateOn("a", true);
    expect(localStorage.getItem(translateKey("a"))).toBe("true");
  });

  it("stores nothing but the item id in the key and a boolean as the value", () => {
    writeTranslateOn("item-1", false);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.library.translate.item-1"]);
  });

  it("keeps an earlier `true`, and treats a corrupt stored value as the default", () => {
    localStorage.setItem(translateKey("a"), "true");
    expect(readTranslateOn("a")).toBe(true);
    localStorage.setItem(translateKey("a"), "banana");
    expect(readTranslateOn("a")).toBe(DEFAULT_TRANSLATE_ON);
  });

  it("works through a hook and survives unavailable storage", () => {
    const { result } = renderHook(() => useTranslateToggle("x"));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(readTranslateOn("x")).toBe(false);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => act(() => result.current[1](true))).not.toThrow();
    expect(result.current[0]).toBe(true);
    spy.mockRestore();
  });
});
