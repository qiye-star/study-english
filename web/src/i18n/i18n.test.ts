import { describe, expect, it } from "vitest";
import i18n, { deepMerge, webMessages } from "./index";

describe("i18n", () => {
  it("merges web keys for en and zh-CN", () => {
    expect(i18n.getFixedT("en")("web.appName")).toBe("Enjoy English Practice");
    expect(i18n.getFixedT("zh-CN")("web.appName")).toBe("Enjoy 英语练习");
  });
  it("keeps the desktop language packs", () => {
    expect(i18n.getFixedT("zh-CN")("pronunciationAssessment")).toBe("发音评估");
  });
  it("falls back to English for web keys in es", () => {
    expect(i18n.getFixedT("es")("web.nav.chat")).toBe("Chat");
  });
  it("collects web messages from i18n folders", () => {
    expect((webMessages("zh-CN").web as any).nav.practice).toBe("练习");
  });
  it("deepMerge merges nested objects without mutating inputs", () => {
    const a = { web: { a: 1, nested: { x: 1 } } };
    expect(deepMerge(a, { web: { nested: { y: 2 } } })).toEqual({ web: { a: 1, nested: { x: 1, y: 2 } } });
    expect(a).toEqual({ web: { a: 1, nested: { x: 1 } } });
  });
});
