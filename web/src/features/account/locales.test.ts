import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureAccountI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

describe("account locales (X37: lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.account", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.account."))).toBe(true);
  });

  it("merges into i18next once loaded", () => {
    ensureAccountI18n();
    expect(i18n.getFixedT("zh-CN")("web.account.nickname.saved")).toBe("昵称已保存");
    expect(i18n.getFixedT("en")("web.account.code.resendIn", { seconds: 30 })).toBe("Resend in 30s");
  });

  it("does not shadow shared keys (web.errors / web.login stay in the eager bundles)", () => {
    expect(keysOf(en).some((k) => k.startsWith("web.errors.") || k.startsWith("web.login."))).toBe(false);
    expect(keysOf(zh).some((k) => k.startsWith("web.errors.") || k.startsWith("web.login."))).toBe(false);
  });
});
