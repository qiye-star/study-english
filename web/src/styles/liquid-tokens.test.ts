// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* Same block parser as theme.test.ts (first top-level :root / .dark block). */
const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");
function tokens(selector: ":root" | ".dark"): Record<string, string> {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(":root");
const dark = tokens(".dark");

const PAIRED = [
  "--graphite", "--on-graphite", "--ink-wash", "--ink-wash-2", "--plate", "--scrim",
  "--page-top", "--page-bottom", "--page-flat", "--page-sheen", "--page-grain",
  "--mat-1-rgb", "--mat-2-rgb", "--mat-3-rgb", "--mat-rim-rgb",
  "--mat-1-alpha", "--mat-1s-alpha", "--mat-2-alpha", "--mat-2-bar-alpha", "--mat-3-alpha",
  "--mat-2-filter", "--mat-2-bar-filter", "--mat-3-filter",
  "--mat-rim-1", "--mat-rim-2", "--mat-rim-3", "--mat-hi", "--mat-sh-1", "--mat-sh-2", "--mat-sh-3",
];

const lum = ([r, g, b]: number[]) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const nums = (v: string) => (v.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

describe("liquid glass tokens (plan 2026-10-15-liquid-glass INDEX §5.1)", () => {
  it.each([[":root", root], [".dark", dark]] as const)("%s defines every paired token", (_, set) => {
    for (const name of PAIRED) expect(set, name).toHaveProperty(name);
  });

  it("keeps the scalars on :root only", () => {
    expect(root["--gx-radius"]).toBe("1");
    expect(root["--frame-x"]).toBe("12px");
    expect(dark).not.toHaveProperty("--gx-radius");
  });

  it("uses the 磨砂 defaults from the v2 mockup", () => {
    expect([root["--mat-1-alpha"], root["--mat-2-alpha"], root["--mat-2-bar-alpha"], root["--mat-3-alpha"]]).toEqual([".70", ".62", ".74", ".68"]);
    expect([dark["--mat-1-alpha"], dark["--mat-2-alpha"], dark["--mat-2-bar-alpha"], dark["--mat-3-alpha"]]).toEqual([".055", ".58", ".70", ".64"]);
    expect(root["--mat-2-filter"]).toBe("blur(24px) saturate(1.6)");
    expect(root["--mat-3-filter"]).toBe("blur(32px) saturate(1.6)");
    expect(root["--plate"]).toBe("rgba(255, 255, 255, 0.9)");
    expect(dark["--plate"]).toBe("rgba(23, 25, 30, 0.9)");
  });

  it("keeps ink-2 at AA on the worse end of the default page gradient", () => {
    expect(contrast([91, 97, 112], nums(root["--page-bottom"]))).toBeGreaterThanOrEqual(4.5);
    expect(contrast([166, 171, 184], nums(dark["--page-top"]))).toBeGreaterThanOrEqual(4.5);
  });

  it("text on graphite stays readable", () => {
    expect(contrast(nums(root["--on-graphite"]), nums(root["--graphite"]))).toBeGreaterThanOrEqual(7);
    expect(contrast(nums(dark["--on-graphite"]), nums(dark["--graphite"]))).toBeGreaterThanOrEqual(7);
  });

  it("does not change any existing token value (pins, R-LG3)", () => {
    expect(root["--bg"]).toBe("255 255 255");
    expect(root["--blue"]).toBe("36 86 219");
    expect(root["--glass-float"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(root["--radius"]).toBe("12px");
  });
});
