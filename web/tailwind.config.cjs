const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ENJOY_CONFIG = path.resolve(__dirname, "../enjoy/tailwind.config.js");
const webRequire = createRequire(__filename);
const noopPlugin = webRequire("tailwindcss/plugin")(() => {});

function loadEnjoyConfig() {
  const source = fs.readFileSync(ENJOY_CONFIG, "utf8");
  const mod = { exports: {} };
  const requireFromWeb = (id) => (id === "@vidstack/react/tailwind.cjs" ? noopPlugin : webRequire(id));
  new Function("module", "exports", "require", source)(mod, mod.exports, requireFromWeb);
  return mod.exports;
}

const enjoy = loadEnjoyConfig();
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const pair = (name) => ({ DEFAULT: rgb(name), foreground: rgb(`${name}-foreground`) });

/*
 * Redesign v3 令牌(web/src/styles/theme.css)。用法示例:
 *   bg-background text-ink | text-ink-2 | bg-surface-2 | bg-blue text-on-blue | bg-blue-tint text-blue
 *   shadow-hair-b(顶栏发丝线)| rounded-card | text-body | text-meta | tracking-heading | min-h-tap
 *   duration-fast ease-standard | motion-safe:animate-breathe
 * blue/teal/amber/green/red 与 tailwind 默认色板合并:bg-blue-500 仍是默认色,bg-blue 是令牌。
 */
const colors = {
  border: rgb("border"),
  input: rgb("input"),
  ring: rgb("ring"),
  "active-word": rgb("active-word"),
  background: rgb("background"),
  foreground: rgb("foreground"),
  primary: pair("primary"),
  secondary: pair("secondary"),
  destructive: pair("destructive"),
  muted: pair("muted"),
  accent: pair("accent"),
  popover: pair("popover"),
  card: pair("card"),

  surface: { DEFAULT: rgb("surface"), 2: rgb("surface-2") },
  ink: { DEFAULT: rgb("ink"), 2: rgb("ink-2"), 3: rgb("ink-3") },
  "on-blue": rgb("on-blue"),
  hair: { DEFAULT: "var(--hair)", 2: "var(--hair-2)" },
  key: "var(--key)",
  seg: { track: "var(--seg-track)", on: "var(--seg-on)" },
  blue: { DEFAULT: rgb("blue"), tint: "var(--blue-tint)", wash: "var(--blue-wash)" },
  teal: { DEFAULT: rgb("teal"), tint: "var(--teal-tint)" },
  amber: { DEFAULT: rgb("amber"), tint: "var(--amber-tint)" },
  green: { DEFAULT: rgb("green"), tint: "var(--green-tint)" },
  red: { DEFAULT: rgb("red"), tint: "var(--red-tint)", solid: rgb("red-solid") },
};

const SYSTEM_SANS = [
  "-apple-system",
  "BlinkMacSystemFont",
  '"SF Pro Text"',
  '"PingFang SC"',
  '"Helvetica Neue"',
  "Inter",
  '"Noto Sans SC"',
  '"Microsoft YaHei"',
  "sans-serif",
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...enjoy,
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../enjoy/src/renderer/components/ui/**/*.tsx",
    "../enjoy/src/renderer/components/pronunciation-assessments/**/*.tsx",
    "../enjoy/src/renderer/components/misc/wavesurfer-player.tsx",
  ],
  theme: {
    ...enjoy.theme,
    extend: {
      ...enjoy.theme.extend,
      colors,
      fontFamily: { ...enjoy.theme.extend.fontFamily, sans: SYSTEM_SANS },
      // 类型刻度:label 11 标签/眉标、meta 12 元信息、sub 13 次要、15 正文、17 栏标题、22 用户名、28 统计数、34 头像字母
      fontSize: {
        ...enjoy.theme.extend.fontSize,
        label: ["11px", { lineHeight: "1.2" }],
        meta: ["12px", { lineHeight: "1.4" }],
        sub: ["13px", { lineHeight: "1.45" }],
        body: ["15px", { lineHeight: "1.4" }],
        title: ["17px", { lineHeight: "1.3", letterSpacing: "-0.015em" }],
        headline: ["22px", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        stat: ["28px", { lineHeight: "1", letterSpacing: "-0.03em" }],
        hero: ["34px", { lineHeight: "1", letterSpacing: "-0.03em" }],
      },
      letterSpacing: { heading: "-0.015em", numeral: "-0.02em", tightest: "-0.03em", eyebrow: "0.06em" },
      lineHeight: { body: "1.4", dialogue: "1.5" },
      // 圆角:6 行内/周格、10 徽章/分段、12 按钮、14 卡片/气泡/列表、20 底部弹层、28 通话控制台
      borderRadius: {
        ...enjoy.theme.extend.borderRadius,
        inline: "6px",
        badge: "10px",
        button: "12px",
        card: "14px",
        sheet: "20px",
        dock: "28px",
      },
      // 4pt 栅格沿用 tailwind 默认;tap = 44 触控目标、row = 56 列表行、gutter = 16 页边距、section = 22 分组标题前
      spacing: { tap: "44px", row: "56px", gutter: "16px", section: "22px", key: "52px" },
      boxShadow: {
        "hair-b": "inset 0 -0.5px 0 var(--hair)",
        "hair-t": "inset 0 0.5px 0 var(--hair)",
        hair: "inset 0 0 0 0.5px var(--hair)",
        card: "0 1px 2px rgba(17, 19, 24, 0.03)",
        seg: "0 1px 2px rgba(17, 19, 24, 0.08)",
      },
      transitionDuration: { fast: "150ms", base: "200ms" },
      transitionTimingFunction: { standard: "cubic-bezier(0.2, 0, 0, 1)" },
      // 只配合 motion-safe: 使用(prefers-reduced-motion:no-preference)
      keyframes: {
        ...enjoy.theme.extend.keyframes,
        breathe: { "0%": { transform: "scale(.92)", opacity: ".45" }, "100%": { transform: "scale(1.08)", opacity: "0" } },
        "ptt-ring": { "0%": { transform: "scale(1)", opacity: ".45" }, "100%": { transform: "scale(1.25)", opacity: "0" } },
        wave: { to: { height: "4px" } },
        caret: { to: { opacity: "0" } },
      },
      animation: {
        ...enjoy.theme.extend.animation,
        breathe: "breathe 2.4s ease-out infinite",
        "ptt-ring": "ptt-ring 1.2s ease-out infinite",
        wave: "wave 1.1s ease-in-out infinite alternate",
        caret: "caret 1s steps(2) infinite",
      },
    },
  },
};
