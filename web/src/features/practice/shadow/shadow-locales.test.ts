import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

describe("shadow sheet copy", () => {
  it("has the same keys in English and Chinese", () => {
    expect(flatten(zh).sort()).toEqual(flatten(en).sort());
  });

  it("defines every literal web.practice.shadow.* key the lazy sources use", () => {
    const keys = new Set(flatten(en));
    for (const file of ["shadow-sheet.tsx", "shadow-result.tsx"]) {
      for (const m of read(file).matchAll(/"web\.practice\.shadow\.([A-Za-z.]+)"/g)) {
        expect(keys.has(`web.practice.shadow.${m[1]}`), `${file}: ${m[1]}`).toBe(true);
      }
    }
    for (const kind of ["good", "fair", "weak"]) expect(keys.has(`web.practice.shadow.tip.${kind}`)).toBe(true);
  });

  it("is not in the eager i18n files (it must stay out of the main bundle)", () => {
    expect(read("../i18n/en.json")).not.toContain('"shadow"');
    expect(read("../i18n/zh-CN.json")).not.toContain('"shadow"');
  });

  it("registers both languages when the module is imported", async () => {
    await import("./shadow-locales");
    expect(i18n.t("web.practice.shadow.title", { lng: "en" })).toBe("Read aloud");
    expect(i18n.t("web.practice.shadow.title", { lng: "zh-CN" })).toBe("跟读");
    expect(i18n.t("web.practice.shadow.position", { lng: "en", n: 2, total: 3 })).toBe("2 / 3");
  });
});
