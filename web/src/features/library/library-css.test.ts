// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "library.css"), "utf8");

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

describe("library.css (spec §11.4a, D11)", () => {
  it("defines the glass tokens from the mockup on .library-root, light and dark", () => {
    const light = blockOf(css, /^\.library-root\s*\{/m);
    expect(light).toContain("--lib-blur: 34px;");
    expect(light).toContain("--lib-glass-bg: rgba(255, 255, 255, 0.38);");
    expect(light).toContain("--lib-glass-strong: rgba(255, 255, 255, 0.55);");
    const dark = blockOf(css, /^\.dark \.library-root\s*\{/m);
    expect(dark).toContain("--lib-glass-bg: rgba(150, 170, 255, 0.1);");
    expect(dark).toContain("--lib-glass-strong: rgba(120, 140, 230, 0.17);");
    expect(dark).toContain("--lib-glass-bd: rgba(255, 255, 255, 0.26);");
  });

  it("makes the glass surface blur 34px with saturate 200% and keeps the iOS prefix", () => {
    const glass = blockOf(css, /^\.lib-glass\s*\{/m);
    expect(glass).toContain("-webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);");
    expect(glass).toContain("backdrop-filter: blur(var(--lib-blur)) saturate(2);");
  });

  it("limits blur to three surfaces: .lib-glass, .lib-gblur and the add sheet (R-L26)", () => {
    expect((css.match(/^\s+-webkit-backdrop-filter:\s*blur/gm) ?? []).length).toBe(3); // 只数声明(缩进的行),不数 @supports 的条件
    expect(blockOf(css, /^\.lib-gblur\s*\{/m)).toContain("-webkit-backdrop-filter: blur(7px);");
    expect(blockOf(css, /^\.library-root\.lib-sheet\s*\{/m)).toContain("-webkit-backdrop-filter: blur(var(--lib-blur)) saturate(2);");
    // 列表卡片与顶栏胶囊只用半透明填充 + 高光边
    expect(blockOf(css, /^\.lib-tint\s*\{/m)).not.toContain("backdrop-filter");
    expect(blockOf(css, /^\.lib-bar\s*\{/m)).not.toContain("backdrop-filter");
    expect(blockOf(css, /^\.lib-speed\s*\{/m)).not.toContain("backdrop-filter");
  });

  it("is scoped: no rule styles html, body, :root or * outside the lite fallbacks", () => {
    expect(css).not.toMatch(/^(body|:root|\*)\s*[,{]/m);
    expect(css).not.toMatch(/^html\s*[,{]/m);
    for (const line of css.split("\n").filter((l) => l.startsWith("html.lite"))) expect(line, line).toMatch(/^html\.lite \.(lib-|library-root)/);
  });

  it("animates only transform, opacity and background-position (two documented exceptions)", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(6);
    const allowed: Record<string, string[]> = { "lib-spin": ["--lib-a"], "lib-bw": ["opacity", "filter", "transform"] };
    for (const name of names) {
      const body = blockOf(css, new RegExp(`@keyframes\\s+${name}\\s*\\{`));
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      const ok = allowed[name] ?? ["transform", "opacity", "background-position"];
      for (const p of props) expect(ok, `${name} animates ${p}`).toContain(p);
    }
    // BorderGlow:@property 不被支持时退化为静态描边(var 有回退值,不会让整条 background 失效)
    expect(css).toContain("@property --lib-a");
    expect(css).toContain("from var(--lib-a, 0deg)");
  });

  it("stills every animation under prefers-reduced-motion and on low-end devices (R-L28)", () => {
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    const lite = sectionAfter(css, "降级:低端机");
    for (const selector of [
      ".lib-aurora i", ".lib-shiny", ".library-root .lib-spec::after", ".lib-glow::after", '.lib-step[data-state="now"]::after',
      ".lib-zh-skeleton", ".lib-rise", ".lib-bw",
    ]) {
      expect(reduced, `reduced-motion: ${selector}`).toContain(selector);
      expect(lite, `lite: ${selector}`).toContain(selector);
    }
    expect(reduced).toContain("animation: none;");
    expect(lite).toContain("animation: none;");
    expect(blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/)).toContain("transition: none;");
  });

  it("falls back to solid surfaces without backdrop-filter, on low-end devices and with reduced transparency", () => {
    const unsupported = blockOf(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    expect(unsupported).toContain(".lib-glass");
    expect(unsupported).toContain("var(--lib-solid)");
    const lite = sectionAfter(css, "降级:低端机");
    expect(lite).toContain("html.lite .lib-glass");
    expect(lite).toMatch(/backdrop-filter: none;/);
    expect(lite).toContain("background: var(--lib-solid);");
    const transparency = blockOf(css, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(transparency).toContain(".lib-glass");
    expect(transparency).toContain("backdrop-filter: none;");
  });

  it("only paints text with a gradient where background-clip: text exists (otherwise the text would vanish)", () => {
    const guarded = blockOf(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)\s*\{/);
    expect(guarded).toContain(".lib-shiny");
    expect(guarded).toContain(".lib-gt");
    expect(guarded).toContain("color: transparent;");
    expect(css.replace(guarded, "")).not.toContain("color: transparent;");
  });

  it("keeps every floating layer below the lookup bar (z-index 40) and the global tab bar (z-index 30 sits later in the DOM)", () => {
    const z = (re: RegExp) => Number(/z-index:\s*(\d+);/.exec(blockOf(css, re))?.[1]);
    expect(z(/^\.lib-ctrl\s*\{/m)).toBeLessThanOrEqual(30);
    expect(z(/^\.lib-gblur\s*\{/m)).toBeLessThan(30);
    expect(z(/^\.lib-speed\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.lib-fab\s*\{/m)).toBeLessThanOrEqual(30);
  });

  it("keeps the sentence text selectable so the lookup bar still works (R-L33)", () => {
    const text = blockOf(css, /^\.lib-seg-text\s*\{/m);
    expect(text).toContain("-webkit-user-select: text;");
    expect(text).toContain("user-select: text;");
  });

  it("stays small (target: library styles + effects ≤ 6 kB gzip in total, measured in L16)", () => {
    expect(css.length).toBeLessThan(22_000);
  });
});
