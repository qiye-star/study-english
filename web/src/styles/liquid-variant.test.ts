// @vitest-environment node
import { createRequire } from "node:module";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const config = require("../../tailwind.config.cjs");

async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>` }], corePlugins: { ...config.corePlugins, preflight: false } }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("liquid: variant and tokens (plan 2026-10-15-liquid-glass INDEX §4.2, §5.2)", () => {
  it("scopes liquid: utilities under html[data-glass=v2] with specificity above dark:/hover: (0,2,1 vs 0,2,0)", async () => {
    const css = await compile("bg-surface dark:bg-surface-2 hover:bg-surface-2 liquid:bg-wash liquid:active:bg-wash-2");
    expect(css).toContain('.liquid\\:bg-wash:is(html[data-glass="v2"] *)');
    // Tailwind emits liquid: before dark: (measured); the html tag is what keeps liquid: ahead of dark: in dark mode.
    expect(css).toContain('.dark\\:bg-surface-2:is(.dark *)');
    const at = (needle: string) => css.indexOf(needle);
    expect(at(".liquid\\:bg-wash")).toBeGreaterThan(at(".bg-surface"));
    expect(at(".liquid\\:bg-wash")).toBeGreaterThan(at("hover\\:bg-surface-2"));
    expect(css).toMatch(/\.liquid\\:active\\:bg-wash-2:active:is\(html\[data-glass="v2"\] \*\)|\.liquid\\:active\\:bg-wash-2:is\(html\[data-glass="v2"\] \*\):active/);
  });

  it("radii scale with --gx-radius except the bubble tail", async () => {
    const css = await compile("rounded-panel rounded-tile rounded-float rounded-sheet-xl rounded-dialog rounded-field rounded-inset rounded-tr-tail");
    expect(css).toContain("calc(26px * var(--gx-radius, 1))");
    expect(css).toContain("calc(22px * var(--gx-radius, 1))");
    expect(css).toContain("calc(32px * var(--gx-radius, 1))");
    expect(css).toContain("calc(30px * var(--gx-radius, 1))");
    expect(css).toContain("calc(20px * var(--gx-radius, 1))");
    expect(css).toContain("max(10px, calc(26px * var(--gx-radius, 1) - 12px))");
    expect(css).toMatch(/border-top-right-radius:\s*8px/);
  });

  it("has the colour, spacing, shadow and type tokens", async () => {
    const css = await compile("bg-wash bg-wash-2 bg-graphite text-on-graphite bg-plate px-frame shadow-well shadow-e1 shadow-accent text-large");
    expect(css).toContain("var(--ink-wash)");
    expect(css).toContain("var(--ink-wash-2)");
    expect(css).toContain("rgb(var(--graphite)");
    expect(css).toContain("var(--plate)");
    expect(css).toContain("padding-left: 12px");
    expect(css).toContain("inset 0 0 0 .5px var(--hair-2)");
    expect(css).toContain("var(--mat-sh-1)");
    expect(css).toMatch(/font-size:\s*30px/);
  });
});
