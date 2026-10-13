import { describe, expect, it } from "vitest";
import type { LibrarySegment } from "./library-api";
import { mergeTranslations, needsTranslation, zhFor } from "./translation-state";

const seg = (over: Partial<LibrarySegment> = {}): LibrarySegment => ({ idx: 0, startMs: 0, endMs: 1000, text: "Hi.", zh: null, zhLang: null, ...over });

describe("translation state (spec E11, R-L32)", () => {
  it("shows a translation only in the language it was made for", () => {
    expect(zhFor(seg({ zh: "你好。", zhLang: "zh-CN" }), "zh-CN")).toBe("你好。");
    expect(zhFor(seg({ zh: "你好。", zhLang: "zh-CN" }), "es-ES")).toBeNull();
    expect(zhFor(seg({ zh: "你好。", zhLang: null }), "zh-CN")).toBe("你好。");
    expect(zhFor(seg({ zh: "", zhLang: "zh-CN" }), "zh-CN")).toBeNull();
    expect(zhFor(seg(), "zh-CN")).toBeNull();
    expect(zhFor({}, "zh-CN")).toBeNull(); // 旧服务端 / 旧夹具没有这两个键
  });

  it("asks again for sentences whose translation is missing or in another language", () => {
    expect(needsTranslation(seg(), "zh-CN")).toBe(true);
    expect(needsTranslation(seg({ zh: "旧", zhLang: "es-ES" }), "zh-CN")).toBe(true);
    expect(needsTranslation(seg({ zh: "好", zhLang: "zh-CN" }), "zh-CN")).toBe(false);
  });

  it("merges fresh translations by index and keeps object identity when nothing changes", () => {
    const list = [seg({ idx: 0 }), seg({ idx: 1, zh: "旧", zhLang: "es-ES" })];
    const next = mergeTranslations(list, [{ idx: 1, zh: "新" }, { idx: 9, zh: "没有这一句" }], "zh-CN");
    expect(next).not.toBe(list);
    expect(next[0]).toBe(list[0]);
    expect(next[1]).toEqual({ ...list[1], zh: "新", zhLang: "zh-CN" });
    expect(list[1].zh).toBe("旧");
    expect(mergeTranslations(next, [{ idx: 1, zh: "新" }], "zh-CN")).toBe(next);
    expect(mergeTranslations(next, [], "zh-CN")).toBe(next);
  });
});
