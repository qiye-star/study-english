# Liquid glass · L3 主题自定义 page (`/me/appearance`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §4.3–§4.4 (hook, schema, presets, swatches), R-LG4/5/7/8/9, and the
> v2 mockup frame "外观与主题" (`themeScreen()`, `bgBlock()`, `presetBtns()`, `SL`, `BGSL` in `liquid-glass-v2/mockup.html`).
> Starts after **L1 and L2** are merged; parallel with L4–L11. **L11 merges after this lane** (its Me row links here).

**Goal:** the 外观与主题 page from spec §6.4 / mockup: live preview (page background + an E1 card + an E2 strip over moving
text), 颜色模式, 预设 清透/磨砂/实色 (+ 自定义 state), 玻璃 sliders (透明度 with 已到可读下限, 模糊, 饱和度), 形状与光影 (圆角
紧凑/标准/圆润 + slider, 边缘高光, 阴影), 背景 per colour mode (8 swatches, custom hue/浓度/亮度 with the AA clamp hint,
optional second colour, style 渐变/颗粒/纯色), 玻璃效果 标准/减弱, 恢复默认 (with a toast). Lazy route; only reachable
while the liquid switch is on. Also wires the toast classes from L2 into `app.tsx`.

**Architecture:** `web/src/pages/appearance/` (pages layer; only `app.tsx` imports it, dynamically): `appearance-page.tsx`
(sections), `glass-slider.tsx` (native range, pill track, 28px thumb, 44px hit, `aria-valuetext`), `background-picker.tsx`,
`preview-card.tsx`, `i18n/{zh-CN,en}.json` (eager-merged by the `../**/i18n/*.json` glob). State is `useGlassTheme()`
(L1); every change goes through the store, which notifies the writer (rAF) and persists 300 ms after the last change, so a
drag repaints live and stores once. Colour mode uses the existing `useSettings().setColorScheme`.

## Global Constraints

- Owned files (INDEX §9): `web/src/pages/appearance/**` (new), `web/src/app.tsx` (route + toaster only; L0's `page-bg`
  edit already merged), `web/src/pages/CLAUDE.md` (one line), `web/src/styles/glass-budget.test.ts` (append one
  `BLUR_OWNERS` line).
- No new dependency; no new `@keyframes`; the preview strip is the page's only own blur layer (page total at rest 2:
  preview strip + tab bar; scrolled 3 with the capsule — INDEX §7).
- Rule 4: the preview strip carries only icons (accent circle icon button, no text).
- Prefs never leave the device; nothing in URLs or logs.
- Worktree `.claude/worktrees/lg-l3`, branch `feat/lg-l3`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts` + `src/i18n/i18n.test.ts`; end: `yarn web:typecheck`.
- Commits: `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L3

- **R-L3-1** Route `/me/appearance`, `back="/me"`; when `useLiquid()` is false (switch off or pinned) it redirects to `/me`.
- **R-L3-2** 透明度 shows `round(tintToSlider(tint))` 0–100 (right = clearer, step 1); the floor hint appears when
  `computeGlassVars(theme, { dark, lite }).floorHit` for the current mode.
- **R-L3-3** Reduced transparency (`matchMedia("(prefers-reduced-transparency: reduce)")`) disables 透明度/模糊/饱和度 and
  shows the note; radius, rim, shadow, background stay active. Low-memory devices show "低端设备自动减弱" and the 模糊 value
  label shows the capped px.
- **R-L3-4** 背景 edits the slot chosen in 正在编辑 (defaults to the current colour mode); the guard hint shows when
  `guardBackground().clampedFrom !== null` (and for the second colour). Swatches are buttons with `aria-pressed` and the
  swatch name as label; colours are inline styles (allowed: they are user data, not design tokens).
- **R-L3-5** Radius segmented shows the matching preset or none; the slider shows `round(26 × v) px`.
- **R-L3-6** 恢复默认 needs no confirm; it shows a toast `已恢复默认主题`.

---

## Task L3-1: strings + `GlassSlider`

**Files:** Create `web/src/pages/appearance/i18n/zh-CN.json`, `web/src/pages/appearance/i18n/en.json`,
`web/src/pages/appearance/glass-slider.tsx`, `web/src/pages/appearance/glass-slider.test.tsx`.

- [ ] **Step 1:** Write `web/src/pages/appearance/i18n/zh-CN.json`:
```json
{
  "web": {
    "appearance": {
      "title": "外观与主题",
      "previewNote": "背景 + 卡片 + 悬浮条预览。底栏与跟读库使用固定样式。",
      "previewCard": "每日目标",
      "previewValue": "15 分钟",
      "previewText": "The view from the top was breathtaking. We took the same trail back down and stopped by the lake for sandwiches. 山顶的景色美得令人窒息。我们原路下山,在湖边吃了三明治。",
      "previewAction": "预览按钮",
      "colorMode": "颜色模式",
      "presets": "预设",
      "preset": { "clear": "清透", "frosted": "磨砂", "solid": "实色", "custom": "自定义" },
      "presetHint": { "clear": "通透 · 强模糊", "frosted": "默认", "solid": "无模糊 · 纯色" },
      "glass": "玻璃",
      "tint": "透明度",
      "tintHint": "右边更透;到可读下限会停住",
      "floor": "已到可读下限",
      "blur": "模糊",
      "saturate": "饱和度",
      "shape": "形状与光影",
      "radius": "圆角",
      "radiusPreset": { "compact": "紧凑", "standard": "标准", "round": "圆润" },
      "rim": "边缘高光",
      "shadow": "阴影",
      "background": "背景",
      "editing": "正在编辑",
      "mode": { "light": "浅色模式", "dark": "深色模式" },
      "custom": "自定义(饱和度上限 30%)",
      "hue": "色相",
      "sat": "浓度",
      "lightness": "亮度",
      "second": "第二颜色(渐变下沿,可选)",
      "secondShort": "第二颜色",
      "secondNone": "无",
      "style": "样式",
      "bgStyle": { "gradient": "渐变", "grain": "颗粒", "solid": "纯色" },
      "clamped": "亮度 {{from}} → {{to}},以保证正文对比度 ≥ 4.5:1",
      "effect": "玻璃效果",
      "effectOption": { "standard": "标准", "reduced": "减弱" },
      "effectHint": "低端设备自动减弱(模糊 ≤ 12px,底色 ≥ 80%)",
      "reducedTransparency": "系统已开启降低透明度:玻璃一律实色,这三个滑块暂不可用",
      "reset": "恢复默认",
      "resetDone": "已恢复默认主题"
    }
  }
}
```
  Write `web/src/pages/appearance/i18n/en.json` with the same keys:
```json
{
  "web": {
    "appearance": {
      "title": "Appearance",
      "previewNote": "Background, card and floating bar preview. The tab bar and the library keep their fixed style.",
      "previewCard": "Daily goal",
      "previewValue": "15 min",
      "previewText": "The view from the top was breathtaking. We took the same trail back down and stopped by the lake for sandwiches. Then we drove home slowly, listening to old songs.",
      "previewAction": "Preview button",
      "colorMode": "Colour mode",
      "presets": "Presets",
      "preset": { "clear": "Clear", "frosted": "Frosted", "solid": "Solid", "custom": "Custom" },
      "presetHint": { "clear": "See-through · strong blur", "frosted": "Default", "solid": "No blur · solid" },
      "glass": "Glass",
      "tint": "Transparency",
      "tintHint": "Further right is clearer; it stops at the readability floor",
      "floor": "Readability floor reached",
      "blur": "Blur",
      "saturate": "Saturation",
      "shape": "Shape and light",
      "radius": "Corners",
      "radiusPreset": { "compact": "Compact", "standard": "Standard", "round": "Round" },
      "rim": "Edge highlight",
      "shadow": "Shadow",
      "background": "Background",
      "editing": "Editing",
      "mode": { "light": "Light mode", "dark": "Dark mode" },
      "custom": "Custom (saturation up to 30%)",
      "hue": "Hue",
      "sat": "Saturation",
      "lightness": "Lightness",
      "second": "Second colour (gradient bottom, optional)",
      "secondShort": "Second colour",
      "secondNone": "None",
      "style": "Style",
      "bgStyle": { "gradient": "Gradient", "grain": "Grain", "solid": "Solid" },
      "clamped": "Lightness {{from}} → {{to}} to keep body text at 4.5:1 or more",
      "effect": "Glass effect",
      "effectOption": { "standard": "Standard", "reduced": "Reduced" },
      "effectHint": "Low-end devices reduce it automatically (blur ≤ 12px, fill ≥ 80%)",
      "reducedTransparency": "Your system asks for reduced transparency: glass is solid and these three sliders are off",
      "reset": "Restore defaults",
      "resetDone": "Default theme restored"
    }
  }
}
```
- [ ] **Step 2 (test):** Write `web/src/pages/appearance/glass-slider.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlassSlider } from "./glass-slider";

describe("GlassSlider (plan 2026-10-15-liquid-glass L3)", () => {
  it("is a labelled native range with units in aria-valuetext and a 44px hit area", () => {
    const onChange = vi.fn();
    render(<GlassSlider id="blur" label="模糊" value={1} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(24 * v)} px`} onChange={onChange} hint="E2" />);
    const input = screen.getByRole("slider", { name: "模糊" });
    expect(input).toHaveAttribute("aria-valuetext", "24 px");
    expect(input.className).toMatch(/\bh-11\b/);
    expect(screen.getByText("24 px")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it("shows a warning hint and can be disabled", () => {
    render(<GlassSlider id="t" label="透明度" value={100} min={0} max={100} step={1} format={String} onChange={() => {}} hint="已到可读下限" warn disabled />);
    expect(screen.getByRole("slider", { name: "透明度" })).toBeDisabled();
    expect(screen.getByText("已到可读下限").className).toContain("text-amber");
  });
});
```
- [ ] **Step 3:** Write `web/src/pages/appearance/glass-slider.tsx`:
```tsx
import { useId } from "react";
import { cn } from "~/lib/cn";

/**
 * 主题自定义的滑块(设计稿 .sl):原生 range、6px 井轨道(已选部分 ink-2)、28px 白色拇指、44px 命中高度;
 * 数值写在右侧(.num)并作为 aria-valuetext。没有新依赖。
 */
export function GlassSlider({ id, label, value, min, max, step, format, onChange, hint, warn = false, disabled = false }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
  hint?: string;
  warn?: boolean;
  disabled?: boolean;
}) {
  const hintId = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between text-sub">
        <label htmlFor={id} className="font-medium text-ink">{label}</label>
        <span aria-hidden className="num text-ink-2">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--p" as string]: `${pct}%` }}
        className={cn(
          "block h-11 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 focus-visible:rounded-full",
          "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full",
          "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,rgb(var(--ink-2))_var(--p),var(--ink-wash-2)_var(--p))]",
          "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-wash-2",
          "[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-ink-2",
          "[&::-webkit-slider-thumb]:-mt-[11px] [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:border-[0.5px] [&::-webkit-slider-thumb]:border-hair-2 [&::-webkit-slider-thumb]:bg-white",
          "[&::-webkit-slider-thumb]:shadow-[0_3px_10px_-2px_rgba(17,19,24,.35)]",
          "[&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[0.5px] [&::-moz-range-thumb]:border-hair-2 [&::-moz-range-thumb]:bg-white",
        )}
      />
      {hint ? <small id={hintId} className={cn("block text-meta", warn ? "text-amber" : "text-ink-2")}>{hint}</small> : null}
    </div>
  );
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/pages/appearance/glass-slider.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts` — green.
- [ ] **Step 5:** Commit `feat(web): appearance strings and glass slider`.

---

## Task L3-2: preview card and background picker

**Files:** Create `web/src/pages/appearance/preview-card.tsx`, `web/src/pages/appearance/background-picker.tsx`,
`web/src/pages/appearance/background-picker.test.tsx`; Modify `web/src/styles/glass-budget.test.ts` (one `BLUR_OWNERS` line).

- [ ] **Step 1:** Write `web/src/pages/appearance/preview-card.tsx`:
```tsx
import { ClockIcon, SparklesIcon, TargetIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * 实时预览(设计稿 .pv):真正的页面背景(page-bg)+ 一张 E1 卡片 + 一条 E2 悬浮条(真实模糊,压在文字上)。
 * 悬浮条只有图标(规则 4)。这一条是本页唯一自己的模糊层(INDEX §7)。
 */
export function PreviewCard() {
  const { t } = useTranslation();
  return (
    <div className="page-bg relative h-[196px] overflow-hidden rounded-inset" data-testid="appearance-preview">
      <p aria-hidden className="absolute inset-x-3 top-2.5 text-sub leading-[1.55] text-ink-2">{t("web.appearance.previewText")}</p>
      <div className="mat-surface absolute inset-x-2.5 top-[58px] flex items-center gap-2.5 rounded-tile px-3.5 py-2.5 text-sub">
        <span aria-hidden className="well flex size-[34px] flex-none items-center justify-center rounded-full"><TargetIcon className="size-5" /></span>
        <span className="flex-1 text-ink">{t("web.appearance.previewCard")}</span>
        <span className="text-ink-2">{t("web.appearance.previewValue")}</span>
        <ChevronRightIcon aria-hidden className="size-[18px] text-ink-3" />
      </div>
      <div aria-hidden className="mat-chrome-bar absolute inset-x-2.5 bottom-2.5 flex h-12 items-center gap-1 rounded-full px-1.5">
        <span className="flex size-10 items-center justify-center text-ink"><ClockIcon className="size-5" /></span>
        <span className="flex size-10 items-center justify-center text-ink"><SparklesIcon className="size-5" /></span>
        <span className="flex-1" />
        <span className="flex size-9 items-center justify-center rounded-full bg-blue text-on-blue shadow-accent"><SparklesIcon className="size-[18px]" /></span>
      </div>
    </div>
  );
}
```
- [ ] **Step 2:** Append to `BLUR_OWNERS` in `web/src/styles/glass-budget.test.ts`:
  `  "pages/appearance/preview-card.tsx": "appearance preview strip (E2, icons only)",`.
- [ ] **Step 3 (test):** Write `web/src/pages/appearance/background-picker.test.tsx`:
```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { renderWithProviders } from "~/test/render";
import { BackgroundPicker } from "./background-picker";

describe("BackgroundPicker (plan 2026-10-15-liquid-glass R-L3-4)", () => {
  beforeEach(async () => { await i18n.changeLanguage("zh-CN"); window.localStorage.removeItem(GLASS_THEME_KEY); resetGlassThemeMemory(); });
  afterEach(async () => { await i18n.changeLanguage("en"); resetGlassThemeMemory(); });

  it("edits the light slot by default and the dark slot after switching", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.click(screen.getByRole("button", { name: "纸白" }));
    expect(getGlassTheme().bg.light.swatch).toBe(3);
    fireEvent.click(screen.getByRole("radio", { name: "深色模式" }));
    fireEvent.click(screen.getByRole("button", { name: "纯黑" }));
    expect(getGlassTheme().bg.dark.swatch).toBe(6);
    expect(getGlassTheme().bg.light.swatch).toBe(3);
  });

  it("shows the AA clamp hint for a custom colour that is too dark for a light page", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.change(screen.getByRole("slider", { name: "亮度" }), { target: { value: "55" } });
    expect(getGlassTheme().bg.light.swatch).toBeNull();
    expect(screen.getByTestId("bg-clamp-hint")).toHaveTextContent("亮度 55 →");
  });

  it("sets the style and an optional second colour", () => {
    renderWithProviders(<BackgroundPicker initialMode="light" />);
    fireEvent.click(screen.getByRole("radio", { name: "颗粒" }));
    expect(getGlassTheme().bgStyle).toBe("grain");
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 雾蓝" }));
    expect(getGlassTheme().bg.light.second).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "第二颜色: 无" }));
    expect(getGlassTheme().bg.light.second).toBeNull();
  });
});
```
- [ ] **Step 4:** Write `web/src/pages/appearance/background-picker.tsx`:
```tsx
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "~/components/segmented-control";
import { cn } from "~/lib/cn";
import { SWATCHES, guardBackground, hslToRgb, type BgStyle, type ColorMode } from "~/lib/glass-theme";
import { useGlassTheme } from "~/settings/glass-theme-store";
import { GlassSlider } from "./glass-slider";

const css = (h: number, s: number, l: number) => `rgb(${hslToRgb(h, s, l).join(", ")})`;

/** 背景(设计稿 bgBlock):每种颜色模式一套 —— 8 个色板、自定义 HSL(饱和度 ≤ 30)、可选第二颜色、样式、可读性提示。 */
export function BackgroundPicker({ initialMode }: { initialMode: ColorMode }) {
  const { t, i18n } = useTranslation();
  const { theme, updateBg, update } = useGlassTheme();
  const [mode, setMode] = useState<ColorMode>(initialMode);
  const pref = theme.bg[mode];
  const guard = guardBackground(pref, mode);
  const zh = i18n.language.startsWith("zh");
  const name = (i: number) => (zh ? SWATCHES[mode][i].zh : SWATCHES[mode][i].en);
  return (
    <div data-testid="appearance-background">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sub font-semibold text-ink-2">{t("web.appearance.background")}</h2>
        <SegmentedControl label={t("web.appearance.editing")} value={mode} onChange={setMode}
          options={[{ value: "light", label: t("web.appearance.mode.light") }, { value: "dark", label: t("web.appearance.mode.dark") }]} />
      </div>
      <div className="grid grid-cols-4 gap-x-2 gap-y-2.5">
        {SWATCHES[mode].map((s, i) => (
          <button key={s.zh} type="button" aria-pressed={pref.swatch === i} aria-label={name(i)} onClick={() => updateBg(mode, { swatch: i })}
            className={cn("flex min-h-tap flex-col items-center gap-1 text-meta", pref.swatch === i ? "font-semibold text-ink" : "text-ink-2")}>
            <i aria-hidden style={{ background: css(s.h, s.s, s.l) }}
              className={cn("block size-11 rounded-full shadow-[inset_0_0_0_1px_var(--hair)]", pref.swatch === i && "ring-2 ring-blue ring-offset-2 ring-offset-surface")} />
            <span aria-hidden>{name(i)}</span>
          </button>
        ))}
      </div>
      <p className="mt-3.5 text-meta text-ink-2">{t("web.appearance.custom")}</p>
      <GlassSlider id={`bg-h-${mode}`} label={t("web.appearance.hue")} value={pref.h} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`}
        onChange={(h) => updateBg(mode, { h })} />
      <GlassSlider id={`bg-s-${mode}`} label={t("web.appearance.sat")} value={pref.s} min={0} max={30} step={1} format={(v) => `${Math.round(v)}%`}
        onChange={(s) => updateBg(mode, { s })} />
      <GlassSlider id={`bg-l-${mode}`} label={t("web.appearance.lightness")} value={pref.l} min={0} max={100} step={1} format={(v) => String(Math.round(v))}
        onChange={(l) => updateBg(mode, { l })} />
      {guard.clampedFrom !== null ? (
        <p data-testid="bg-clamp-hint" role="status" className="mt-1 text-meta text-amber">
          {t("web.appearance.clamped", { from: guard.clampedFrom, to: guard.l })}
        </p>
      ) : null}
      <p className="mb-2 mt-3 text-meta text-ink-2">{t("web.appearance.second")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={pref.second === null} aria-label={`${t("web.appearance.secondShort")}: ${t("web.appearance.secondNone")}`}
          onClick={() => updateBg(mode, { second: null })}
          className={cn("well flex size-11 items-center justify-center rounded-full text-ink-2", pref.second === null && "ring-2 ring-blue")}>
          {pref.second === null ? <CheckIcon aria-hidden className="size-4" /> : null}
        </button>
        {SWATCHES[mode].map((s, i) => (
          <button key={s.zh} type="button" aria-pressed={pref.second === i} aria-label={`${t("web.appearance.secondShort")}: ${name(i)}`}
            onClick={() => updateBg(mode, { second: i })}
            style={{ background: css(s.h, s.s, s.l) }}
            className={cn("size-[30px] rounded-full shadow-[inset_0_0_0_1px_var(--hair)]", pref.second === i && "ring-2 ring-blue ring-offset-2 ring-offset-surface")} />
        ))}
      </div>
      <p className="mb-2 mt-3.5 text-meta text-ink-2">{t("web.appearance.style")}</p>
      <SegmentedControl label={t("web.appearance.style")} value={theme.bgStyle} onChange={(bgStyle: BgStyle) => update({ bgStyle })}
        options={(["gradient", "grain", "solid"] as const).map((v) => ({ value: v, label: t(`web.appearance.bgStyle.${v}`) }))} />
    </div>
  );
}
```
  Note: the second-colour buttons are named `第二颜色: <name>` / `Second colour: <name>` (`secondShort`). The second colour
  is a swatch, which always passes the guard, so no second hint is shown (`secondClampedFrom` stays available for later).
- [ ] **Step 5:** Run `cd web && yarn vitest run src/pages/appearance src/styles/glass-budget.test.ts src/architecture.test.ts` — green.
- [ ] **Step 6:** Commit `feat(web): appearance preview and background picker`.

---

## Task L3-3: the page

**Files:** Create `web/src/pages/appearance/appearance-page.tsx`, `web/src/pages/appearance/appearance-page.test.tsx`.

- [ ] **Step 1 (test):** Write `web/src/pages/appearance/appearance-page.test.tsx`:
```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { GLASS_DEFAULTS } from "~/lib/glass-theme";
import { GLASS_THEME_KEY } from "~/lib/storage";
import { getGlassTheme, resetGlassThemeMemory } from "~/settings/glass-theme-store";
import { blurLayers, setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { AppearancePage } from "./appearance-page";

describe("AppearancePage (plan 2026-10-15-liquid-glass L3)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    window.localStorage.removeItem(GLASS_THEME_KEY);
    resetGlassThemeMemory();
    setLiquid(true);
  });
  afterEach(async () => { setLiquid(false); await i18n.changeLanguage("en"); resetGlassThemeMemory(); });

  it("redirects to Me when the liquid skin is off", () => {
    setLiquid(false);
    renderWithProviders(<AppearancePage />, { route: "/me/appearance", path: "/me/appearance" });
    expect(screen.getByTestId("location")).toHaveTextContent("/me");
  });

  it("renders every section with one own blur layer (the preview strip)", () => {
    const { container } = renderWithProviders(<AppearancePage />);
    for (const name of ["颜色模式", "预设", "玻璃", "形状与光影", "背景", "玻璃效果"]) expect(screen.getByText(name)).toBeInTheDocument();
    expect(blurLayers(container).length).toBeLessThanOrEqual(2);
  });

  it("presets: 实色 sets solid values and the solid background; a slider move makes it custom", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.click(screen.getByRole("button", { name: /实色/ }));
    expect(getGlassTheme()).toMatchObject({ preset: "solid", blur: 0, bgStyle: "solid" });
    fireEvent.change(screen.getByRole("slider", { name: "模糊" }), { target: { value: "1" } });
    expect(getGlassTheme().preset).toBe("custom");
    expect(screen.getByTestId("appearance-preset-name")).toHaveTextContent("自定义");
  });

  it("shows the readability floor at full transparency", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.change(screen.getByRole("slider", { name: "透明度" }), { target: { value: "100" } });
    expect(getGlassTheme().tint).toBeCloseTo(0.55);
    expect(screen.getByText("已到可读下限")).toBeInTheDocument();
  });

  it("radius presets and slider, 减弱, reset", () => {
    renderWithProviders(<AppearancePage />);
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(getGlassTheme().radius).toBe(0.6);
    expect(screen.getByRole("button", { name: "紧凑" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("slider", { name: "圆角" }), { target: { value: "0.8" } });
    expect(screen.getByRole("button", { name: "紧凑" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(screen.getByRole("slider", { name: "圆角" })).toHaveAttribute("aria-valuetext", "16 px");
    fireEvent.click(screen.getByRole("radio", { name: "减弱" }));
    expect(getGlassTheme().reduced).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(getGlassTheme()).toEqual(GLASS_DEFAULTS);
  });
});
```
- [ ] **Step 2:** Write `web/src/pages/appearance/appearance-page.tsx`:
```tsx
import { InfoIcon, RotateCcwIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { LQ_SECONDARY } from "~/components/liquid";
import { SegmentedControl } from "~/components/segmented-control";
import { SurfaceCard } from "~/components/surface-card";
import { useIsDark } from "~/layout/color-scheme";
import { isLowMemory } from "~/layout/glass-quality";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { useLiquid } from "~/lib/glass-flag";
import { RADIUS_PRESETS, computeGlassVars, sliderToTint, tintToSlider, type GlassPreset } from "~/lib/glass-theme";
import { COLOR_SCHEMES, type ColorScheme } from "~/settings/color-scheme-pref";
import { useGlassTheme } from "~/settings/glass-theme-store";
import { useSettings } from "~/settings/settings-context";
import { BackgroundPicker } from "./background-picker";
import { GlassSlider } from "./glass-slider";
import { PreviewCard } from "./preview-card";

/** 预设缩略图(设计稿 .preset .pw):条纹上的一块「玻璃」,用不透明度示意,不模糊(blur 预算与源码守卫) */
const PRESET_SWATCH: Record<Exclude<GlassPreset, "custom">, string> = {
  clear: "bg-white/20",
  frosted: "bg-white/60",
  solid: "bg-surface",
};
const reducedTransparency = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches;

/** 我的 → 外观与主题(spec §6.4,设计稿 themeScreen;计划 2026-10-15-liquid-glass L3)。只在液态皮肤下可达。 */
export function AppearancePage() {
  const { t } = useTranslation();
  const liquid = useLiquid();
  const dark = useIsDark();
  const { colorScheme, setColorScheme } = useSettings();
  const { theme, update, applyPreset, reset } = useGlassTheme();
  const lowMemory = isLowMemory();
  const lite = lowMemory || theme.reduced;
  const computed = useMemo(() => computeGlassVars(theme, { dark, lite }), [theme, dark, lite]);
  const rt = reducedTransparency();
  if (!liquid) return <Navigate to="/me" replace />;
  const radiusPreset = (Object.keys(RADIUS_PRESETS) as (keyof typeof RADIUS_PRESETS)[]).find((k) => RADIUS_PRESETS[k] === theme.radius) ?? "";
  const section = "mt-4 p-4";
  const title = "mb-3 flex items-center justify-between text-sub font-semibold text-ink-2";
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.appearance.title")} back="/me" />
      <div className="px-frame pb-8">
        <SurfaceCard strong className="mt-2 p-4">
          <PreviewCard />
          <p className="mt-2.5 text-meta text-ink-2">{t("web.appearance.previewNote")}</p>
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.colorMode")}</h2>
          <SegmentedControl label={t("web.appearance.colorMode")} value={colorScheme} onChange={(v: ColorScheme) => setColorScheme(v)}
            className="w-full" optionClassName="flex-1"
            options={COLOR_SCHEMES.map((s) => ({ value: s, label: t(`web.me.colorSchemeOptions.${s}`) }))} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>
            {t("web.appearance.presets")}
            <span data-testid="appearance-preset-name" className="font-medium">{t(`web.appearance.preset.${theme.preset}`)}</span>
          </h2>
          <div className="grid grid-cols-3 gap-2.5">
            {(["clear", "frosted", "solid"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={theme.preset === p} onClick={() => applyPreset(p)}
                className={cn("well flex min-h-tap flex-col items-center gap-1.5 rounded-tile px-2 pb-2.5 pt-2 text-sub font-semibold text-ink",
                  theme.preset === p && "shadow-[inset_0_0_0_2px_rgb(var(--blue))]")}>
                <span aria-hidden className="relative block h-[50px] w-full overflow-hidden rounded-[calc(var(--gx-radius,1)*22px-8px)] bg-[repeating-linear-gradient(135deg,rgb(var(--ink-3))_0_6px,transparent_6px_14px)]">
                  <i className={cn("absolute inset-x-2.5 inset-y-[11px] rounded-[10px] border border-white/80", PRESET_SWATCH[p])} />
                </span>
                {t(`web.appearance.preset.${p}`)}
                <small className="text-label font-normal text-ink-2">{t(`web.appearance.presetHint.${p}`)}</small>
              </button>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.glass")}</h2>
          {rt ? (
            <p role="note" className="mb-1.5 flex gap-1.5 text-meta text-amber"><InfoIcon aria-hidden className="size-4 flex-none" />{t("web.appearance.reducedTransparency")}</p>
          ) : null}
          <GlassSlider id="glass-tint" label={t("web.appearance.tint")} value={Math.round(tintToSlider(theme.tint))} min={0} max={100} step={1}
            format={(v) => String(Math.round(v))} disabled={rt}
            onChange={(v) => update({ tint: sliderToTint(v) })}
            hint={computed.floorHit ? t("web.appearance.floor") : t("web.appearance.tintHint")} warn={computed.floorHit} />
          <GlassSlider id="glass-blur" label={t("web.appearance.blur")} value={theme.blur} min={0} max={1.5} step={0.05} disabled={rt}
            format={() => `${computed.blurPx.chrome} px`} onChange={(blur) => update({ blur })}
            hint={lite ? t("web.appearance.effectHint") : undefined} />
          <GlassSlider id="glass-saturate" label={t("web.appearance.saturate")} value={theme.saturate} min={1} max={2} step={0.05} disabled={rt}
            format={(v) => v.toFixed(2)} onChange={(saturate) => update({ saturate })} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.shape")}</h2>
          {/* 不用 SegmentedControl:它在值不匹配时会把第一段标成选中;滑块调到非预设值时三颗都不选中 */}
          <div role="group" aria-label={t("web.appearance.radius")} className="well mb-1 grid grid-cols-3 gap-0.5 rounded-full p-[3px]">
            {(["compact", "standard", "round"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={radiusPreset === k} onClick={() => update({ radius: RADIUS_PRESETS[k] })}
                className={cn("hit-expand h-8 rounded-full text-sub", radiusPreset === k ? "bg-surface font-semibold text-blue shadow-[0_2px_8px_-3px_rgba(17,19,24,.25)] dark:bg-white/[.16]" : "font-medium text-ink-2")}>
                {t(`web.appearance.radiusPreset.${k}`)}
              </button>
            ))}
          </div>
          <GlassSlider id="glass-radius" label={t("web.appearance.radius")} value={theme.radius} min={0.5} max={1.3} step={0.05}
            format={(v) => `${Math.round(26 * v)} px`} onChange={(radius) => update({ radius })} />
          <GlassSlider id="glass-rim" label={t("web.appearance.rim")} value={theme.rim} min={0} max={1.5} step={0.05}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(rim) => update({ rim })} />
          <GlassSlider id="glass-shadow" label={t("web.appearance.shadow")} value={theme.shadow} min={0} max={1.5} step={0.05}
            format={(v) => `${Math.round(v * 100)}%`} onChange={(shadow) => update({ shadow })} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <BackgroundPicker initialMode={dark ? "dark" : "light"} />
        </SurfaceCard>

        <SurfaceCard className={section}>
          <h2 className={title}>{t("web.appearance.effect")}</h2>
          <SegmentedControl label={t("web.appearance.effect")} value={theme.reduced ? "reduced" : "standard"} className="w-full" optionClassName="flex-1"
            onChange={(v) => update({ reduced: v === "reduced" })}
            options={(["standard", "reduced"] as const).map((v) => ({ value: v, label: t(`web.appearance.effectOption.${v}`) }))} />
          <p className="mt-2 text-meta text-ink-2">{t("web.appearance.effectHint")}</p>
        </SurfaceCard>

        <div className="mt-6 text-center">
          <button type="button" onClick={() => { reset(); toast.success(t("web.appearance.resetDone")); }}
            className={cn("inline-flex h-12 items-center gap-2 px-6 text-body font-semibold", LQ_SECONDARY)}>
            <RotateCcwIcon aria-hidden className="size-[18px]" />{t("web.appearance.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
```
  Notes for the implementer: (a) the radius presets are three `aria-pressed` buttons, not `SegmentedControl` (which marks
  index 0 checked when the value matches nothing); (b) no Tailwind `backdrop-*` class anywhere on this page (source guard).
- [ ] **Step 3:** Run `cd web && yarn vitest run src/pages/appearance src/styles/glass-budget.test.ts src/i18n/i18n.test.ts src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): appearance and theme page`.

---

## Task L3-4: route, toaster, docs

**Files:** Modify `web/src/app.tsx`, `web/src/pages/CLAUDE.md`.

- [ ] **Step 1:** Edit `web/src/app.tsx`:
  1. Single line `import type { CSSProperties } from "react";` → `import { lazy, Suspense, type CSSProperties } from "react";`.
  2. Single line `import { SettingsProvider } from "~/settings/settings-context";` → that line and:
```tsx
import { TOAST_CLASSNAMES } from "~/components/toast-classes";

/** 外观与主题(计划 2026-10-15-liquid-glass L3):懒加载,不进主包;液态开关关闭时页面自己跳回 /me。 */
const AppearancePage = lazy(() => import("~/pages/appearance/appearance-page").then((m) => ({ default: m.AppearancePage })));
```
  3. Single line `            <Route path="/me/agents/memory" element={<MemoryPage />} />` → that line +
     `            <Route path="/me/appearance" element={<Suspense fallback={null}><AppearancePage /></Suspense>} />`.
  4. Replace the `toastOptions={{ … }}` object: the block from the single line `        classNames: {` through its closing
     `        },` (8 lines; Read first) becomes `        classNames: TOAST_CLASSNAMES,` (values are byte-identical for the classic skin).
- [ ] **Step 2:** `web/src/pages/CLAUDE.md`: add `` - `appearance/` — 外观与主题 (`/me/appearance`, lazy from `app.tsx`; liquid only; plan `2026-10-15-liquid-glass` L3): sliders, presets, background picker, all through `useGlassTheme()`. ``
- [ ] **Step 3:** Run `cd web && yarn vitest run src/layout/color-scheme-sync.test.tsx src/layout src/pages src/build src/architecture.test.ts && cd .. && yarn web:typecheck` — green
  (`color-scheme-sync.test.tsx` reads `app.tsx` for `<SettingsProvider>\s*<ColorSchemeSync />`, unchanged).
- [ ] **Step 4:** Commit `feat(web): route the appearance page and use shared toast classes`.

## Device / visual checklist (UNVERIFIED until the owner checks)

- [ ] Dragging 透明度 / 模糊 at 390px on a mid Android: no visible jank in the preview strip and the capsule.
- [ ] The 已到可读下限 hint appears at the far right in light mode (dark T1 floor .04 is reached later).
- [ ] Native range thumb look on iOS Safari (webkit pseudo-elements) and Firefox Android (moz pseudo-elements).
- [ ] A custom dark colour in the light slot is lifted to L ≈ 91 with the hint; the page stays readable outdoors.
