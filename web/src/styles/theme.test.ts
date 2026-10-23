// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * 裁定(plan 2026-10-08 Global Constraints):web 主题可以与 enjoy/src/index.css 分叉。
 * 本测试改为校验 web 自己的设计令牌(redesign v3 design-notes.md):
 * 令牌齐全、亮/暗两套一致、关键色值与设计稿一致、正文对比度 ≥ 4.5:1。
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const webCss = read("./theme.css");

function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const root = tokens(webCss, ":root");
const dark = tokens(webCss, ".dark");

/** 以 "r g b" 三元组保存、在 tailwind 中以 rgb(var(--x) / <alpha-value>) 使用的令牌。 */
const CHANNEL_TOKENS = [
  "--bg", "--surface", "--surface-2", "--ink", "--ink-2", "--ink-3",
  "--blue", "--teal", "--amber", "--green", "--red", "--red-solid", "--on-blue",
  // shadcn 名称:沿用旧组件的 bg-background / text-primary 等
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground", "--accent", "--accent-foreground",
  "--destructive", "--destructive-foreground", "--border", "--input", "--ring", "--active-word",
];
/** 完整颜色值(带 alpha 的色调、发丝线、玻璃),只能整体使用。 */
const COLOR_TOKENS = [
  "--hair", "--hair-2", "--key", "--seg-track", "--seg-on",
  "--blue-tint", "--blue-wash", "--teal-tint", "--amber-tint", "--green-tint", "--red-tint",
  "--glass", "--glass-solid", "--glass-bar", "--glass-lite", "--glass-shadow",
  "--glass-float", "--glass-float-lite", "--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on", "--tab-halo",
  "--glass-pop", "--glass-sheet", "--glass-sheet-lite", "--glass-sheet-sh", "--glass-well", "--glass-well-bd", "--lookup-scrim",
];
/** 与主题无关、只在 :root 定义的令牌。 */
const SCALAR_TOKENS = ["--radius", "--dur-fast", "--dur-base", "--ease-standard"];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
const channels = (value: string) => value.split(/\s+/).map(Number) as [number, number, number];

function resolve(set: Record<string, string>, name: string): [number, number, number] {
  const value = set[name] ?? root[name];
  const alias = value.match(/^var\((--[\w-]+)\)$/);
  return alias ? resolve(set, alias[1]) : channels(value);
}

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

describe("theme tokens (redesign v3)", () => {
  it.each([[":root", root], [".dark", dark]] as const)("%s defines every themed token", (_, set) => {
    for (const name of [...CHANNEL_TOKENS, ...COLOR_TOKENS]) expect(set, name).toHaveProperty(name);
  });

  it("scalar tokens live on :root only", () => {
    for (const name of SCALAR_TOKENS) expect(root, name).toHaveProperty(name);
    expect(root["--radius"]).toBe("12px");
  });

  it("channel tokens are r g b triplets or aliases of one", () => {
    for (const set of [root, dark]) {
      for (const name of CHANNEL_TOKENS) {
        expect(resolve(set, name).every((c) => Number.isInteger(c) && c >= 0 && c <= 255), name).toBe(true);
      }
    }
  });

  it.each([
    ["--bg", "#FFFFFF", "#0F1013"],
    ["--surface", "#FFFFFF", "#17191E"],
    ["--surface-2", "#F5F6F8", "#1E2127"],
    ["--ink", "#111318", "#F3F4F6"],
    ["--ink-2", "#5B6170", "#A6ABB8"],
    ["--ink-3", "#8A90A0", "#6E7482"],
    ["--blue", "#2456DB", "#8FB0FF"],
    ["--teal", "#0E7067", "#5FD1C4"],
    ["--amber", "#9A4B00", "#F2B056"],
    ["--green", "#157A3B", "#6FD39A"],
    ["--red", "#D1242F", "#FF7B7B"],
    ["--red-solid", "#E0313C", "#E0313C"],
  ])("%s matches the design notes", (name, light, darkHex) => {
    expect(resolve(root, name).join(" ")).toBe(hex(light));
    expect(resolve(dark, name).join(" ")).toBe(hex(darkHex));
  });

  it.each([
    ["--background", "--bg"],
    ["--foreground", "--ink"],
    ["--card", "--surface"],
    ["--primary", "--blue"],
    ["--primary-foreground", "--on-blue"],
    ["--muted-foreground", "--ink-2"],
    ["--ring", "--blue"],
  ])("shadcn %s follows %s", (alias, source) => {
    for (const set of [root, dark]) expect(resolve(set, alias)).toEqual(resolve(set, source));
  });

  it.each([
    ["--ink", "--bg"],
    ["--ink-2", "--bg"],
    ["--ink-2", "--surface-2"],
    ["--blue", "--bg"],
    ["--teal", "--bg"],
    ["--amber", "--bg"],
    ["--green", "--bg"],
    ["--red", "--bg"],
    ["--primary-foreground", "--primary"],
    ["--destructive-foreground", "--destructive"],
  ])("text %s on %s has contrast >= 4.5 in light and dark", (fg, bg) => {
    for (const set of [root, dark]) expect(contrast(resolve(set, fg), resolve(set, bg))).toBeGreaterThanOrEqual(4.5);
  });
});

/* 每日问候弹窗令牌(计划 2026-10-23-chat-home-daily-greeting-web FR15、W11) */
describe("greeting tokens", () => {
  const GREET = ["--greet-base", "--greet-ink-2", "--greet-em", "--greet-chip", "--greet-chip-bd", "--aur-a", "--aur-b", "--aur-c", "--grain-o"];

  type Rgba = [number, number, number, number];
  type Rgb = [number, number, number];
  const color = (value: string): Rgba => {
    if (value.startsWith("#")) return [...([1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb), 1];
    const n = value.match(/[\d.]+/g)!.map(Number);
    return [n[0], n[1], n[2], n[3] ?? 1];
  };
  const rgb = (value: string): Rgb => color(value).slice(0, 3) as Rgb;
  const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba;
  /** 底色上叠一块极光(色斑是 64px 模糊的大圆,实际很少重叠,所以取单块最浓处)。 */
  const under = (set: Record<string, string>, layer: string): Rgb => rgb(over(color(set[layer]), color(set["--greet-base"])).join(","));

  it.each([[":root", root], [".dark", dark]] as const)("%s defines every greeting token", (_, set) => {
    for (const name of GREET) expect(set, name).toHaveProperty(name);
  });

  it("keeps the base opaque so the chat never shows through", () => {
    for (const set of [root, dark]) expect(color(set["--greet-base"])[3]).toBe(1);
  });

  it.each([["--greet-ink-2"], ["--greet-em"], ["--ink"]])("text %s on every aurora layer has contrast >= 4.5 in light and dark", (name) => {
    for (const set of [root, dark]) {
      const fg = name === "--ink" ? resolve(set, name) : rgb(set[name]);
      for (const layer of ["--aur-a", "--aur-b", "--aur-c"]) expect(contrast(fg, under(set, layer)), `${name} on ${layer}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, rgb(set["--greet-base"]))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps body ink readable even when all three layers overlap", () => {
    for (const set of [root, dark]) {
      const stacked = ["--aur-c", "--aur-b", "--aur-a"].reduce((acc, n) => over(color(set[n]), acc), color(set["--greet-base"]));
      expect(contrast(resolve(set, "--ink"), stacked.slice(0, 3) as Rgb)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
