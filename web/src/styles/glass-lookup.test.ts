// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* 计划 2026-10-15-global-longpress-glass-lookup R-G1–R-G8:查词玻璃的令牌与配方。只断言源码;真实合成与可读性见真机清单(未验证)。 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const indexCss = read("../index.css");
const themeCss = read("./theme.css");
function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(themeCss, ":root");
const dark = tokens(themeCss, ".dark");
const alpha = (v: string) => Number(/,\s*([\d.]+)\)$/.exec(v)?.[1]);
const START = "查词玻璃(计划 2026-10-15-global-longpress-glass-lookup";
const section = indexCss.slice(indexCss.indexOf(START), indexCss.indexOf("查词玻璃结束"));

describe("glass lookup tokens (R-G1, R-G3, R-G8)", () => {
  it("ships the approved variant (B) in light and dark", () => {
    expect(root["--glass-pop"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(dark["--glass-pop"]).toBe("rgba(23, 25, 30, 0.1)");
    expect(root["--glass-sheet"]).toBe("rgba(255, 255, 255, 0.55)");
    expect(dark["--glass-sheet"]).toBe("rgba(23, 25, 30, 0.55)");
  });
  it("never goes below the legibility floor: bar ≥ 6%, drawer ≥ 38%", () => {
    for (const set of [root, dark]) {
      expect(alpha(set["--glass-pop"])).toBeGreaterThanOrEqual(0.06);
      expect(alpha(set["--glass-sheet"])).toBeGreaterThanOrEqual(0.38);
      expect(alpha(set["--glass-sheet-lite"])).toBe(0.86);
    }
  });
  it("defines the well, scrim and sheet shadow in both themes", () => {
    for (const name of ["--glass-well", "--glass-well-bd", "--lookup-scrim", "--glass-sheet-sh"]) {
      expect(root, name).toHaveProperty(name);
      expect(dark, name).toHaveProperty(name);
    }
  });
});

describe("glass lookup recipes (R-G1, R-G3, R-G5)", () => {
  it("has a solid fallback first, then blur only under @supports", () => {
    expect(section.indexOf(".glass-pop {")).toBeLessThan(section.indexOf("@supports ((-webkit-backdrop-filter"));
    expect(section).toContain("background: var(--glass-pop);");
    expect(section).toContain("background: var(--glass-sheet);");
    expect(section).toContain("-webkit-backdrop-filter: blur(28px) saturate(1.8);");
    expect(section).toContain("-webkit-backdrop-filter: blur(36px) saturate(1.8);");
  });
  it("uses the light blur on low-end devices and goes solid for reduced transparency", () => {
    expect(section).toContain("html.lite .glass-pop {");
    expect(section).toContain("html.lite .glass-sheet {");
    expect(section).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(section).toContain("background: rgb(var(--surface));");
  });
  it("adds no 4th blur layer on library screens", () => {
    expect(section).toContain("@supports selector(:has(*))");
    expect(section).toContain("html:has(.library-root) .glass-pop");
    expect(section).toContain("html:has(.library-root) .glass-sheet");
  });
  it("gives the bar's icons the tab bar halo, but not the primary trigger", () => {
    expect(section).toContain('.pop-halo :not([data-testid="lookup-trigger"]) > svg');
  });
});
