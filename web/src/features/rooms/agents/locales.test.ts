import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

// Raw text of the eager files: i18next's deep merge mutates the shared JSON module objects once ./locales is imported.
const eagerRaw = import.meta.glob<string>("../../../**/i18n/*.json", { eager: true, query: "?raw", import: "default" });

describe("room agents lazy locales (plan addressing-web R-AW1)", () => {
  it("has the same keys in en and zh-CN, all under web.rooms", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.rooms."))).toBe(true);
  });

  it("never repeats a key of the eager bundle (the no-overwrite merge would silently keep the eager value)", () => {
    for (const [lng, dict] of [["en", en], ["zh-CN", zh]] as const) {
      for (const [file, raw] of Object.entries(eagerRaw).filter(([f]) => f.endsWith(`/${lng}.json`))) {
        const d = JSON.parse(raw);
        for (const key of keysOf(dict)) expect(at(d, key), `${lng} ${key} in ${file}`).toBeUndefined();
      }
    }
  });

  it("is merged into i18next once the module is imported", () => {
    expect(i18n.getFixedT("zh-CN")("web.rooms.agents.target.to", { name: "Emma" })).toBe("对 Emma 说");
    expect(i18n.getFixedT("zh-CN")("web.rooms.notice.voice_unclear")).toBe("没听清,再说一次");
    expect(i18n.getFixedT("en")("web.rooms.agents.composer.placeholder", { name: "Emma" })).toBe("Say something, or ask @AI (Emma)");
    // the eager keys around them are still there
    expect(i18n.getFixedT("zh-CN")("web.rooms.agents.tutor.yourTurn")).toBe("轮到你了");
  });

  it("keeps one-line labels short enough for a 360 px composer row", () => {
    for (const key of ["web.rooms.agents.target.to", "web.rooms.agents.note.show", "web.rooms.agents.mention.alias"]) {
      expect(String(at(en, key)).replace("{{name}}", "Emma").length, key).toBeLessThanOrEqual(12);
    }
  });
});
