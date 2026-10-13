import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
type Dict = Record<string, unknown>;
const load = (name: string): Dict => JSON.parse(readFileSync(path.join(here, "locales", name), "utf8"));
const en = load("en.json");
const zh = load("zh-CN.json");
const at = (d: unknown, p: string): unknown => p.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);
const leaves = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

// W2 拥有的源文件(Task 2 时多数还不存在,存在才扫)
const W2_SOURCES = [
  "attempts-api.ts", "word-tap.ts", "save-sentence.tsx", "use-shadowing.ts", "score-card.tsx", "segment-editor.tsx",
  "analysis-card.tsx", "use-translations.ts", "segment-menu.tsx", "shadow-panel.tsx",
].filter((f) => existsSync(path.join(here, f)));

describe("web.library.shadow strings (plan W2 R-SH04)", () => {
  it("has the same keys in en and zh-CN", () => {
    const a = leaves(at(en, "web.library.shadow")).sort();
    const b = leaves(at(zh, "web.library.shadow")).sort();
    expect(a.length).toBeGreaterThan(30);
    expect(a).toEqual(b);
  });

  it("has the same interpolation placeholders in both languages", () => {
    const slots = (s: unknown) => (String(s).match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort().join(",");
    for (const key of leaves(at(en, "web.library.shadow"))) {
      expect(slots(at(en, `web.library.shadow.${key}`)), key).toBe(slots(at(zh, `web.library.shadow.${key}`)));
    }
  });

  it("defines every web.library.shadow.* literal the W2 sources use", () => {
    for (const file of W2_SOURCES) {
      const source = readFileSync(path.join(here, file), "utf8");
      for (const m of source.matchAll(/["'`](web\.library\.shadow\.[A-Za-z0-9_.]+?)["'`]/g)) {
        const key = m[1];
        if (key.endsWith(".")) continue;
        expect(typeof at(en, key), `${file}: ${key} in en`).toBe("string");
        expect(typeof at(zh, key), `${file}: ${key} in zh-CN`).toBe("string");
      }
    }
  });

  it("defines the keys built from templates (editor edges)", () => {
    for (const edge of ["start", "end"]) {
      for (const suffix of ["", "Earlier", "Later"]) {
        const key = `web.library.shadow.editor.${edge}${suffix}`;
        expect(typeof at(en, key), key).toBe("string");
        expect(typeof at(zh, key), key).toBe("string");
      }
    }
    for (const tone of ["good", "fair", "low"]) {
      expect(typeof at(en, `web.library.shadow.score.${tone}`)).toBe("string");
      expect(typeof at(zh, `web.library.shadow.score.${tone}`)).toBe("string");
    }
  });
});
