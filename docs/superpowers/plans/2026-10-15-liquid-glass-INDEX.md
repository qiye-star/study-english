# Liquid glass (app-wide, web PWA) · plan set INDEX

- Date: 2026-10-15 · Status: documents only, no product code, nothing committed.
- Spec (APPROVED, Rev 3 + Rev 4): `docs/superpowers/specs/2026-10-15-liquid-glass-overall-design-proposal.md`.
- Visual source of truth: `docs/superpowers/design/liquid-glass-v2/mockup.html` + `picks.md` (v2 FINAL). The model code
  (`hsl`, `guardColor`, `mat()`, `SW`, `BASE/FLOOR/CEIL`, `PRESETS`) is byte-identical in v1 and v2 (diffed while writing).
  Mockup class names are referenced throughout: `.m1` / `.m1.strong` / `.m2` / `.m2.capbar` / `.m3` / `.well` / `.plate` /
  `.fabp` / `.pill.acc|.gh|.pl|.red|.sm` / `.chip|.chip.ol` / `.dot.g|.a|.acc` / `.iw` / `.av` / `.seg` / `.inp` / `.field` /
  `.empty` / `.banner` / `.toast` / `.dialog` / `.sheet` / `.lr` / `.grpl` / `.ptitle` / `.lt .large .ltsub` / `.capsule` /
  `.composer .hint2 .hold` / `.dock` / `.opt.ok|.bad` / `.band` / `.rankbar` / `.week` / `.wells .wl` / `.pair .half`.
- This file is the **only arbiter** between the lane plans. §4–§9 names, shapes and signatures are FROZEN: change this file
  first, then tell every lane.
- Code read while writing (read-only): `web/src/{index.css,main.tsx,app.tsx,architecture.test.ts}`, `web/tailwind.config.cjs`,
  `web/src/styles/*`, `web/src/components/*` (all), `web/src/layout/{app-shell,page-header,glass-quality,color-scheme}.ts(x)`,
  `web/src/lib/{storage,cn}.ts`, `web/src/auth/device-data.ts`, `web/src/settings/*`, `web/src/pages/me-page.tsx`,
  `web/src/features/practice/practice-page.tsx`, `features/chat/{conversations-page,conversation-page}.tsx`,
  `features/wordbook/{home-page,ui}.tsx`, every `ui.ts` button file, `web/scripts/main-bundle*.mjs`, plus a grep inventory of
  every hue class and every class-asserting test (numbers in §11). **No test, build or browser run was made.** All code in the
  lane plans is "read the code, infer"; on the first run, fix test data to match reality, never the rulings or names.

## 1. Lanes

| Lane | Plan | Scope (one line) | Parallel with | Model hint |
|---|---|---|---|---|
| **L0** foundation | `2026-10-15-liquid-glass-l0-foundation.md` | `data-glass` switch + route pins, tokens, `liquid:` variant, materials/plate/page-bg CSS, budget + locked-pages guards, test helpers | — (first, serial) | strong for CSS; tests are transcription |
| **L1** theme engine | `2026-10-15-liquid-glass-l1-theme-engine.md` | pure model (`lib/glass-theme.ts`), store + `useGlassTheme()`, CSS-variable writer, contrast guard, logout cleanup | L2 | strong (math) |
| **L2** shared components | `2026-10-15-liquid-glass-l2-shared.md` | `components/liquid.ts` constants; SurfaceCard, SectionGroup/ListRow, LIST_CARD, StatTile, IconButton, IconChip, ToneBadge(+dot), Avatar, SegmentedControl, GlassTopBar capsule, PageHeader large title, BottomSheet T3, banner, maintenance, hold-to-talk, EmptyState, ScoreDot, toast classes | L1 | medium |
| **L3** 主题自定义 page | `2026-10-15-liquid-glass-l3-appearance.md` | `/me/appearance` lazy page: preview, colour mode, presets, sliders, background picker, lite, reset; route + toaster wiring in `app.tsx` | L4–L11 | medium |
| **L4** practice | `…-l4-practice.md` | practice home new layout (studio hero / 今日 / 最近评分 / 清单), list, history, assessment | L3, L5–L11 | medium |
| **L5** chat | `…-l5-chat.md` | chat list new layout + 新对话 `mat-float`; conversation restyle (graphite bubbles, floating composer, plates); chat sheets; grammar | L3, L4, L6–L11 | strong (composer geometry) |
| **L6** agents + realtime | `…-l6-agents-realtime.md` | agents (persona/memory/tutor/process/chat-parts) tint removal; realtime call screen (sheen, dock `mat-float`, keys) | others | medium |
| **L7** rooms | `…-l7-rooms.md` | lobby, create sheet, room page (bubbles, composer, assist dock = E1), voice, extras | others | medium |
| **L8** rank | `…-l8-rank.md` | rank card/home/match/achievements mono | others | low |
| **L9** wordbook | `…-l9-wordbook.md` | home new layout (今天 hero, ink band), quiz states (`.opt.ok/.bad`), dock, spell, books, learned, snapshot | others | strong (quiz legibility) |
| **L10** vocabulary + progress + plugins | `…-l10-vocab-progress-plugins.md` | review card, list, chart ink + accent, plugin rows/chips | others | low |
| **L11** me + login + install | `…-l11-me-login.md` | Me new layout (profile hero + wells, rank row, 4 groups, 外观与主题 row), login/install | others (needs L3 merged before L11 merges) | medium |
| **L12** final switch | `…-l12-final.md` | skin ON for everyone (one revertable commit), dev switch removed (`data-glass` stays for pins), central colour guard, docs, device checklist, results, bundle note (owner OK) | — (last, serial) | medium |
| **Z** controller | §13 here | changelog draft after deploy + owner check | — | — |

## 2. Merge order (authoritative)

```
L0 ──► L1 ─┐
   └──► L2 ─┴──► (L3 ∥ L4 ∥ L5 ∥ L6 ∥ L7 ∥ L8 ∥ L9 ∥ L10 ∥ L11) ──► L12 ──► Z
```

| Later | Must wait for | Why |
|---|---|---|
| L1, L2 | L0 merged | variant, tokens, `lib/glass-flag.ts`, `test/glass.ts`, `main.tsx` init line |
| L3 | L1 + L2 merged | store/hook + SegmentedControl/SurfaceCard/liquid constants |
| L4–L10 | L2 merged | `components/liquid.ts`, PageHeader `large`, BottomSheet T3, ScoreDot, EmptyState |
| L11 **start** | L2 merged; L11 **merge** after L3 merged | the Me row links to `/me/appearance` (route added by L3) |
| L12 | every lane merged and the owner reviewed on a device with `?glass=v2` | one commit flips the default |
| Z | L12 merged, deployed (only when the owner asks), owner checked | §13 |

- Each lane runs in its own worktree under `.claude/worktrees/<lane>` on branch `feat/lg-<lane>` from the current
  `feat/self-hosted-backend`. **Junction `node_modules`** (root and `web/`) from the main checkout instead of installing
  (root `CLAUDE.md`): `cmd /c mklink /J node_modules ..\..\..\node_modules` and the same for `web\node_modules`.
- Rebase a lane on the integration branch before merging; resolve conflicts only in files the lane owns (§9).
- While L0–L11 merge, production users see **no change** (switch off by default, §4.1). The owner previews with
  `https://<host>/practice?glass=v2` on their phone (persists in that browser) and turns it off with `?glass=off`.

## 3. Rulings (R-LG*)

- **R-LG1 Additive skin.** In-scope code never deletes or prefixes the classic classes. It **appends** `liquid:` utilities
  (Tailwind variant, §4.2) and/or **self-gated** material classes (`mat-*`, `well`, `plate`, `page-bg`; their CSS only exists
  under `html[data-glass="v2"]`, §5). With the switch off (or on a pinned route) the DOM classes still contain the new
  tokens, but no new rule matches, so the classic look is pixel-identical and every existing class-asserting test stays green.
  When one element can receive two `liquid:` utilities of the same group (e.g. a base `liquid:bg-wash` and a state
  `liquid:bg-blue`), join them with `cn()` (tailwind-merge keeps the last one per modifier); never rely on CSS order between
  two `liquid:` utilities of the same property.
- **R-LG2 Structure changes are JS-gated.** Where the layout itself changes (practice home, chat list, wordbook home, Me,
  GlassTopBar capsule, PageHeader large title, BottomSheetContent T3, SectionGroup panel, conversation subtitle), the code
  branches on `useLiquid()` (§4.1). The classic branch stays byte-identical until L12 deletes it. All `data-testid`s,
  roles and accessible names are identical in both branches.
- **R-LG3 Locked areas.** `features/library/**`, `features/practice/shadow/**`, `features/lookup/**`,
  `features/changelog/**`, `components/glass-tab-bar.tsx`, `layout/bottom-nav.tsx`, `components/{score-tone.ts,tone.ts,zh-toggle.tsx}`
  are never edited. Locked routes `/library`, `/library/:id`, `/practice/changelog` set `data-glass="pin"` (classic skin for
  the shared components they import). The lookup drawer keeps the `glass` branch of `BottomSheetContent` byte-identical.
  Guarded by `styles/locked-pages.test.ts` (L0) — see §8.
- **R-LG4 Frozen pieces ignore sliders.** The tab bar, lookup bar/drawer and library never read `--mat-*`, `--gx-*`,
  `--page-*`. At default settings (磨砂, default background) they look consistent with the new skin (same rim/radius family).
- **R-LG5 Rule 4 (HARD).** A blurred layer (`mat-chrome`, `mat-chrome-bar`, `mat-sheet`) carries directly only a title
  (≥ 17px, ≥ 600, marked `data-glass-title`) and icons (≥ 20px). Every other text sits on a `.plate` (fixed fill
  `--plate` = .90, not driven by the transparency slider). `mat-sheet` paints its own plate (8px glass bezel, §5.3), so
  sheet/dialog content is compliant by construction. Text-heavy floating things do **not** blur: toast = plate pill,
  announcement banner = `mat-surface` panel, 新对话 = `mat-float`, realtime call dock = `mat-float` (deviation, §12 D-3).
  Guarded by `textOutsidePlates()` assertions (L0 helper) in the lanes that own a blurred layer.
- **R-LG6 Blur budget.** ≤ 3 resident `backdrop-filter` layers visible at once (typically capsule + composer/dock + tab bar)
  plus ≤ 1 transient (sheet/dialog or lookup). Never on list rows, cards, bubbles, chips. Only `.glass*` (existing) and
  `.mat-chrome`, `.mat-chrome-bar`, `.mat-sheet` may declare `backdrop-filter` (CSS guard), and only files in the
  `BLUR_OWNERS` allowlist may use those classes (source guard, §8). Page tests assert `blurLayers() ≤ 2` (tab bar is +1).
- **R-LG7 Accessibility floors & overrides** (§6.1 of the spec): floors T1 .50/.04, T2 .55/.50, bar .62/.58, T3 .62/.58,
  +.20 when blur < 8px, ≥ .80 under `html.lite`; ceiling .94 (T1 dark .20). `html.lite` caps blur at 12px (writer);
  `prefers-reduced-transparency: reduce` forces solid `--surface` + hairline and no blur in CSS, regardless of sliders.
  Dark capsule title worst case ≈ 3.8:1 is accepted for ≥ 17px titles (Rev 4).
- **R-LG8 Background per colour mode.** Light and dark each keep their own background (swatch or custom HSL, optional
  second colour = a swatch of the same mode). Style (渐变/颗粒/纯色) is global. The contrast guard keeps the slot's own ink
  side (light slot → dark ink, dark slot → light ink) and clamps lightness until `--ink-2` ≥ 4.5:1 on the worse gradient end
  (deviation from the mockup's "auto ink side", §12 D-1). Saturation cap 30.
- **R-LG9 Device-local prefs.** Stored at `enjoy-web.appearance.glass` (§4.4), applied as inline CSS variables on
  `<html>` before first render (`main.tsx`), removed at logout by `clearDeviceData()`; never sent to the server.
- **R-LG10 Accent & colour.** Cobalt `--blue` only: one filled primary pill per screen, active/selected text, switch-on,
  progress toward a goal, unread dot, links. Teal identity dropped (ink scale). Own chat bubbles graphite. Green/amber only
  as 6px dots / 16px icons; red only for error text, destructive text buttons, hang-up key and the wordbook reset confirm.
- **R-LG11 No new dependencies, fonts, images.** Glare/spotlight/count-up picks are optional polish and **not** in these
  plans (only the native-range slider and grain data-URI are). Lazy route for the appearance page.
- **R-LG12 Tests.** `architecture.test.ts` is never loosened. Existing locked CSS tests (`library-css`, `shadow-css`,
  `glass-lookup`, `floating-tab-bar`, `changelog-css`, `viewport-lock`, `theme`) must pass unchanged. Class-asserting tests
  keep passing because of R-LG1 (they use `toContain`/`toMatch`/`toHaveClass`, never whole-string equality — checked);
  lanes **add** liquid assertions with `setLiquid(true)`. The only snapshot (`wordbook/__snapshots__/word-card-legacy.test.tsx.snap`)
  serialises class strings, so it is regenerated deliberately — only added tokens may appear in the diff — by L2 (Task L2-9),
  then by L9, then by L12. **Negative substring assertions** (e.g. `not.toMatch(/rounded-full/)`, `/\bbg-surface\b/`,
  innerHTML `not /text-red|bg-red/`) can be tripped by an appended `liquid:` token because `\b` matches after `:`. The
  owning lane then narrows the regex to classic tokens with a lookbehind, e.g. `/(?<![\w:-])rounded-full/`, keeping the
  test's intent; it never deletes the assertion. Each lane plan lists the ones in its area.

## 4. FROZEN: switch, variant, hook

### 4.1 `web/src/lib/glass-flag.ts` (L0)

```ts
export const GLASS_ATTR = "data-glass";                 // on <html>: "v2" | "pin" | absent
export const GLASS_FLAG_KEY = "enjoy-web.dev.glass";    // dev switch, localStorage value "v2"; REMOVED in L12
export const PINNED_PATH_PREFIXES = ["/library", "/practice/changelog"] as const;
export function readGlassFlag(win?: Window): boolean;   // ?glass=v2 → store "v2"; ?glass=off → remove; then read
export function initGlassFlag(win?: Window): boolean;   // main.tsx, before render; sets/removes data-glass="v2"
export function isPinnedPath(pathname: string): boolean;
export function setGlassPinned(pinned: boolean, doc?: Document): void; // "v2" <-> "pin"; no-op when absent
export function isGlassOn(doc?: Document): boolean;      // attribute present ("v2" or "pin")
export function isLiquid(doc?: Document): boolean;       // attribute === "v2"
export function useLiquid(): boolean;                    // useSyncExternalStore on the attribute
```
`layout/glass-route-pin.tsx` (L0): `GlassRoutePin()` — rendered in `AppShell`, calls `setGlassPinned(isPinnedPath(pathname))`
on route change and `setGlassPinned(false)` on unmount.

### 4.2 Tailwind variant (L0, `web/tailwind.config.cjs`)

`liquid:` → selector `&:is([data-glass="v2"] *)` (specificity +0,1,0, registered after core variants, so it beats plain
utilities and ties-then-wins against `dark:` / `hover:` / `data-[…]:`). Write `liquid:` **first** when stacking
(`liquid:active:bg-wash-2`, `liquid:dark:…`). Never use `liquid:` on locked files.

### 4.3 Theme model API (L1)

```ts
// web/src/lib/glass-theme.ts (pure, no DOM)
export type GlassPreset = "clear" | "frosted" | "solid" | "custom";
export type BgStyle = "gradient" | "grain" | "solid";
export type ColorMode = "light" | "dark";
export interface BgPref { swatch: number | null; h: number; s: number; l: number; second: number | null }
export interface GlassTheme {
  v: 1; preset: GlassPreset;
  tint: number; blur: number; saturate: number; radius: number; rim: number; shadow: number;
  bgStyle: BgStyle; reduced: boolean; bg: Record<ColorMode, BgPref>;
}
export const GLASS_RANGES; export const GLASS_DEFAULTS: GlassTheme; export const GLASS_PRESETS; export const RADIUS_PRESETS;
export const SWATCHES: Record<ColorMode, readonly Swatch[]>; export const SAT_CAP = 30;
export function parseGlassTheme(raw: unknown): GlassTheme;
export function withPreset(theme: GlassTheme, preset: Exclude<GlassPreset, "custom">): GlassTheme;
export function withPatch(theme: GlassTheme, patch: GlassPatch): GlassTheme;   // material change → preset "custom"
export function withBg(theme: GlassTheme, mode: ColorMode, patch: Partial<BgPref>): GlassTheme;
export function tintToSlider(tint: number): number; export function sliderToTint(v: number): number; // 0..100, right = clearer
export function guardBackground(pref: BgPref, mode: ColorMode): GuardedBg;
export function computeGlassVars(theme: GlassTheme, env: { dark: boolean; lite: boolean }): ComputedGlass;

// web/src/settings/glass-theme-store.ts
export function getGlassTheme(): GlassTheme;
export function setGlassTheme(next: GlassTheme, opts?: { persist?: boolean }): void;   // persist debounced 300ms
export function subscribeGlassTheme(listener: () => void): () => void;
export function resetGlassThemeMemory(): void;                                        // logout
export function useGlassTheme(): {
  theme: GlassTheme;
  update(patch: GlassPatch, opts?: { persist?: boolean }): void;
  updateBg(mode: ColorMode, patch: Partial<BgPref>, opts?: { persist?: boolean }): void;
  applyPreset(preset: Exclude<GlassPreset, "custom">): void;
  reset(): void;
};

// web/src/layout/glass-theme.ts
export function applyGlassTheme(theme: GlassTheme, win?: Window): ComputedGlass;  // writes :root inline vars + data-bg + .lite
export function initGlassTheme(win?: Window): () => void;                        // main.tsx; no-op when !isGlassOn()
```

### 4.4 Storage key, schema, defaults, presets

- Key `GLASS_THEME_KEY = "enjoy-web.appearance.glass"` in `web/src/lib/storage.ts`; JSON `{ "v": 1, … }` as `GlassTheme`.
  Invalid/out-of-range fields clamp or fall back field by field; unknown `v` → defaults.

| Field | Range | Default (磨砂) | UI |
|---|---|---|---|
| `tint` | 0.55–1.35 (factor on each tier's default fill) | 1 | 透明度 0–100, `slider = (1.35 − tint) / 0.008` (default 43.75) |
| `blur` | 0–1.5 (× 24px chrome, × 32px sheet) | 1 | 模糊, shows `round(24 × v) px` |
| `saturate` | 1.0–2.0 | 1.6 | 饱和度 (bar uses min(v, 1.3)) |
| `radius` | 0.5–1.3 (`--gx-radius`) | 1 | 圆角 segmented 紧凑 0.6 / 标准 1 / 圆润 1.25 + slider |
| `rim` | 0–1.5 | 1 | 边缘高光 |
| `shadow` | 0–1.5 | 1 | 阴影 |
| `bgStyle` | gradient \| grain \| solid | gradient | 背景样式 |
| `reduced` | boolean | false | 玻璃效果 标准 / 减弱 (forces `html.lite`) |
| `bg.light` | swatch 0–7 \| null; h 0–360, s 0–30, l 0–100; second 0–7 \| null | `{swatch:0,h:220,s:14,l:95,second:null}` (雾灰) | 背景 (浅色模式) |
| `bg.dark` | same | `{swatch:0,h:225,s:12,l:7,second:null}` (石墨) | 背景 (深色模式) |
| `preset` | clear \| frosted \| solid \| custom | frosted | 预设 tiles |

Presets (mockup `PRESETS`): **清透 clear** tint .70, blur 1.25, saturate 1.8, rim 1.3, shadow .8 · **磨砂 frosted** tint 1,
blur 1, saturate 1.6, rim 1, shadow 1 · **实色 solid** tint 1.35, blur 0, saturate 1, rim .6, shadow 1, `bgStyle:"solid"`.
Presets never change `radius`, `reduced` or `bg`.

Swatches (mockup `SW`, `[zh, en, h, s, l]`): light 雾灰 Mist 220/14/95 · 暖灰 Warm grey 35/12/93 · 冷灰 Cool grey 210/18/93 ·
纸白 Paper 45/30/96 · 鼠尾草 Sage 110/12/91 · 雾蓝 Haze blue 215/25/92 · 藕粉 Lotus 350/18/93 · 燕麦 Oat 32/22/89; dark 石墨 Graphite
225/12/7 · 暖炭 Warm charcoal 30/8/9 · 冷夜 Cold night 215/20/9 · 墨绿 Ink green 150/12/8 · 深海 Deep sea 215/28/11 · 酒灰 Wine grey
345/14/10 · 纯黑 Black 0/0/3 · 茶褐 Tea brown 25/16/10. All 16 pass the guard unclamped (computed while writing: light
worst 4.56:1 燕麦, dark worst 7.15:1).

## 5. FROZEN: tokens, utilities, material classes

### 5.1 `theme.css` additions (L0) — both `:root` and `.dark` unless marked scalar

| Token | Light | Dark | Kind |
|---|---|---|---|
| `--graphite` / `--on-graphite` | `34 37 43` / `255 255 255` | `233 235 239` / `17 19 24` | channel |
| `--ink-wash` / `--ink-wash-2` | `rgba(17,19,24,.05)` / `.09` | `rgba(255,255,255,.06)` / `.10` | colour |
| `--plate` | `rgba(255,255,255,.90)` | `rgba(23,25,30,.90)` | colour (NOT slider-driven) |
| `--scrim` | `rgba(17,19,24,.24)` | `rgba(0,0,0,.50)` | colour |
| `--page-top` / `--page-bottom` / `--page-flat` | `rgb(246,247,248)` / `rgb(232,234,237)` / `rgb(240,242,244)` | `rgb(20,22,26)` / `rgb(9,10,11)` / `rgb(16,17,20)` | colour (writer overrides) |
| `--page-sheen` | `rgba(255,255,255,.85)` | `rgba(255,255,255,.04)` | colour |
| `--page-grain` | mockup light data-URI | mockup dark data-URI | image |
| `--mat-1-rgb` / `--mat-2-rgb` / `--mat-3-rgb` / `--mat-rim-rgb` | `255 255 255` ×4 | `255 255 255` / `28 30 36` / `24 26 32` / `255 255 255` | channel |
| `--mat-1-alpha` / `--mat-1s-alpha` | `.70` / `.86` | `.055` / `.085` | number (writer) |
| `--mat-2-alpha` / `--mat-2-bar-alpha` / `--mat-3-alpha` | `.62` / `.74` / `.68` | `.58` / `.70` / `.64` | number (writer) |
| `--mat-2-filter` / `--mat-2-bar-filter` / `--mat-3-filter` | `blur(24px) saturate(1.6)` / `blur(24px) saturate(1.3)` / `blur(32px) saturate(1.6)` | same | filter (writer; `none` when blur 0) |
| `--mat-rim-1` / `-2` / `-3` / `--mat-hi` | `.85` / `.60` / `.70` / `.9` | `.10` / `.12` / `.14` / `.08` | number (writer) |
| `--mat-sh-1` / `-2` / `-3` | mockup light `sh1/sh2/sh3` | mockup dark | shadow (writer) |
| `--gx-radius` | `1` | — | scalar `:root` |
| `--frame-x` | `12px` | — | scalar `:root` |

### 5.2 Tailwind theme additions (L0)

`colors`: `wash: { DEFAULT: "var(--ink-wash)", 2: "var(--ink-wash-2)" }`, `graphite: rgb("graphite")`,
`"on-graphite": rgb("on-graphite")`, `plate: "var(--plate)"`, `scrim: "var(--scrim)"`.
`borderRadius` (all `× var(--gx-radius, 1)` except `tail`): `panel` 26 (`.m1`, `--r-sec`), `tile` 22 (`.half`, `.opt`,
bubbles), `float` 26 (composer/dock), `sheet-xl` 32 (`.sheet`), `dialog` 30 (`.dialog`), `field` 20 (`.field`),
`inset` = `max(10px, calc(26px * gx − 12px))` (`--r-in`, wells inside panels), `tail` 8px (bubble tail, fixed).
`fontSize.large`: `["30px", { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: "700" }]` (+ `"large"` in
`lib/cn.ts` `FONT_SIZE_TOKENS`). `spacing.frame`: `12px`. `boxShadow`: `well` (`inset 0 0 0 .5px var(--hair-2)`),
`plate`, `e1` / `e2` / `e3` (`var(--mat-sh-1|2|3)`), `accent` (`0 8px 20px -12px rgb(var(--blue))`).
`plugins`: `[...enjoy.plugins, liquidVariant]`.

### 5.3 Material classes (L0, `index.css`, all scoped `html[data-glass="v2"] .x`, specificity 0,2,1)

| Class | Mockup | What | Blur |
|---|---|---|---|
| `mat-surface` | `.m1` | E1 panel: `rgb(--mat-1-rgb / --mat-1-alpha)`, 1px rim, inner highlight, `--mat-sh-1` | never |
| `mat-surface-strong` | `.m1.strong` | same with `--mat-1s-alpha` (hero panels) | never |
| `mat-float` | `.fabp` | unblurred floating panel: strong E1 fill (dark `rgba(40,43,50,.96)`) + `--mat-sh-2` | never |
| `mat-chrome` | `.m2` | E2: `--mat-2-alpha`, `--mat-2-filter`; solid `--glass-solid` without backdrop support | yes |
| `mat-chrome-bar` | `.m2.capbar` | E2 carrying glyphs (capsule, composer, dock): bar alpha/filter | yes |
| `mat-sheet` | `.m3` + `.plate` | T3 bezel: `border: 8px solid transparent`, `background: linear-gradient(var(--plate),var(--plate)) padding-box, rgb(--mat-3-rgb / --mat-3-alpha) border-box`, rim as inset shadow, `--mat-sh-3`, `--mat-3-filter` | yes (transient) |
| `well` | `.well` | `--ink-wash` + `shadow-well` | never |
| `plate` | `.plate` | `--plate` + `shadow-plate` | never |
| `page-bg` | `.bgpage` | E0: sheen + gradient of `--page-top/--page-bottom`; `html[data-bg=grain]` adds `--page-grain`; `html[data-bg=solid]` → `--page-flat`; `html.lite[data-bg=grain]` → gradient | never |

`@media (prefers-reduced-transparency: reduce)`: every `mat-*`, `plate`, `page-bg` → solid (`rgb(var(--surface))` /
`--bg`), `border-color: var(--hair)`, no `backdrop-filter`.

### 5.4 Shared class constants (L2, `web/src/components/liquid.ts`) — the vocabulary the area lanes append

| Constant | Value (all liquid-only) | Mockup |
|---|---|---|
| `LQ_PAGE` | `liquid:px-frame` | page side inset 12 |
| `LQ_PANEL` | `mat-surface liquid:rounded-panel` | `.m1` |
| `LQ_PANEL_STRONG` | `mat-surface-strong liquid:rounded-panel` | `.m1.strong` |
| `LQ_TILE` | `mat-surface liquid:rounded-tile` | `.half`, `.opt`, row cards |
| `LQ_WELL` | `well liquid:rounded-inset` | `.wl.well` |
| `LQ_CHIP` | `liquid:h-7 liquid:rounded-full liquid:bg-wash liquid:text-ink-2 liquid:shadow-none` | `.chip` |
| `LQ_CHIP_OUTLINE` | `liquid:rounded-full liquid:bg-transparent liquid:text-ink-2 liquid:shadow-[inset_0_0_0_1px_var(--hair)]` | `.chip.ol` |
| `LQ_CHIP_ON` | `liquid:bg-graphite liquid:text-on-graphite liquid:shadow-none liquid:border-transparent` | selected chip |
| `LQ_PRIMARY` | `liquid:rounded-full liquid:shadow-accent` | `.pill.acc` |
| `LQ_SECONDARY` | `liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:text-ink liquid:shadow-well liquid:active:bg-wash-2` | `.pill.gh` |
| `LQ_ON_BLUR` | `plate liquid:rounded-full liquid:border-0` | `.pill.pl` (buttons on a blurred layer) |
| `LQ_DANGER_TEXT` | `liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:text-red liquid:shadow-well` | `.pill.gh.red` |
| `LQ_DANGER_SOLID` | `liquid:rounded-full` (keeps `bg-red-solid`) | hang-up / 重置单词进度 only |
| `LQ_ICON_WELL` | `liquid:rounded-full liquid:bg-wash liquid:text-ink liquid:shadow-well` | `.iw`, `.cbtn.well` |
| `LQ_FIELD` | `liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:shadow-well liquid:focus-visible:ring-blue/35` | `.inp.well` |
| `LQ_FIELD_MULTI` | `liquid:rounded-field liquid:border-0 liquid:bg-wash liquid:shadow-well` | `.field.well` |
| `LQ_NOTE` | `liquid:rounded-inset liquid:bg-wash liquid:text-ink liquid:shadow-well` | hint/notice rows (was amber/blue tint) |
| `LQ_MARK` | `liquid:bg-transparent liquid:px-0 liquid:font-semibold liquid:text-ink liquid:underline liquid:decoration-ink-2 liquid:decoration-[1.5px] liquid:underline-offset-[3px]` | target / weak words (`.field u`, `.b u`) |
| `LQ_INK` | `liquid:text-ink` | demote decorative hue text |
| `LQ_INK2` | `liquid:text-ink-2` | demote secondary hue text |
| `LQ_BAR_TRACK` / `LQ_BAR_FILL` / `LQ_BAR_INK` | `liquid:bg-wash-2` / `liquid:bg-blue` / `liquid:bg-ink/85` | `.rankbar`, `.band .k1` |
| `LQ_DIALOG` | `mat-sheet liquid:rounded-dialog liquid:w-[min(340px,calc(100%-32px))] liquid:max-w-none liquid:gap-3 liquid:p-4` | `.dialog` |
| `LQ_SEP` | `liquid:divide-hair-2` | `.lr+.lr::before` |

Components (L2): `ScoreDot({ score })` (`.dot.g|.a`, none below 70) and `scoreDotClass(score)`; `EmptyState({ icon, title,
body?, action?, testId? })` (`.empty`); `ToneBadge` gains `dot?: "green" | "amber" | "red" | "accent"`; `PageHeader` gains
`large?: boolean`; `SurfaceCard` gains `strong?: boolean`; `TOAST_CLASSNAMES` (`components/toast-classes.ts`).

## 6. Mapping table (old → appended), used by every area lane

Rule: keep the old classes, **append** the right column (R-LG1). "—" = leave as is.

| Old (classic) | Context | Append |
|---|---|---|
| `bg-<hue>-tint text-<hue>` on chips/badges/icon squares/pills | decorative, identity, status | `LQ_CHIP` (pill) or `LQ_ICON_WELL` (round icon) |
| same, on a **selected** chip/segment/filter | selection | `LQ_CHIP_ON` (graphite) — segment thumbs use `SegmentedControl` (L2) |
| `bg-amber-tint text-amber` / `bg-blue-tint text-blue` note boxes, hints, banners inside pages | text notes | `LQ_NOTE` (icon may keep `text-amber` at 16px) |
| `bg-<hue>-tint` card/row/bubble fill | containers | `LQ_PANEL` / `LQ_TILE` (no tint on containers) |
| `bg-blue-tint` own bubble (chat/rooms/rank match) | user's message | `liquid:bg-graphite liquid:text-on-graphite` + `liquid:rounded-tile liquid:rounded-tr-tail` |
| AI/other bubble `bg-surface border-hair` | partner message | `LQ_TILE liquid:rounded-tl-tail` |
| `rounded-card border-[0.5px] border-hair bg-surface (shadow-card)` | page card | `LQ_PANEL` (`LQ_PANEL_STRONG` for the screen's hero) |
| `divide-y… rounded-card … bg-surface` list | grouped list | `LQ_PANEL LQ_SEP` |
| `bg-surface-2` tracks, textareas, neutral chips | wells | `liquid:bg-wash liquid:shadow-well` (+ radius) |
| `bg-blue text-on-blue` the screen's primary CTA | one per screen | `LQ_PRIMARY` |
| `bg-blue text-on-blue` other fills (selected avatar, task done, small CTAs) | not the CTA | `LQ_CHIP_ON` or `LQ_SECONDARY` |
| `border-hair bg-surface` ghost buttons (`GHOST`, `ghostButton`) | secondary | `LQ_SECONDARY` |
| `bg-red-solid text-white` | hang-up, wordbook reset confirm | `LQ_DANGER_SOLID` |
| `bg-red-solid` elsewhere (memory 清空, delete confirms) | destructive | `LQ_DANGER_TEXT` |
| `text-red` error/alert text | errors | — (allowed) |
| `text-blue` links / retry / 全部 › / active toggle text | accent allowed | — |
| `text-blue` decorative icons, labels, "you" captions | decoration | `LQ_INK` |
| `text-green` / `text-amber` score numbers (`scoreToneClass`) | scores | `LQ_INK` + `<ScoreDot score>` next to it |
| `text-green` check icons (done) | 16px icon | — (allowed mark) |
| `text-amber` flame/lightbulb 16px icons | streak/hint marks | — (allowed) |
| `text-amber` / `text-teal` text (labels) | text | `LQ_INK` (+ `liquid:font-semibold` when it carried emphasis) |
| `bg-amber-tint text-amber` / `text-teal` on a **word** (target, weak, poor, letter diff) | word marks | `LQ_MARK` |
| error box `bg-surface-2 … text-red` | errors | `well liquid:rounded-inset` (keeps red text) |
| `bg-teal` / `bg-teal-tint` progress (mastered / growing) | wordbook/vocab | `LQ_BAR_INK` / `liquid:bg-wash-2 liquid:shadow-[inset_0_0_0_.5px_var(--hair)]` |
| `bg-blue` progress fill toward a goal | one per screen | — (accent allowed; track gets `LQ_BAR_TRACK`) |
| `rounded-button` buttons | pills | covered by `LQ_PRIMARY/SECONDARY/…` |
| `rounded-badge` / `rounded-[7px]` badges | pills | `liquid:rounded-full` |
| `px-gutter` page wrapper | frame | `LQ_PAGE` |
| `.glass glass-edge-t` composer/dock | E2 | `mat-chrome-bar liquid:inset-x-2 liquid:bottom-2 liquid:rounded-float` (+ text on `plate`) |
| `AlertDialogContent className=…` | dialogs | `LQ_DIALOG`; action buttons `LQ_PRIMARY` / `LQ_DANGER_SOLID` (reset only) / `LQ_DANGER_TEXT`; cancel `LQ_SECONDARY` |
| `IconChip tone=…`, `ToneBadge tone=…`, `Avatar tone=…`, `StatTile tone=…` | shared | nothing — L2 neutralises them centrally |

## 7. Blur budget per screen (liquid, from v2 frame headers)

| Screen | Resident at rest → scrolled | Transient |
|---|---|---|
| Practice home, wordbook home, Me, sampler-like pages | tab bar (1) → + capsule (2) | sheet/dialog +1 |
| Chat list | 1 → 2 (新对话 is `mat-float`, 0) | +1 |
| Conversation | capsule + composer + tab bar = 3 | sheet +1 |
| Wordbook quiz / learn / review | capsule + dock + tab bar = 3 | +1 |
| 外观与主题 | 2 → 3 (capsule + preview bar + tab bar) | — |
| Rooms room page | capsule + composer + tab bar = 3; assist dock = E1 | +1 |
| Realtime call | dock `mat-float` (0) + call header none | — |
| Library family, shadow sheet, changelog | unchanged (own rules) | — |

Toasts add 0 (plate, no blur). Lookup bar/drawer is the transient when open (existing rule; solid on library).

## 8. Guards (who adds which test)

| Guard | File | Lane | Asserts |
|---|---|---|---|
| CSS blur owners | `web/src/styles/glass-budget.test.ts` | L0 | in `index.css` only `.glass`, `.glass-bar`, `.glass-float`, `.glass-pop`, `.glass-sheet`, `.mat-chrome`, `.mat-chrome-bar`, `.mat-sheet` rules set a non-`none` `backdrop-filter`; `mat-surface`, `mat-surface-strong`, `mat-float`, `well`, `plate`, `page-bg` never; every liquid rule is under `html[data-glass="v2"]`; reduced-transparency block exists |
| Source blur owners | same file | L0 (list), lanes append | only files in `BLUR_OWNERS` contain `mat-chrome`/`mat-sheet`; no `backdrop-blur` Tailwind class outside `app.tsx` |
| DOM budget | `web/src/test/glass.ts` `blurLayers()` | L0 helper; L4/L5/L7/L9 page tests | `blurLayers().length ≤ 2` with the page rendered alone (+1 tab bar = 3) |
| Rule 4 | `textOutsidePlates(el)` | L0 helper; L2 (capsule, sheet), L5 (composer), L9 (dock) | `[]` |
| Locked pages | `web/src/styles/locked-pages.test.ts` | L0 | no `liquid:`/`mat-`/`plate`/`--mat-`/`--gx-`/`--page-`/`data-glass` in locked files; locked dirs import exactly the known shared modules; locked shared modules (`score-tone`, `tone`, `zh-toggle`, `glass-tab-bar`, `bottom-nav`) contain no liquid token; `BottomSheetContent` glass branch unchanged (existing `bottom-sheet.test.tsx`) |
| Route pins | `web/src/lib/glass-flag.test.ts` + `layout/glass-route-pin.test.tsx` | L0 | `/library`, `/library/x`, `/practice/changelog` → `pin`; others `v2` |
| Floors & presets | `web/src/lib/glass-theme.test.ts` | L1 | floors cannot be crossed at any slider extreme, lite caps, presets round-trip, guard clamps |
| Colour guard | `web/src/styles/liquid-colour-guard.test.ts` | L12 | every banned hue class in in-scope source has a `liquid:` (or `mat-`/`plate`/`well`) override in the same string literal, or is on the allowlist (red errors, green/amber 16px icons, blue links/CTA/progress) |

## 9. File ownership (one owner per file; a later lane touches a file only after the earlier owner merged)

| Lane | Owns |
|---|---|
| L0 | `web/src/styles/theme.css`, `web/src/index.css`, `web/tailwind.config.cjs`, `web/src/lib/cn.ts` (+`cn.test.ts`), `web/src/lib/glass-flag.ts` (+test), `web/src/layout/glass-route-pin.tsx` (+test), `web/src/layout/app-shell.tsx` (page-bg + pin), `web/src/main.tsx` (flag line), `web/src/app.tsx` (AnnouncementFrame `page-bg` only), `web/src/test/glass.ts`, `web/src/styles/{glass-budget,locked-pages,liquid-tokens,liquid-variant}.test.ts`, `web/src/styles/CLAUDE.md` |
| L1 | `web/src/lib/glass-theme.ts` (+test), `web/src/settings/glass-theme-store.ts` (+test), `web/src/layout/glass-theme.ts` (+test), `web/src/layout/glass-quality.ts` (+test), `web/src/lib/storage.ts`, `web/src/auth/device-data.ts` (+test), `web/src/main.tsx` (init line, after L0), `web/src/settings/CLAUDE.md`, `web/src/lib/CLAUDE.md` |
| L2 | `web/src/components/{liquid.ts,score-dot.tsx,empty-state.tsx,toast-classes.ts,liquid-primitives.test.tsx}` (new), `components/{surface-card,section-group,list-card,stat-tile,icon-button,icon-chip,tone-badge,avatar,segmented-control,glass-top-bar,bottom-sheet,maintenance-screen,announcement-banner,hold-to-talk-bar}.tsx/ts` (+ `announcement-banner.test.tsx`), `web/src/layout/page-header.tsx`, `components/CLAUDE.md`, `layout/CLAUDE.md`; one-off: the wordbook snapshot file (L2-9, before L9 owns it) |
| L3 | `web/src/pages/appearance/**` (new), `web/src/app.tsx` (route + toaster, after L0), `web/src/pages/CLAUDE.md` |
| L4 | `web/src/features/practice/**` except `shadow/**` |
| L5 | `web/src/features/chat/**`, `web/src/features/grammar/**` |
| L6 | `web/src/features/agents/**`, `web/src/features/realtime/**` |
| L7 | `web/src/features/rooms/**` |
| L8 | `web/src/features/rank/**` |
| L9 | `web/src/features/wordbook/**` |
| L10 | `web/src/features/vocabulary/**`, `web/src/features/progress/**`, `web/src/plugins/**` |
| L11 | `web/src/pages/{me-page,login-page,install-page}.tsx` (+tests), `web/src/pages/i18n/*.json` |
| L12 | `web/src/lib/glass-flag.ts` (+test), `web/src/main.tsx` (comment), `web/src/styles/liquid-colour-guard.test.ts`, in-scope sources only to fix colour-guard findings, `web/README.md`, `web/CLAUDE.md`, `web/src/{,lib/,styles/}CLAUDE.md`, `docs/superpowers/design/redesign-v3/design-notes.md` (pointer), `docs/superpowers/plans/2026-10-15-liquid-glass-{device-checklist,results}.md` (new), `web/scripts/main-bundle-baseline.json` (only if the owner approves a re-record) |
| Z | `docs/changelog/2026-10.json` |

Never touched: `enjoy/**`, `server/**`, `admin/**`, R-LG3 locked files.

Shared-file exception: `web/src/styles/glass-budget.test.ts` belongs to L0, but L3 and L5 each **append one line** to its
`BLUR_OWNERS` map (after L0 merged). On a merge conflict keep both lines. No other lane edits it.

## 10. Verification strategy (controller)

1. Per task: the plan's `cd web && yarn vitest run <files>` + `src/architecture.test.ts`; per lane before merge:
   `yarn web:typecheck` (repo root) and the lane's whole directory `cd web && yarn vitest run src/features/<x>`.
2. After each merge into the integration branch: `cd web && yarn vitest run src/styles src/components src/layout src/lib
   src/architecture.test.ts` (fast, catches pins and guards).
3. Full `yarn web:test`, `yarn web:build`, `node web/scripts/check-main-bundle.mjs --max-delta=2.5`, E2E: **only when the
   owner asks** (memory: no full suites unless asked). Bundle budget for the whole set: main JS ≤ +2.5 kB gzip, CSS ≤ +3 kB gzip.
4. Browser check (Haiku-style, Browser pane, 390×844, `?glass=v2`), in light AND dark:
   - [ ] practice: large title at rest, capsule after 60px scroll, 1→2 blur layers, studio hero has exactly one blue pill.
   - [ ] chat list: 新对话 pill above the tab bar, not blurred (DevTools: no `backdrop-filter`), continue hero.
   - [ ] conversation: graphite own bubbles, E1 AI bubbles, floating composer 8px from the edges, hint row and 按住说话 on plates,
         capsule shows only title + icons; open settings sheet: 8px glass bezel, plate inside; 3 + 1 layers.
   - [ ] wordbook home + a choice question after answering (correct ring + green 正确 mark, wrong ✕ 你的选择), dock plate button.
   - [ ] Me: profile hero with 3 wells, rank row, 外观与主题 row; open it: drag every slider, presets 清透/磨砂/实色, radius
         紧凑/标准/圆润, background swatches light + dark (switch 正在编辑), custom colour at L 55 → hint "亮度 55 → 91…", second
         colour, grain, solid, 玻璃效果 减弱 (blur caps at 12), 恢复默认; reload: values persist; logout + login: defaults.
   - [ ] `/library` and `/practice/changelog` look exactly as before (compare with `?glass=off`).
   - [ ] DevTools rendering: emulate `prefers-reduced-transparency: reduce` → all panels solid; 360px width large titles truncate.
   - [ ] Console: no errors.
5. Device checklist (owner): §12.

## 11. Inventory (grep, non-test, excluding locked dirs; 2026-10-15)

| Area | tint | hue text | hue fill | files with hue classes | class-asserting tests |
|---|---:|---:|---:|---:|---:|
| components | 14 | 17 | 6 | 13 | 8 |
| pages | 5 | 9 | 1 | 3 | 1 |
| practice (excl. shadow) | 0 | 7 | 6 | 6 | 0 |
| chat | 7 | 35 | 6 | 16 | 4 |
| agents | 28 | 45 | 16 | 19 | 2 |
| realtime | 0 | 7 | 9 | 6 | 1 |
| rooms | 17 | 37 | 23 | 29 | 9 |
| rank | 5 | 9 | 5 | 8 | 2 |
| wordbook | 32 | 50 | 17 | 30 | 13 (+1 snapshot) |
| vocabulary | 2 | 3 | 0 | 3 | 1 |
| progress | 0 | 1 | 0 | 2 | 0 |
| plugins | 2 | 8 | 2 | 10 | 3 |
| app.tsx | 0 | 4 | 0 | 1 | 0 |

Shared multipliers (importers): `SurfaceCard` 25, `SectionGroup/ListRow` 27, `PageHeader` 26, `BottomSheet*` 27,
`IconChip` 24, `IconButton` 20, `ToneBadge` 15, `LIST_CARD/PAGE_NOTE` 12, `Avatar` 9, `SegmentedControl` 8, `tone.ts` 8,
`score-tone` 7, `GlassTopBar` 5, `StatTile` 3. Enjoy `AlertDialog` in scope: 6 files.

## 12. Risks, deviations, UNVERIFIED

| # | Item | Mitigation / status |
|---|---|---|
| K1 | `liquid:` variant selector (`&:is([data-glass="v2"] *)`) ordering vs `dark:`/`hover:` | L0 `liquid-variant.test.ts` compiles a sample through Tailwind and asserts selector + order. If ordering differs, raise to `:is(html[data-glass="v2"] *)` — never edit area code |
| K2 | `mat-*` specificity (0,2,1) beats caller `liquid:bg-*` overrides | rule: never pair `mat-*` with `liquid:bg/border/shadow` on the same element |
| K3 | iOS Safari blur flicker on sheet enter (sheet slides with its own `backdrop-filter`) | no code mitigation (an `animationend` gate would never fire without animation); device check; fallback idea: `liquid:motion-reduce` fade-only. UNVERIFIED |
| K4 | Low-end Android: 3 resident blur layers while scrolling chat | `html.lite` caps at 12px; owner measures; UNVERIFIED |
| K5 | Contrast over busy content under capsule (posters, images) | Rule 4 + bar floor; dark capsule title ≈ 3.8:1 accepted |
| K6 | Custom backgrounds outdoors | guard only guarantees ink-2 ≥ 4.5 on the page; glass tiers are composited over it; UNVERIFIED |
| K7 | `:is()` / `rgb(r g b / a)` / `backdrop-filter` var on old WebViews | classic fallback when `@supports` fails; iOS < 15.4 untested |
| K8 | Route pin toggles the skin when switching tabs to 跟读库 | by design (library keeps its own background); check for flash on device |
| K9 | Duplicate layouts (classic + liquid) during and after the rollout; existing page tests keep exercising the classic branch | lanes add liquid test cases; L12 keeps the classic branches (one-commit rollback); removal + collapsing overridden classic classes is the follow-up in Q5 |
| K10 | Main bundle grows (engine in `main.tsx`) | engine ≈ 1.5 kB gz estimate; L3 page lazy; measured in L12 only when asked |
| D-1 | Ink side fixed per colour mode (mockup picks the side automatically) | flipping ink would contradict the colour-mode setting and the frozen tab bar/lookup that read `.dark`; Q1 |
| D-2 | Sheet title sits on the plate (v2 draws it on the glass bezel) | keeps `BottomSheetContent` DOM unchanged for 27 callers; dialog matches v2 exactly |
| D-3 | Realtime call dock = `mat-float` (unblurred) | it carries key labels (Rule 4); proposal said T2 |
| D-4 | `bare` `SectionGroup` keeps its title on E0 | panels nest cards there; E1 in E1 is forbidden |
| D-5 | No GlassDialog component; enjoy `AlertDialogContent` restyled with `LQ_DIALOG` | enjoy overlay colour stays (darker than `--scrim`); Q4 |
| D-6 | Chat-list "continue" hero shows name + time, no last-message preview | list API has no preview; no server change in scope; Q3 |
| D-7 | `theme-color` meta not driven by the custom background | `color-scheme.ts` owns metas; Q2 |
| D-8 | Practice home has no 今日 ring/streak panel | needs `getStats` from `features/progress` = a new practice→progress edge, forbidden by `CROSS_FEATURE_BASELINE`; Q6 |
| D-9 | Wordbook "最近学过" panel and Me "已加入 N 天"/level pill from the mockup are not built | no such data in the current web APIs; no server change in scope |

UNVERIFIED (could not be determined from code): real blur quality and frame rate on devices; iOS standalone status bar
over the new background; whether enjoy `AlertDialog` portals accept the bezel without layout jumps; `:has` is not used
anywhere (pins are route-based), so no `:has` risk; how the user perceives monochrome quiz feedback.

## 13. Z: controller wrap-up (not an implementer task)

- [ ] After L12 is merged, deployed (rebuild only when the owner asks) and checked by the owner, append ONE draft entry to
  `docs/changelog/2026-10.json` (rules: `docs/CLAUDE.md`; `version: null`; ≤ 4 items; each zh/en ≤ 200 chars; plain words):

```json
  {
    "entry_date": "<deploy date>",
    "version": null,
    "title_zh": "全新玻璃外观",
    "title_en": "A new glass look",
    "items": [
      { "tag": "improve", "zh": "整个应用换上了更安静的玻璃外观:浮起的分区卡片、更大的页面标题,滚动后标题缩成顶部的小胶囊。", "en": "The whole app has a calmer glass look: floating section cards and bigger page titles that shrink into a small capsule as you scroll." },
      { "tag": "new", "zh": "「我的 → 外观与主题」可以调透明度、模糊、圆角、边缘高光和阴影,也有清透、磨砂、实色三个预设。", "en": "Me → Appearance lets you tune transparency, blur, corners, edge highlight and shadow, with Clear, Frosted and Solid presets." },
      { "tag": "new", "zh": "背景颜色可以自己选:浅色和深色模式各有一套,支持渐变、颗粒和纯色;颜色太深或太浅时会自动调整,保证文字看得清。", "en": "Pick your own background for light and dark mode, as a gradient, grain or solid colour; it adjusts itself if text would get hard to read." },
      { "tag": "improve", "zh": "自己的对话气泡改为深灰色,单词本与各页面的颜色更克制,重点按钮更醒目。", "en": "Your own chat bubbles are now dark grey, and colours across the wordbook and other pages are calmer, so the main button stands out." }
    ]
  }
```
- [ ] Run `cd server && uv run pytest -q tests/test_changelog_import.py`; remind the owner to run
  `docker compose exec server python -m app.admin.changelog_import` and publish in the admin console.

## 14. Open questions for the owner

- **Q1** Ink side per mode (D-1): OK to keep dark text in light mode even if the user picks a dark custom colour (it gets
  clamped lighter), instead of flipping the text colour?
- **Q2** Should the iOS status bar colour (`theme-color`) follow the chosen background? (extra work in `color-scheme.ts`)
- **Q3** Chat-list hero without a last-message preview, or add a preview field to the server list endpoint (separate plan)?
- **Q4** Keep enjoy's darker dialog overlay, or add a small `GlassDialog` wrapper later?
- **Q5** After L12, keep the classic skin only on pinned routes forever (current plan), or schedule a follow-up that removes
  the now-dead classic classes from in-scope files (a codemod; ~2 weeks after L12, per spec §8.3)?
- **Q6** Practice 今日 panel (ring + streak + week) needs progress stats on the practice page: allow one new cross-feature
  edge `practice→progress` (an `architecture.test.ts` baseline change, owner decision) or move it to a `Slot` contributed by
  progress (extension point, separate small plan)?
