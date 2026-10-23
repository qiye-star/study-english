// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "dubbing.css"), "utf8");
const theme = readFileSync(path.join(here, "../../styles/theme.css"), "utf8");
const identity = readFileSync(path.join(here, "role-identity.tsx"), "utf8");
const picker = readFileSync(path.join(here, "clip-picker.tsx"), "utf8");

/** 取 `header {` 之后配对大括号里的内容。 */
function blockOf(source: string, header: RegExp): string {
  const m = header.exec(source);
  if (!m) throw new Error(`missing block: ${header}`);
  const open = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}

/** 块里的 `--name: value;` → 表。 */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const LETTERS = ["a", "b", "c", "d", "e", "f"];
const NAMES = [
  "--dub-sel", "--dub-sel-bd", "--dub-sel-bar", "--dub-mark-bg", "--dub-mark-fg",
  ...LETTERS.flatMap((l) => [`--dub-role-${l}`, `--dub-role-${l}-soft`]),
];

const light = tokens(blockOf(css, /^\.dub-root\s*\{/m));
const dark = tokens(blockOf(css, /^\.dark \.dub-root\s*\{/m));
const themeLight = tokens(blockOf(theme, /^:root\s*\{/m));
const themeDark = tokens(blockOf(theme, /^\.dark\s*\{/m));

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const channels = (v: string): Rgb => v.split(/\s+/).map(Number) as Rgb;
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("dubbing.css (plan 2026-10-23 R-B3/R-B4)", () => {
  it("is pulled in by the lazy role-identity and clip-picker modules", () => {
    expect(identity).toContain('import "./dubbing.css";');
    expect(picker).toContain('import "./dubbing.css";');
  });

  it("a half selection is a dashed frame, and the selection rules use tokens only (no literal colours)", () => {
    expect(blockOf(css, /\[data-sel="half"\]\s*\{/)).toContain("dashed");
    const rules = [...css.matchAll(/^[^{}\n]*\[data-sel=[^{]*\{[^}]*\}/gm)].map((m) => m[0]);
    expect(rules.length).toBeGreaterThan(3);
    for (const rule of rules) expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    const marks = blockOf(css, /^\.dub-mark\s*\{/m);
    expect(marks).toContain("var(--dub-mark-bg)");
    expect(marks).toContain("var(--dub-mark-fg)");
  });

  it.each([["light", light], ["dark", dark]] as const)("%s defines every token", (_, set) => {
    for (const name of NAMES) expect(set, name).toHaveProperty(name);
  });

  it("uses no blur", () => {
    expect(css).not.toContain("backdrop-filter");
  });

  describe.each([["light", light, themeLight], ["dark", dark, themeDark]] as const)("%s contrast guards", (_, set, base) => {
    const ink = channels(base["--ink"]);
    const surface = channels(base["--surface"]);

    it("the selected row is visible against the surface but gentle (1.03 to 1.15)", () => {
      const ratio = contrast(hex(set["--dub-sel"]), surface);
      expect(ratio).toBeGreaterThanOrEqual(1.03);
      expect(ratio).toBeLessThanOrEqual(1.15);
    });

    it("ink is readable (7 or more) on the selected row and on every soft role tint", () => {
      expect(contrast(ink, hex(set["--dub-sel"]))).toBeGreaterThanOrEqual(7);
      for (const l of LETTERS) expect(contrast(ink, hex(set[`--dub-role-${l}-soft`])), l).toBeGreaterThanOrEqual(7);
    });

    it("the Start / End mark text is readable on its tint (4.5 or more)", () => {
      expect(contrast(hex(set["--dub-mark-fg"]), hex(set["--dub-mark-bg"]))).toBeGreaterThanOrEqual(4.5);
    });

    it("every role dot is visible (3 or more, WCAG 1.4.11) on its own tint and on the selected row", () => {
      for (const l of LETTERS) {
        const dot = hex(set[`--dub-role-${l}`]);
        expect(contrast(dot, hex(set[`--dub-role-${l}-soft`])), `${l} soft`).toBeGreaterThanOrEqual(3);
        expect(contrast(dot, hex(set["--dub-sel"])), `${l} sel`).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
