// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "shadow-sheet.css"), "utf8");
const sheet = readFileSync(path.join(here, "shadow-sheet.tsx"), "utf8");

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
/** 从某个分节注释开始到下一个分节注释(或文件末尾)。 */
function sectionAfter(source: string, title: string): string {
  const start = source.indexOf(title);
  if (start < 0) throw new Error(`missing section: ${title}`);
  const next = source.indexOf("/* =====", start + title.length);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("shadow-sheet.css (spec §3.3, mockup-glass)", () => {
  it("is pulled in by the lazy sheet only", () => {
    expect(sheet).toContain('import "./shadow-sheet.css";');
  });

  it("defines the glass tokens from the mockup on .shs-root, light and dark", () => {
    const light = blockOf(css, /^\.shs-root\s*\{/m);
    expect(light).toContain("--shs-blur: 34px;");
    expect(light).toContain("--shs-glass-strong: rgba(255, 255, 255, 0.62);");
    expect(light).toContain("--shs-glass-bd: rgba(255, 255, 255, 0.85);");
    expect(light).toContain("--shs-scrim: rgba(10, 14, 28, 0.3);");
    const dark = blockOf(css, /^\.dark \.shs-root\s*\{/m);
    expect(dark).toContain("--shs-glass-strong: rgba(120, 140, 230, 0.17);");
    expect(dark).toContain("--shs-glass-bd: rgba(255, 255, 255, 0.26);");
    expect(dark).toContain("--shs-scrim: rgba(2, 4, 10, 0.52);");
  });

  it("blurs exactly one surface (the sheet) with saturate 200% and the iOS prefix", () => {
    expect((css.match(/^\s+-webkit-backdrop-filter:\s*blur/gm) ?? []).length).toBe(1);
    const sheetBlock = blockOf(css, /^\.shs-sheet\s*\{/m);
    expect(sheetBlock).toContain("-webkit-backdrop-filter: blur(var(--shs-blur)) saturate(2);");
    expect(sheetBlock).toContain("backdrop-filter: blur(var(--shs-blur)) saturate(2);");
    // 遮罩、卡片、按钮、芯片只用半透明填充 + 高光边
    for (const header of [/^\.shs-scrim\s*\{/m, /^\.shs-tint\s*\{/m, /^\.shs-btn\s*\{/m, /^\.shs-confirm\s*\{/m, /^\.shs-err\s*\{/m]) {
      expect(blockOf(css, header)).not.toContain("backdrop-filter");
    }
  });

  it("is scoped: no rule styles html, body, :root or * outside the lite fallbacks", () => {
    expect(css).not.toMatch(/^(body|:root|\*)\s*[,{]/m);
    expect(css).not.toMatch(/^html\s*[,{]/m);
    for (const line of css.split("\n").filter((l) => l.startsWith("html.lite"))) expect(line, line).toMatch(/^html\.lite \.shs-/);
  });

  it("animates only transform, opacity and background-position", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) {
      const body = blockOf(css, new RegExp(`@keyframes\\s+${name}\\s*\\{`));
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity", "background-position"], `${name} animates ${p}`).toContain(p);
    }
  });

  const ANIMATED = [
    ".shs-scrim", ".shs-sheet", ".shs-rise", ".shs-btn--primary::after", ".shs-btn--stop::before", ".shs-pulse::after",
    ".shs-timer--live .shs-clock", ".shs-wave i", ".shs-shiny", ".shs-indet b", ".shs-bar-t b", ".shs-wd", ".shs-spark", ".shs-eq b",
  ];

  it("stills every animation under prefers-reduced-motion and on low-end devices", () => {
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    const lite = sectionAfter(css, "降级:低端机");
    for (const selector of ANIMATED) {
      expect(reduced, `reduced-motion: ${selector}`).toContain(selector);
      expect(lite, `lite: ${selector}`).toContain(selector);
    }
    expect(reduced).toContain("animation: none;");
    expect(lite).toContain("animation: none;");
  });

  it("falls back to a solid sheet without backdrop-filter, on low-end devices and with reduced transparency", () => {
    const unsupported = blockOf(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    expect(unsupported).toContain(".shs-sheet");
    expect(unsupported).toContain("var(--shs-solid)");
    const lite = sectionAfter(css, "降级:低端机");
    expect(lite).toContain("html.lite .shs-sheet");
    expect(lite).toMatch(/backdrop-filter: none;/);
    expect(lite).toContain("background: var(--shs-solid);");
    const transparency = blockOf(css, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(transparency).toContain(".shs-sheet");
    expect(transparency).toContain("backdrop-filter: none;");
  });

  it("only paints text with a gradient where background-clip: text exists (otherwise the text would vanish)", () => {
    const guarded = blockOf(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)\s*\{/);
    expect(guarded).toContain(".shs-shiny");
    expect(guarded).toContain(".shs-gt");
    expect(guarded).toContain("color: transparent;");
    expect(css.replace(guarded, "")).not.toContain("color: transparent;");
  });

  it("keeps the sheet below the selection bar (z-index 40) and the lookup drawer (50)", () => {
    const z = (re: RegExp) => Number(/z-index:\s*(\d+);/.exec(blockOf(css, re))?.[1]);
    expect(z(/^\.shs-scrim\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.shs-sheet\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.shs-sheet\s*\{/m)).toBeGreaterThan(z(/^\.shs-scrim\s*\{/m));
    expect(z(/^\.shs-scrim\s*\{/m)).toBeGreaterThan(30); // 盖住全站底栏(z-30)
  });

  it("makes the sheet receive taps even while a modal sheet is still animating out, and scroll itself under the viewport lock", () => {
    expect(blockOf(css, /^\.shs-scrim,\s*\.shs-sheet\s*\{/m)).toContain("pointer-events: auto;");
    const sheetBlock = blockOf(css, /^\.shs-sheet\s*\{/m);
    expect(sheetBlock).toContain("position: fixed;");
    expect(sheetBlock).toContain("85dvh");
    expect(sheetBlock).toContain("var(--app-height, 100dvh)");
    const scroll = blockOf(css, /^\.shs-scroll\s*\{/m);
    expect(scroll).toContain("overflow-y: auto;");
    expect(scroll).toContain("overscroll-behavior: contain;");
  });

  it("keeps the sentence text selectable so the lookup bar still works", () => {
    const sel = blockOf(css, /^\.shs-sel\s*\{/m);
    expect(sel).toContain("-webkit-user-select: text;");
    expect(sel).toContain("user-select: text;");
  });

  it("paints the aurora only inside the scrim: transparent until it fades in, blurred by the element itself, never a glass layer (R-S22)", () => {
    const aurora = blockOf(css, /^\.shs-aurora\s*\{/m);
    expect(aurora).toContain("position: absolute;");
    expect(aurora).toContain("inset: 0;");
    expect(aurora).toContain("overflow: hidden;");
    expect(aurora).toContain("opacity: 0;");
    expect(aurora).toContain("pointer-events: none;");
    expect(aurora).toContain("animation: shs-aurora-in 0.7s ease forwards;");
    const blob = blockOf(css, /^\.shs-aurora i\s*\{/m);
    expect(blob).toContain("width: 320px;");
    expect(blob).toContain("filter: blur(50px);");
    expect(blob).not.toContain("backdrop-filter");
    expect(aurora).not.toContain("backdrop-filter");
    for (const n of [1, 2, 3]) expect(css).toContain(`.shs-aurora i:nth-child(${n})`);
    const light = blockOf(css, /^\.shs-root\s*\{/m);
    expect(light).toContain("--shs-blob1: #9db8ff;");
    expect(light).toContain("--shs-blob2: #b9f0e6;");
    expect(light).toContain("--shs-blob3: #ffd7b0;");
    const dark = blockOf(css, /^\.dark \.shs-root\s*\{/m);
    expect(dark).toContain("--shs-blob1: #4f6dff;");
    expect(dark).toContain("--shs-blob2: #12b3a2;");
    expect(dark).toContain("--shs-blob3: #8f5a3a;");
    expect(blockOf(css, /@keyframes\s+shs-drift\s*\{/)).toContain("transform:");
    expect(blockOf(css, /@keyframes\s+shs-aurora-in\s*\{/)).toContain("opacity:");
    // the scrim stays translucent so the colour shows through
    expect(blockOf(css, /^\.shs-scrim\s*\{/m)).toContain("background: var(--shs-scrim);");
  });

  it("halves the aurora without drift on low-end devices and shows it still under reduced motion", () => {
    const lite = sectionAfter(css, "降级:低端机");
    expect(lite).toMatch(/html\.lite \.shs-aurora\s*\{[^}]*opacity: 0\.5;[^}]*animation: none;/);
    expect(lite).toContain("html.lite .shs-aurora i");
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    expect(reduced).toMatch(/\.shs-aurora\s*\{[^}]*animation: none;[^}]*opacity: 1;/);
    expect(reduced).toContain(".shs-aurora i");
  });

  it("stays small", () => {
    expect(css.length).toBeLessThan(24_000);
  });
});
