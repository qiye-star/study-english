import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZH_DEFS_PREF_KEY } from "~/lib/storage";
import { DEFAULT_ZH_DEFS_MODE, getZhDefsMode, resetZhDefsModeMemory, setZhDefsMode, useZhDefsMode } from "./zh-defs-pref";

describe("Chinese definitions preference (我的 → 中文释义)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(ZH_DEFS_PREF_KEY);
    resetZhDefsModeMemory();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(ZH_DEFS_PREF_KEY);
    resetZhDefsModeMemory();
  });

  it("defaults to auto when nothing is stored", () => {
    expect(DEFAULT_ZH_DEFS_MODE).toBe("auto");
    expect(getZhDefsMode()).toBe("auto");
  });

  it("tap is stored as a JSON string and read back", () => {
    setZhDefsMode("tap");
    expect(window.localStorage.getItem(ZH_DEFS_PREF_KEY)).toBe('"tap"');
    expect(getZhDefsMode()).toBe("tap");
  });

  it("choosing auto again removes the key", () => {
    setZhDefsMode("tap");
    setZhDefsMode("auto");
    expect(window.localStorage.getItem(ZH_DEFS_PREF_KEY)).toBeNull();
    expect(getZhDefsMode()).toBe("auto");
  });

  it.each(['"TAP"', "1", "{}", "{not json", '"other"'])("stored %s counts as auto", (raw) => {
    window.localStorage.setItem(ZH_DEFS_PREF_KEY, raw);
    resetZhDefsModeMemory();
    expect(getZhDefsMode()).toBe("auto");
  });

  it("a stored tap survives a memory reset", () => {
    window.localStorage.setItem(ZH_DEFS_PREF_KEY, '"tap"');
    resetZhDefsModeMemory();
    expect(getZhDefsMode()).toBe("tap");
  });

  it("the hook re-renders on change", () => {
    const { result } = renderHook(() => useZhDefsMode());
    expect(result.current).toBe("auto");
    act(() => setZhDefsMode("tap"));
    expect(result.current).toBe("tap");
    act(() => setZhDefsMode("auto"));
    expect(result.current).toBe("auto");
  });

  it("a failing storage write does not throw and the choice still applies in memory", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setZhDefsMode("tap")).not.toThrow();
    expect(getZhDefsMode()).toBe("tap");
  });
});
