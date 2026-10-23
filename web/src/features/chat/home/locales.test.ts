import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureChatHomeI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

describe("chat home locales (lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.chat.home", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.chat.home."))).toBe(true);
  });

  it("merges into i18next once loaded without touching the chat feature's own keys", () => {
    ensureChatHomeI18n();
    expect(i18n.getFixedT("zh-CN")("web.chat.home.drawer.new")).toBe("新建对话");
    expect(i18n.getFixedT("en")("web.chat.home.settings.done")).toBe("Done");
    expect(i18n.getFixedT("en")("web.chat.title")).toBe("Chat");
  });

  it("does not live under an i18n/ folder (that glob is merged into the main bundle)", () => {
    const eager = import.meta.glob("./i18n/*.json");
    expect(Object.keys(eager)).toEqual([]);
  });
});
