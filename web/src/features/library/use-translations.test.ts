import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranslations } from "./use-translations";

describe("use-translations placeholder (W2 replaces it, R-L32)", () => {
  it("is idle: nothing pending, no notice, and retry does nothing", () => {
    const { result } = renderHook(() =>
      useTranslations({ itemId: "i1", enabled: true, segments: [], anchorIdx: 0, native: "zh-CN", onTranslated: () => {} }));
    expect(result.current.pending.size).toBe(0);
    expect(result.current.notice).toBeNull();
    expect(() => result.current.retry()).not.toThrow();
  });
});
