// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 计划 2026-10-14-floating-glass-bottom-bar(R-F2–R-F8):悬浮圆角玻璃底栏的令牌、几何与配方。
 * jsdom / node 没有合成与布局:这里只断言样式源码与令牌;真实模糊、对比度、安全区位置见计划的真机清单(未验证)。
 */
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
const decls = (body: string) =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1], m[2].trim()]));

/** 悬浮底栏段:从开头注释到结束注释 */
const START = "悬浮玻璃底栏(计划 2026-10-14-floating-glass-bottom-bar";
const END = "悬浮玻璃底栏结束";
const section = indexCss.slice(indexCss.indexOf(START), indexCss.indexOf(END));

const rgba = (value: string) => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!m) throw new Error(`not rgba: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number], a: Number(m[4]) };
};
const channels = (set: Record<string, string>, name: string) => (set[name] ?? root[name]).split(/\s+/).map(Number) as [number, number, number];
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("floating tab bar geometry (R-F2, R-F5)", () => {
  it("defines the bar geometry once on :root in @layer base", () => {
    const base = indexCss.slice(indexCss.indexOf("@layer base"), indexCss.indexOf("@font-face"));
    const d = decls(blockOf(base, /^\s+:root\s*\{/m));
    expect(d["--tab-bar-h"]).toBe("64px");
    expect(d["--tab-bar-gap"]).toBe("8px");
    expect(d["--tab-bar-bottom"]).toBe("max(10px, calc(env(safe-area-inset-bottom) - 8px))");
    expect(d["--tab-bar-space"]).toBe("calc(var(--tab-bar-h) + var(--tab-bar-bottom) + var(--tab-bar-gap))");
  });
});

describe("floating glass tokens (R-F3, R-F4, R-F7)", () => {
  it("ships the approved tint, the same alpha in light and dark, never below 6%", () => {
    expect(root["--glass-float"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(dark["--glass-float"]).toBe("rgba(23, 25, 30, 0.1)");
    for (const set of [root, dark]) {
      expect(rgba(set["--glass-float"]).a).toBeGreaterThanOrEqual(0.06);
      expect(rgba(set["--glass-float-lite"]).a).toBe(0.62);
    }
  });

  it("keeps tab labels at >= 4.5:1 against their halo colour (the halo, not the tint, carries contrast)", () => {
    for (const set of [root, dark]) {
      const halo = rgba(set["--tab-halo"]);
      expect(halo.a).toBeGreaterThanOrEqual(0.6);
      for (const fg of ["--ink-2", "--blue"]) expect(contrast(channels(set, fg), halo.rgb), fg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defines the border, highlight, shadow and active-pill tokens in both themes", () => {
    for (const set of [root, dark]) {
      for (const name of ["--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on"]) expect(set, name).toHaveProperty(name);
    }
    expect(root["--tab-on"]).toBe("rgba(36, 86, 219, 0.14)");
    expect(dark["--tab-on"]).toBe("rgba(143, 176, 255, 0.2)");
  });
});

describe(".glass-float recipe (R-F6, R-F8)", () => {
  it("lives in its own marked section inside @layer utilities", () => {
    const utilities = indexCss.slice(indexCss.indexOf("@layer utilities"));
    expect(utilities).toContain(START);
    expect(section.length).toBeGreaterThan(100);
  });

  it("is solid with a highlight border by default and never blurs outside @supports", () => {
    const base = decls(blockOf(section, /^\s+\.glass-float\s*\{/m));
    expect(base.background).toBe("var(--glass-solid)");
    expect(base.border).toBe("1px solid var(--glass-float-bd)");
    expect(base["box-shadow"]).toBe("var(--glass-float-hi), var(--glass-float-sh)");
    expect(base).not.toHaveProperty("backdrop-filter");
  });

  it("blurs 28px with the iOS prefix when supported, and lighter on low-end devices", () => {
    const supported = blockOf(section, /@supports \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    const full = decls(blockOf(supported, /^\s+\.glass-float\s*\{/m));
    expect(full.background).toBe("var(--glass-float)");
    expect(full["-webkit-backdrop-filter"]).toBe("blur(28px) saturate(1.8)");
    expect(full["backdrop-filter"]).toBe("blur(28px) saturate(1.8)");
    const lite = decls(blockOf(supported, /html\.lite \.glass-float\s*\{/));
    expect(lite.background).toBe("var(--glass-float-lite)");
    expect(lite["-webkit-backdrop-filter"]).toBe("blur(12px)");
  });

  it("turns solid, hairlined and halo-free with reduced transparency", () => {
    const reduced = blockOf(section, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(reduced).toMatch(/\.glass-float,\s*html\.lite \.glass-float\s*\{/);
    expect(reduced).toContain("background: rgb(var(--surface));");
    expect(reduced).toContain("border-color: var(--hair);");
    expect(reduced).toContain("backdrop-filter: none;");
    expect(reduced).toMatch(/\.tab-halo,\s*\.tab-halo svg\s*\{[^}]*text-shadow: none;[^}]*filter: none;/);
  });

  it("gives labels and icons a halo, and animates nothing in the section", () => {
    expect(decls(blockOf(section, /^\s+\.tab-halo\s*\{/m))["text-shadow"]).toBe("0 0 6px var(--tab-halo), 0 0 2px var(--tab-halo)");
    expect(decls(blockOf(section, /^\s+\.tab-halo svg\s*\{/m)).filter).toBe("drop-shadow(0 0 3px var(--tab-halo))");
    expect(section).not.toMatch(/\b(transition|animation)\s*:/);
  });
});
