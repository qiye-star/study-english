# Liquid glass, restrained: overall design proposal (web PWA)

Status: **PROPOSAL, awaiting owner approval.** No mockups, no code. After approval: HTML mockups
(`docs/superpowers/design/liquid-glass-v1/`), then a plan under `docs/superpowers/plans/`.

Rev 2 (2026-10-15) folds in three owner rulings: **(O1)** every glass effect is user-configurable in
Me > 外观 > 主题自定义 (§6); **(O2)** floating, layered sections with a 3-level elevation scale (§4.5);
**(O3)** the designer's own low-contrast aesthetic, with layouts redesigned, not only restyled (§5.2).

Scope: `web/` only (admin out of scope, `enjoy/` never edited). Builds on
`docs/superpowers/design/redesign-v3/design-notes.md` (tokens, glass recipe, blur budget) and the glass
pieces already shipped: floating tab bar (`floating-glass-bar-v1`), lookup glass (`glass-lookup-v1`),
library (`video-import-v1/mockup-glass.html`, `curated-library-v1`), shadow sheet (`shadow-sheet-v1/mockup-glass.html`),
changelog (`changelog-v1`).

**Already redesigned, not touched (and pinned so token changes cannot drift them):** library family
(`features/library/library.css`, `fx/`, list, 精选, player, add sheet, item/segment menus), shadow sheet
(`features/practice/shadow/`), floating tab bar (`glass-tab-bar.tsx`, `.glass-float`, `.tab-halo`), lookup bar and drawer
(`features/lookup/`, `.glass-pop`, `.glass-sheet`), changelog page (`features/changelog/`: own design `changelog-v1` and
own `changelog.css`; checked, it has its own style, so it is treated as done).

---

## 1. Principles

1. **Glass is structure, not decoration.** Panels read as glass through a light page, a bright 1px rim, an inner
   top highlight and a soft lift shadow. Real blur is reserved for things content slides *under*.
2. **Near-monochrome.** Neutral ink scale + white/graphite glass. One accent (cobalt) for "act here / you are here".
   Every other hue is demoted to small marks (≤ 8px dots, ≤ 16px icons) or error text.
3. **Big, concentric radii.** Panels 26, sheets 32, controls are pills. Inner radius = outer − padding, always.
4. **Hierarchy by weight, size and opacity**, not by tint. A tinted card background is not allowed anywhere in scope.
5. **Honest depth, three tiers only:** surface (no blur), chrome (blur, resident), sheet (blur, transient).
6. **Blur budget is law:** ≤ 3 resident blur layers + ≤ 1 transient modal layer; never blur list rows or scrolling items.
7. **Legibility beats translucency.** Text sits on fills with a guaranteed floor; every glass has a solid fallback
   (`html.lite`, `prefers-reduced-transparency`, no `backdrop-filter`).
8. **Motion is quiet:** 150–300ms opacity/transform; nothing animates its own `backdrop-filter`.
9. **Low-contrast effects, high-contrast text (O3).** Surfaces, rims, shadows and dividers are soft (no hard
   borders, no dark drop shadows, no bold outlines, no saturated fills); text and icons keep WCAG AA. The calm comes
   from the material, never from greyed-out text.
10. **Floating, layered panels (O2).** Every section is its own glass panel inset from the screen edges with generous
    gaps; depth is expressed by a 3-level elevation scale, never by colour.
11. **The user owns the glass (O1).** Every material value is a CSS variable the user can tune within safe floors.

Not allowed: gradients or aurora outside the library/shadow sheet; tinted cards/tiles/chips (`bg-*-tint` as a
container fill); more than one accent-filled button per screen; coloured avatars or coloured chart series; new fonts,
images, npm packages; text in `ink-3`; cards nested in cards (use wells inside a panel); hard 1px dark borders.

---

## 2. Palette

### 2.1 Neutral scale (unchanged values, new roles)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--ink` | #111318 | #F3F4F6 | primary text, primary icons, filled "graphite" elements |
| `--ink-2` | #5B6170 | #A6ABB8 | secondary text (6.2:1 on white, 5.5:1 on the new page grey; 7.4:1 dark) |
| `--ink-3` | #8A90A0 | #6E7482 | chevrons, dividers, inactive marks only (3.2:1, graphics only) |
| `--hair` / `--hair-2` | 12% / 7% ink | 14% / 8% white | hairlines |

The existing hue tokens (`--blue --teal --amber --green --red --red-solid` and their `-tint`s) **keep their values**:
the library, shadow sheet, lookup and tab bar read them (library.css alone references them 26 times). Restraint is
achieved by changing *where* they are used, not by re-valuing them.

### 2.2 New tokens (added, light + dark pairs, in `styles/theme.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--page-top` / `--page-bottom` | #F7F8FA / #ECEEF2 | #111317 / #08090B | app background gradient (§4.4) |
| `--page-sheen` | rgba(255,255,255,.85) | rgba(255,255,255,.04) | top radial sheen |
| `--ink-wash` | rgba(17,19,24,.05) | rgba(255,255,255,.06) | wells: inputs, segmented track, neutral chips, progress tracks |
| `--ink-wash-2` | rgba(17,19,24,.09) | rgba(255,255,255,.10) | pressed state of wells, "learning" fill in bars |
| `--graphite` | #22252B | #E9EBEF | filled neutral element (user bubble, selected chip); text on it `--on-graphite` |
| `--on-graphite` | #FFFFFF | #111318 | 13.9:1 / 14.6:1 |
| material tokens | see §4 | | |

### 2.3 The one accent

**Cobalt `--blue` (#2456DB light / #8FB0FF dark), unchanged.** Reason: the excluded pieces (tab bar active pill
`--tab-on`, lookup, library CTA, shadow sheet) already use it; any other accent would make the frozen parts look
foreign. 6.1:1 on white, 5.5:1 on page grey.

Accent rules:
- Allowed: the single primary CTA per screen (filled pill), active/selected states (segmented thumb text, switch on,
  focus ring), text links, progress toward a goal (one ring/bar per screen), unread dot.
- Not allowed: decorative icons, card fills, avatars, chat bubbles, chart series, badges with counts.
- Area budget: accent pixels ≤ ~5% of a 390×844 screen (eyeballed in mockups).

### 2.4 What happens to each colour

| Colour / use today | Decision |
|---|---|
| Blue tint chips/cards/IconChip "blue" | **Replace** with neutral well (`--ink-wash`) + `ink` icon |
| Blue user bubble (chat, rooms, call "你" caption) | **Replace** with `--graphite` fill (owner decision D3) |
| Teal = vocabulary/wordbook identity (badges, progress bars, plan ring, box bar, IconChip) | **Replace** by ink scale: mastered `ink` 85%, growing `--ink-wash-2` + hairline, new = outline. Identity carried by the book icon + title (D2) |
| Amber = streak, hints, target words, score 70–84 | Streak: **ink + flame icon** (icon may stay amber at 16px). Hints: neutral well. Target words in reference text: **weight 600 + 1.5px underline in ink-2** (no fill). Score 70–84: amber **6px dot** only |
| Green = score ≥ 85, online dot | **Keep as mark only:** 6px dot / 16px check icon. Score number itself in `ink` |
| Red = errors, logout, hang-up | **Keep:** error text and destructive *text* buttons (red text on neutral well). Red fill only for the call hang-up key and the wordbook "重置进度" confirm (rare, destructive) |
| Rank tiers | Already shape-only (`TIER_ICONS`); remove remaining green/amber tints in rank cards; tier icon in `ink`, promotion = accent progress bar |
| Achievements | Earned = `ink` icon on strong surface; locked = `ink-3` outline icon. No colours |
| Avatars | Initials on `--ink-wash` with `ink` letter for everyone (user included). Uploaded photos (plan `2026-10-14-accounts-avatar`) shown as-is inside a 1px white/12% inner rim |
| Level badges (CEFR) | Neutral pill outline (`hair`), text `ink-2` |
| Charts (`progress/score-chart.tsx`, `wordbook/plan-ring.tsx`) | Line/ring in `ink` (85%), guides `ink-3/30`, **latest point / today's progress in accent** (the one accent use on the screen) |
| Call screen radial blue wash | **Replace** with neutral `--page-sheen`; "live" shown by the green 6px dot + timer |
| Announcement banner warning amber fill | **Replace** with chrome glass + amber 16px warning icon |
| `changelog.css` purple library tag | Untouched (excluded page) |

### 2.5 Colourful places inventory (grep, non-test `.ts/.tsx/.css`, excl. library, shadow, lookup)

`tint` = `bg-<hue>-tint|wash`; `hue text` = `text-<hue>`; `hue fill` = `bg-<hue>[/nn]`; `tone=` = tone props
naming a hue. No default Tailwind palette classes (`bg-blue-500` …) and no aurora exist in scope.

| Area | tint | hue text | hue fill | tone= | gradient |
|---|---:|---:|---:|---:|---:|
| wordbook | 32 | 50 | 17 | 21 | 1 (plan ring conic) |
| agents (chat parts, persona, memory) | 28 | 45 | 16 | 7 | 0 |
| rooms | 17 | 37 | 23 | 0 | 1 (mask only) |
| chat | 7 | 35 | 6 | 5 | 0 |
| components (shared) | 14 | 18 | 6 | 6 | 0 |
| rank | 5 | 9 | 5 | 5 | 0 |
| pages (me, login, install) | 5 | 9 | 1 | 7 | 0 |
| realtime | 0 | 7 | 9 | 1 | 3 (1 blue wash, 2 masks) |
| practice (excl. shadow) | 0 | 7 | 6 | 3 | 0 |
| vocabulary | 2 | 3 | 0 | 2 | 0 |
| progress | 0 | 1 | 0 | 5 | 0 |
| **Total in scope** | **110** | **221** | **89** | **62** | **1 real** |

Shared multipliers: `IconChip` (26 files), `ToneBadge` (18), `StatTile` (4), `Avatar` (9). For reference, excluded
areas: library has 21 gradients, 30 aurora/blob refs, 136 raw colour literals by design.

### 2.6 Contrast rules

- Body text (`ink`, `ink-2`) ≥ 4.5:1 against the **worst case**: fill alpha composited over both the page gradient and a
  black/white backdrop for blurred tiers. Hence fill floors: chrome ≥ .60 light / ≥ .55 dark; sheet ≥ .66 / ≥ .62.
- Text ≥ 17px semibold or icons ≥ 20px: ≥ 3:1. `ink-3` never carries information alone.
- The tab bar's 6/10/16% tint study (approved 10%, floor 6%) works only because of the halo; it is **not** a template
  for anything carrying body text. No new tier goes below 55%.
- Accent text on glass: only on surface/sheet tiers (≥ 5.5:1), never as small text on chrome.

---

## 3. Shape

| Element | Radius | Notes |
|---|---:|---|
| Page card / list group (`SurfaceCard`, `SectionGroup`, `LIST_CARD`) | **26** | padding 16 → inner content radius 10; inner well 14 when padding 12 |
| Stat tile / small card in grid | **22** | |
| List row (inside group) | 0 (group clips) | pressed highlight inset 4px, radius 22 = 26 − 4 |
| Standalone row card (wordbook options, rooms list items) | **22** | |
| Chat bubble | **22**, tail corner **8** | |
| Button (all heights 44–52) | **pill** (999) | |
| Chip / badge / tag | **pill** | 28 visual height, 44 hit (`.hit-expand`) |
| Segmented control | track pill, thumb pill | thumb = track − 3px inset, concentric automatically |
| Input (single-line 44) | **pill** | textarea / multiline composer field: **20** |
| Bottom sheet (floating card) | **32** | inset 8px from screen edges; inner cards 32 − 16 = 16 |
| Dialog (centered) | **30** | buttons inside are pills |
| Toast | **pill** if one line, 22 if multi-line | |
| Avatar | circle | |
| Icon button 44 | circle (was 12) | hover/pressed well is a circle |
| IconChip 34 | **12** squircle → **circle** | mono well |
| Dock / composer bar | **26** floating | tab bar keeps 28 (excluded) |
| Week cells / inline marks | circle / 6 | |

Concentric rule: `inner = max(outer − padding, 6)`; when the result < 10, use 10 or pill. Tailwind gets these as
variables (`rounded-card: var(--r-card, 14px)` etc.) so the excluded pins (§8.2) can restore old values locally.

The values above are the **标准 (Standard)** preset at `--gx-radius: 1`. Every non-pill radius is
`calc(<base> * var(--gx-radius))` (§6): 紧凑 0.6 (panel 16), 标准 1.0 (panel 26), 圆润 1.25 (panel 32); slider
0.5–1.3. Pills and circles never scale. Concentricity holds because inner radii are derived from the same scale.

---

## 4. Materials

### 4.1 The three tiers (new classes in `index.css`; the old `.glass*` classes stay as-is because library, lookup and the
tab bar use them)

| | **T1 `mat-surface`** | **T2 `mat-chrome`** | **T3 `mat-sheet`** |
|---|---|---|---|
| Used for | cards, list groups, stat tiles, AI bubbles, row cards, empty states | top bar (after scroll), composer, docks, banner, toasts | bottom sheets, dialogs, menus |
| Blur | **none** | `blur(24px) saturate(1.6)`; top bar `saturate(1.3)` | `blur(32px) saturate(1.8)` |
| Fill light | `rgba(255,255,255,.70)`; strong `.86` | `rgba(255,255,255,.62)`; top bar `.74` | `rgba(255,255,255,.68)` |
| Fill dark | `rgba(255,255,255,.055)`; strong `.085` | `rgba(28,30,36,.58)`; top bar `.70` | `rgba(24,26,32,.64)` |
| Rim (border 1px) light / dark | `rgba(255,255,255,.85)` / `rgba(255,255,255,.10)` | `.60` / `.12` | `.70` / `.14` |
| Inner highlight | `inset 0 1px 0 rgba(255,255,255,.9)` / `…,.08` | same | same, plus dark `inset 0 0 20px rgba(255,255,255,.03)` |
| Outer hairline | `0 0 0 .5px rgba(17,19,24,.06)` / none | none | none |
| Shadow light | `0 6px 20px -12px rgba(17,19,24,.18)` | `0 8px 24px -12px rgba(17,19,24,.22)` | `0 24px 48px -16px rgba(17,19,24,.40)` |
| Shadow dark | `0 8px 24px -14px rgba(0,0,0,.60)` | `0 10px 28px -12px rgba(0,0,0,.60)` | `0 24px 48px -16px rgba(0,0,0,.70)` |
| No `backdrop-filter` support | same (no blur anyway) | `--glass-solid` (.94) | `rgba(255,255,255,.96)` / `rgba(24,26,32,.96)` |
| `html.lite` | same | `blur(12px)`, fill .86 | `blur(12px)`, fill .90 |
| `prefers-reduced-transparency` | solid `--surface` + `--hair` | solid `--surface` + hair | solid `--surface` + hair |

All numbers above are the **磨砂 (Frosted) defaults**. In code no tier hard-codes them: each tier reads computed
variables (`--mat-1-alpha`, `--mat-2-alpha`, `--mat-2-blur`, `--mat-3-alpha`, `--mat-3-blur`, `--mat-sat`,
`--mat-rim`, `--mat-hi`, `--mat-sh-1/2/3`) written by the theme customiser (§6), with these defaults declared in
`theme.css` so the app renders correctly before any JS runs.

Wells (inside any tier, never blurred): `--ink-wash` fill + `inset 0 0 0 .5px var(--hair-2)`; pressed `--ink-wash-2`.
Scrim behind T3: `rgba(17,19,24,.24)` light / `rgba(0,0,0,.50)` dark, **no blur on the scrim**.

### 4.2 Blur budget (global rule, replaces "≤ 3 per screen")

- At most **3 resident** `backdrop-filter` layers visible at once (typically: top bar when scrolled, composer/dock,
  tab bar) **plus at most 1 transient** modal layer (T3 sheet/dialog, or the lookup bar/drawer). Never two transients.
- Never on list rows, cards, bubbles, chips or anything inside a scrolling list.
- No blurred element inside an ancestor with `opacity < 1`, `filter`, or `overflow:hidden` + `transform`.
- Library screens keep their own rule (already 3; transient goes solid via `:has(.library-root)`).
- Pages with the call/room dock: top bar + dock + tab bar = 3; the room "assist" dock must not add a 4th (it becomes T1).
- Enforced by a new `styles/glass-budget.test.ts`: only `.mat-chrome`/`.mat-sheet` (plus the existing `.glass*`,
  `.glass-float`, `.glass-pop`, `.glass-sheet`) may declare `backdrop-filter` in `index.css`; `mat-surface` must not.

### 4.3 Performance risks and how the tiers avoid them

- **Android Chrome, low-end:** each blur layer re-samples every frame while content scrolls beneath. T1 has no blur, so
  long lists cost nothing extra; chrome layers are small strips; `html.lite` (deviceMemory ≤ 4) drops to 12px.
- **iOS Safari flicker/blank frames** when an element with `backdrop-filter` is itself transformed: T3 sheets slide in
  with the **solid fallback fill** and get `backdrop-filter` only after `animationend` (a `data-settled` attribute,
  then a 150ms fill cross-fade). Unverified on device; the lookup drawer does not do this today (not our scope).
- **iOS has no `deviceMemory`**, so iPhones always get full glass; acceptable (GPU-strong), verify on an older iPhone.
- **Non-opaque scroller** (the `<main>` becomes transparent over the page gradient): modern Chrome composites it on
  mobile (grayscale AA); old WebViews may fall back to main-thread scrolling. `html.lite` paints a flat `--page-bottom`
  colour on `<main>` instead.

### 4.4 Page background (what the glass sits on)

- **Light:** `linear-gradient(180deg, var(--page-top) 0%, var(--page-bottom) 100%)` plus
  `radial-gradient(120% 50% at 50% -10%, var(--page-sheen), transparent 60%)`. Pure neutral grey, no hue, no noise
  (a noise texture would need an image or SVG filter repaint; not worth it).
- **Dark:** same structure, #111317 → #08090B, sheen white 4%.
- Painted once on the non-scrolling shell `div` in `layout/app-shell.tsx` (replacing `bg-background`); `<main>` is
  transparent. Cost: one static gradient layer, no animation.
- `--bg` stays white for compat (`bg-background` users in classic pins); `theme-color` light becomes `#F7F8FA`
  (`layout/color-scheme.ts` + `web/index.html`).
- Why not white: translucent white cards on a white page are invisible; a 3–5% grey page is what makes T1 read as glass
  without blur (iOS grouped-list principle).
- **Library keeps its own `--lib-page` (#EEF1F8) + aurora**; its page tone is close to ours, so tab switches don't flash.
  The aurora stays a library/shadow-sheet "media zone" signature and is not used elsewhere.
- **Grain** variant (user option, §6): the same gradient plus a static monochrome noise from an inline SVG
  `feTurbulence` data-URI (≈ 400 bytes in CSS, no download), opacity 3% light / 4% dark, painted once on the shell.
  Off under `html.lite`. **Solid** variant: flat `--page-bottom`.

### 4.5 Elevation and layering (O2)

Three levels plus a recessed well. Depth comes from rim, highlight and a wide, faint shadow, never from dark outlines.

| Level | Name | What lives here | Material | Blur | Shadow light / dark (defaults, × `--mat-sh-*`) |
|---|---|---|---|---|---|
| E0 | **base** | the page (gradient/grain/solid) | §4.4 | none | none |
| E1 | **section** | every content block: hero, list groups, cards, bubbles, row cards | T1 `mat-surface` | **never** | `0 1px 1px rgba(17,19,24,.03), 0 12px 32px -18px rgba(17,19,24,.16)` / `0 12px 32px -18px rgba(0,0,0,.55)` |
| E2 | **floating** | top bar (scrolled), composer, docks, tab bar, sheets, dialogs, toasts | T2 / T3 | yes | `0 18px 40px -16px rgba(17,19,24,.24)` / `0 18px 44px -14px rgba(0,0,0,.65)` |
| (−1) | **well** | inputs, tracks, chips, pressed rows, inner tiles inside an E1 panel | `--ink-wash` + inner hairline | never | inset only |

Layering rules:
- **Sections float:** E1 panels are inset **12px** from the screen edges (`--frame-x: 12px`; content inside keeps
  16px padding, so text sits 28px from the edge), separated by **16px** gaps; between unrelated groups **28px**.
- **One E1 per block, no E1 inside E1.** Anything nested inside a panel is a well or a plain row.
- **Section titles live inside the panel** (13px/600 `ink-2`, 14px from the panel top) so each block reads as a
  self-contained floating card; the only text on E0 is the large page title and footnotes.
- **Only E2 blurs.** E1 is translucent fill + rim + highlight + shadow; the blur budget (§4.2) counts E2 only.
- **E2 always sits above E1 in z-order and in shadow size**; an E1 never casts a larger shadow than an E2.
- E1 shadows are wide (32px) and faint (≤ .16 alpha light) so adjacent panels separate softly; dark mode relies on
  the rim + highlight more than the shadow.
- Pressed E1 panel: scale .985 + shadow to 60% (150ms), transform only.

---

## 5. Layout system

### 5.1 System

- **Page frame:** shell gradient (E0) → `<main>` scroll → floating E1 panels inset `--frame-x: 12px` from the screen
  edges, 16px gaps, 28px between groups; panel padding 16. Top: `env(safe-area-inset-top)` + header. Bottom:
  `var(--tab-bar-space)` (unchanged). Max width `screen-sm` centred.
- **Header (D6): floating title capsule.** Root tabs (练习, 对话, 联机, 我的, 单词本) show a **static large title**
  (30px/700, new `text-large`) on E0 with a 13px `ink-2` subtitle line (date, counts). On scroll (`useScrolled`), a
  compact **E2 capsule** appears inset 12px from the edges (radius 22, height 44, 17px title, 150ms fade), instead of
  today's full-width bar — the same shape language as the tab bar. Sub-pages use the capsule permanently (back circle
  + title + actions), transparent at rest, glass after 4px scroll.
- **Rhythm:** panel padding 16; 16px between panels, 28px between groups; section titles inside panels (§4.5);
  32px before the last block (logout etc.).
- **List rows:** min 56 (unchanged), 20px icon in a 34px circle well, 15px title, 12px subtitle, value `ink-2`, chevron
  `ink-3` 18px. Dividers `hair-2` inset 62px (start after the icon). Pressed: inset well (§3).
- **Forms:** label 13px/600 `ink-2` above field; pill inputs 44 tall on `--ink-wash`; focus = 2px accent ring at 35%;
  error text 13px red below with icon; primary submit = full-width accent pill 50px.
- **Bottom sheets:** floating T3 card, inset 8px, bottom `max(8px, safe-area − 8px)`, radius 32, grabber 36×5,
  title 17/600, close 44 circle top-right, max height 85dvh, inner scroll. Sheet actions: primary accent pill +
  secondary well pill, stacked full-width when > 1.
- **Dialogs:** centered T3 card radius 30, width min(340px, 100% − 32px), title 17/600, body 15, actions as pills
  (destructive = red text on well). Built as `components/glass-dialog.tsx` (Radix), since enjoy's dialog cannot be edited.
- **Empty states:** T1 card, 40px `ink-3` outline icon in a 64px well circle, 15/600 title, 13 `ink-2` line, one
  ghost pill action. No illustrations.
- **Toasts (sonner):** T2 chrome pill at top-center, 14px text, icon 16 (semantic colour allowed on the icon only);
  configured through `toastOptions.classNames` in `app.tsx`'s `ThemedToaster`.
- **Typography:** keep the scale (11/12/13/15/17/22/28/34) and system stack; add only `large` 30px/1.15/-0.025em/700
  for root titles. Numbers stay `.num` (tabular).
- **Iconography:** lucide, stroke 2 (matches the frozen tab bar), 22px in bars, 20px in rows, 16px inline, 18px
  chevrons. Icons are `ink` or `ink-2`; accent only when the icon *is* the active control.
- **Motion:** 150ms state (colour/opacity), 200ms small transforms, 300ms sheet enter / 200ms exit with
  `--ease-standard`; press scale .97 on pills/cards (transform only, never on blurred elements); all loops under
  `motion-safe:`; `prefers-reduced-motion`: fades only, no slide/scale.

### 5.2 New layouts (O3: redesigned, not restyled)

Sketches at 390px; `[ ]` = E1 panel, `( )` = pill, `⟨ ⟩` = E2 floating. All `data-testid`s and routes stay.

**Practice home (跟读评测).** Today: page of stacked controls. New: one calm "studio" — a hero panel for the act of
reading, the rest demoted to compact panels below.

```
 练习                                  ⟨◷⟩  ← history circle
 周三 · 10 月 15 日 · 今日 9 / 15 分钟
┌ hero ───────────────────────────────┐
│ 参考文本                       (中文) │   textarea well, radius 20, grows to 6 lines
│ ░ Paste or type English to read ░░ │
│ (▷ 先听范读)            ( ● 开始朗读 )│   ghost pill + the one accent pill
└─────────────────────────────────────┘
┌ 今日 ──────────────────────────────┐
│ ◔ 9/15 分    🔥 12 天   ● ● ● ○ ● · · │   ink ring (accent arc), streak ink, week dots
└─────────────────────────────────────┘
┌ 最近评分                    全部 ›  ┐
│  92 •   78 •   64      ← 3 mini tiles (wells), dot = green/amber mark
└─────────────────────────────────────┘
┌ 练习清单 · 12            ›  ┐   one row, opens the list page
└──────────────────────────────┘
           ⟨ tab bar ⟩
```

**Chat list (对话).** Today: list under a bar. New: a "continue" hero for the latest conversation, then a single
grouped panel, with new-chat as a floating pill (not a header icon) that sits above the tab bar.

```
 对话
 3 个进行中
┌ 继续 ───────────────────────────────┐
│ ◯E  Emma · 咖啡店点单                 │   avatar well, last line ink-2, time
│     "Sure, would you like oat…"       │
│                         ( 继续对话 › )│
└─────────────────────────────────────┘
┌ 全部对话 ───────────────────────────┐
│ ◯  Job interview        昨天      › │   rows 64, dividers inset after avatar
│ ◯  Airport check-in     周一      › │
│ ◯  Small talk           10/09     › │
└─────────────────────────────────────┘
                       ⟨ ＋ 新对话 ⟩     E2 pill, right, 8px above tab bar (counts as a resident layer
           ⟨ tab bar ⟩                   only on this page: bar capsule + FAB + tab bar = 3)
```

**Wordbook home (单词本).** Today: badge + teal bars + rows with coloured chips. New: a "today" hero that is the
whole decision (what to do now), with progress as a quiet ink band and the book as a footnote panel.

```
 单词本                                ⟨⚙⟩
 四级核心 · 第 18 天
┌ 今天 ───────────────────────────────┐
│  12  待复习      8  新词               │   28px numerals, ink; labels ink-2
│ ▓▓▓▓▓▓▓▓▒▒▒▒░░░░░░  1,204 / 4,544     │   mastered ink 85% · growing wash-2 · new well
│ ( ● 开始复习 12 )                      │   the one accent pill (or 学新词 when no reviews)
│ (学新词 8)   (拼写)                    │   ghost pills
└─────────────────────────────────────┘
┌ 计划 ───────────────────────────────┐
│ 复习 4/16 · 明天 23 · 连续 6 天   ◔   │   wells + plan ring (ink, accent arc)
└─────────────────────────────────────┘
┌ 已学单词 ›  ┐ ┌ 换书 ›  ┐               two half-width E1 panels (radius 22)
└────────────┘ └─────────┘
```

**Me / settings (我的).** Today: profile row, 3 tinted stat tiles, many groups. New: a profile hero panel with stats
inside it as wells, then fewer, denser groups; appearance becomes its own page (§6).

```
 我的
┌ ───────────────────────────────────┐
│ ◯L   Lin                       ›   │   neutral avatar, name 22/600, level pill outline
│      B1 · 已加入 42 天               │
│ ┌连续┐ ┌时长┐ ┌均分┐                   │   3 wells inside the hero (not cards)
│ │12天│ │86分│ │81 •│                   │
└─────────────────────────────────────┘
┌ 段位  ⛉ 黄金 II   ▓▓▓▓▓░░ 62/100   ›  ┐   one-row rank panel, accent bar
└─────────────────────────────────────┘
┌ 学习 ────────┐  进度 · 单词本 · 每日目标 · 学习提醒
┌ 语音与对话 ──┐  声音 · 自动朗读 · 提示词 · 智能体
┌ 通用 ────────┐  外观与主题 › · 语言 · 安装到主屏幕 · 更新日志
┌ 账户 ────────┐  服务器 · 关于
        ( ⎋ 退出登录 )      red text on a well pill, 32px below
```

Other in-scope screens follow the same grammar: hero panel for the primary act, grouped rows in one panel, floating
E2 pill for the creation action where the screen has one (rooms lobby: 创建房间; vocabulary: 复习).

---

## 6. Theme customisation · 主题自定义 (O1)

### 6.1 Variables (written on `:root` by `applyGlassPrefs`)

User-intent values are stored; the tiers read **computed** variables so floors and fallbacks are applied in one place.

| Pref (stored) | UI | Range / options | Default (磨砂) | Computed CSS variables |
|---|---|---|---|---|
| `tint` | 透明度 slider (shown as 0–100, inverted: right = clearer) | factor 0.55–1.35 on each tier's default fill | 1.0 | `--mat-1-alpha`, `--mat-2-alpha`, `--mat-2-bar-alpha`, `--mat-3-alpha` = max(floor, default × tint) |
| `blur` | 模糊 slider | 0–1.5 × (T2 24px, T3 32px) | 1.0 | `--mat-2-blur`, `--mat-3-blur` (px) |
| `saturate` | 饱和度 slider | 1.0–2.0 | 1.6 | `--mat-sat` (top bar uses min(sat, 1.3)) |
| `radius` | 圆角: 紧凑 / 标准 / 圆润 + fine slider | 0.5–1.3 | 1.0 | `--gx-radius` (all `--r-*` are calc of it) |
| `rim` | 边缘高光 slider | 0–1.5 | 1.0 | `--mat-rim` (border alpha factor), `--mat-hi` (inner highlight alpha) |
| `shadow` | 阴影 slider | 0–1.5 | 1.0 | `--mat-sh-1`, `--mat-sh-2`, `--mat-sh-3` (alpha factors) |
| `background` | 背景: 渐变 / 颗粒 / 纯色 | `gradient` \| `grain` \| `solid` | `gradient` | class on `html`: `bg-gradient` / `bg-grain` / `bg-solid` |
| `preset` | 预设 tiles | `clear` \| `frosted` \| `solid` \| `custom` | `frosted` | (sets the values above; any slider move → `custom`) |

Presets: **清透 Clear** tint .7, blur 1.25, sat 1.8, rim 1.3, shadow .8 · **磨砂 Frosted** all defaults ·
**实色 Solid** tint 1.35 (hits each tier's solid ceiling .94), blur 0, sat 1.0, rim .6, shadow 1.0, background solid.

Accessibility floors (not user-slidable; the slider stops there and shows "已到可读下限"):

| Tier | Floor light | Floor dark | Why |
|---|---|---|---|
| T1 section | .50 | .04 | E1 carries body text on the known E0 page; ≥ 4.5:1 for `ink-2` |
| T2 chrome | .55 (top bar .62) | .50 (.58) | blurred unknown backdrop |
| T3 sheet | .62 | .58 | forms and long text |
| Any tier with `blur < 8px` | +.20 on the floor | +.20 | without blur the backdrop shows through sharply |

### 6.2 Overrides (strongest last)

1. User prefs (§6.1), applied to `:root` before first render.
2. **`html.lite`** (deviceMemory ≤ 4, or the user's "玻璃效果: 减弱"): blur capped at min(user, 12px), alpha floor
   raised to .80 light / .80 dark, background grain → gradient. The customiser shows a note and greys the blur slider
   above the cap.
3. **`prefers-reduced-transparency: reduce`**: solid `--surface` + hairline for every tier, no blur, regardless of
   prefs (radius, rim and shadow still apply). Customiser shows "系统已开启降低透明度", glass sliders disabled.
4. **No `backdrop-filter` support**: blur ignored, solid fallbacks as §4.1.
5. **Frozen pieces** (tab bar, lookup, library, shadow sheet, changelog) do not read the `--mat-*`/`--gx-*` variables
   in this proposal (see D9): they stay pixel-identical. The customiser preview states "跟读库与底栏使用固定样式".

### 6.3 Storage and lifecycle

- Key `enjoy-web.appearance.glass` (constant in `lib/storage.ts`, `readJson`/`writeJson` with a guard; versioned
  `{v:1, …}`; invalid or out-of-range values clamp or fall back to defaults).
- Read and applied in `main.tsx` before render (like `initColorScheme`), so there is no flash.
- Device-local only, never sent to the server; removed by `auth/device-data.ts` `clearDeviceData()` at logout.
- Pure logic in `lib/glass-prefs.ts` (clamp, presets, floors, `computeGlassVars(prefs, {lite, dark})`), the DOM writer
  in `layout/glass-prefs.ts` next to `glass-quality.ts`; both unit-tested (floors cannot be crossed, presets round-trip).
- Slider input writes variables on `requestAnimationFrame` (live), persists on `change` (debounced 300ms).

### 6.4 Settings page: Me > 外观与主题 (`/me/appearance`)

```
 ⟨‹  外观与主题⟩
┌ live preview (sticky under the capsule, 196px) ┐
│  E0 sample bg · two lines of text scrolling   │   real page bg + an E1 card with 2 rows
│  [ E1 card · 每日目标 · 15 分钟 › ]            │   + an E2 mini bar over moving text
│  ⟨ E2 bar  ◷  ★  ⚙ ⟩      ( 主按钮 )            │   so blur, rim, shadow, radius are visible
└────────────────────────────────────────────┘
┌ 颜色模式  (跟随系统 | 浅色 | 深色) ┐              existing preference, moved here
┌ 预设 ──────────────────────────────┐
│ [清透] [磨砂✓] [实色]   自定义 •      │   3 tiles (wells with a mini glass swatch), 44px+ targets
└────────────────────────────────────┘
┌ 玻璃 ──────────────────────────────┐
│ 透明度   ○━━━━━━●━━━━   72         │   slider row 56 tall, value right (.num)
│ 模糊     ○━━━━━●━━━━━   24 px      │
│ 饱和度   ○━━━━━━●━━━━   1.6        │
└────────────────────────────────────┘
┌ 形状与光影 ─────────────────────────┐
│ 圆角   (紧凑 | 标准 | 圆润)            │
│        ○━━━━━━●━━━━   26 px        │
│ 边缘高光 ○━━━━━●━━━━━                 │
│ 阴影     ○━━━━━●━━━━━                 │
└────────────────────────────────────┘
┌ 背景  (渐变 | 颗粒 | 纯色) ┐
┌ 玻璃效果 (标准 | 减弱)  "低端设备自动减弱" ┐   forces html.lite
         ( 恢复默认 )                          ghost pill, confirm-free (undo toast)
```

Slider control: native `<input type="range">` styled as a pill well track (6px), 28px white glass thumb, 44px hit
height, `aria-valuetext` with units, keyboard steps; no new dependency. The page itself uses 3 blur layers (capsule,
preview mini bar, tab bar), within budget.

---

## 7. Per-area application

| Area (main files) | Changes | Effort | Risk |
|---|---|:-:|:-:|
| **Shared components** (`components/*`, `layout/page-header.tsx`, `app-shell.tsx`, `app.tsx` toaster) | T1 on `SurfaceCard`/`SectionGroup`/`LIST_CARD`; `IconChip` → mono circle well (tone ignored, prop kept); `StatTile` → T1 strong, ink label + 16px icon; `ToneBadge` gains `tone="mono"` + pill; `Avatar` neutral; `IconButton` circle; `SegmentedControl` pill well; `BottomSheetContent` default → floating T3 (with `variant="classic"` for pins); new `glass-dialog.tsx`; `GlassTopBar` large title + floating capsule; `SectionGroup` title moves inside the panel, `--frame-x` inset; shell background; toaster pill; new `components/glass-slider.tsx` | M | M (fans out to every page) |
| **Theme customiser** (new: `lib/glass-prefs.ts`, `layout/glass-prefs.ts`, `pages/appearance-page.tsx` or `settings/`, route in `app.tsx`, `auth/device-data.ts`, `lib/storage.ts` key) | §6: prefs model, floors, presets, live preview page, logout cleanup | M | M (live var writes; floors must hold) |
| **Practice home** (`practice-page.tsx`, `practice-list-page.tsx`, `history-page.tsx`, `assessment-page.tsx`) | **New layout §5.2**: studio hero (reference + listen + record), 今日 panel (ring, streak, week), recent-score wells, 清单 row; history to header circle | M | M (layout change around the recorder) |
| **Chat** (`chat/*`, `agents/chat-parts`, persona/memory sheets) | **Chat list new layout §5.2** (continue hero, one grouped panel, floating 新对话 pill); bubbles: AI = T1, user = graphite; composer = floating T2 bar radius 26 inset 8 (sits 8px above tab bar via `--tab-bar-space`, unchanged rule); hint row = well inside composer; result badges mono + dots; all sheets T3; agents tints (28) → wells | L | M (most-used screen; composer geometry + keyboard) |
| **Realtime call** (`realtime/*`) | Remove blue wash → sheen; caption cards T1; dock T2 radius 26; keys circle wells; hang-up keeps red fill; PTT pressed = accent | M | M (call layout tuned for 667px) |
| **Rooms** (`rooms/*`: lobby, create sheet, room, voice, assist, ended) | Lobby cards T1 22; code input pill wells; room bubbles as chat; assist dock T1 (no 4th blur); reaction bar mono; buttons in `rooms/ui.ts` → pills | L | M (17 tints, 23 fills) |
| **Rank** (`rank/*`) | Rank card T1 strong, tier icon ink, accent progress; match page = chat rules; achievements mono earned/locked | M | L |
| **Wordbook** (`wordbook/*`, `spell/`) | **Home new layout §5.2** (今天 hero with counts + one accent CTA, 计划 panel, two half panels); teal → ink scale (box bar, progress, plan ring, book badges); option cards 22 pills states: correct = green check icon + ink border 1.5px, wrong = red icon; session dock T2; `ui.ts` buttons pills; snapshot `word-card-legacy` updated intentionally | L | M (50 hue texts, quiz state legibility) |
| **Vocabulary** (`vocabulary/*`) | Review card T1; mono chips | S | L |
| **Progress** (`progress/*`) | Chart ink + accent last point; stat tiles T1 | S | L |
| **Me / settings** (`pages/me-page.tsx`, agent settings) | **New layout §5.2**: profile hero with stat wells, one-row rank panel, 4 regrouped panels, 外观与主题 row → §6 page; switch on = accent; logout red text on well pill | M | M (regrouping touches many testids: keep them) |
| **Login / install** (`pages/login-page.tsx`, `install-page.tsx`) | Gradient page, logo mark in ink well, form per §5, accent submit | S | L |
| **Frames** (`announcement-banner.tsx`, `maintenance-screen.tsx`, `feature-gate.tsx`) | Banner T2 strip with icon (no amber fill); maintenance = empty-state pattern | S | L |
| Library family | **Already done: skip** (pinned) | – | – |
| Shadow sheet | **Already done: skip** (own `.shs-root` tokens) | – | – |
| Floating tab bar | **Already done: skip** | – | – |
| Lookup bar + drawer | **Already done: skip** (`glass` prop path of `BottomSheetContent` byte-identical) | – | – |
| Changelog page | **Already done: skip** (pinned, D7) | – | – |

---

## 8. Migration strategy

### 8.1 Order

1. **Tokens & materials (one lane, first, serial):** `styles/theme.css` (new tokens, light+dark, **all material
   values as `--mat-*` / `--gx-*` variables with Frosted defaults**), `index.css` (`mat-*` tiers + elevation, page
   background variants `bg-gradient|grain|solid`, pins), `tailwind.config.cjs` (radius values as `calc(base *
   var(--gx-radius))`, `ink-wash`, `graphite`, `text-large`, `frame-x`), `styles/theme.test.ts`, new
   `styles/glass-budget.test.ts`. Because the tiers read variables from day one, the customiser needs no CSS rework.
2. **Shared components (one lane, serial):** everything in the "Shared" row. After this, ~60% of the app already looks new
   (26 `SurfaceCard`, 15 `SectionGroup`, 20 `ListRow`, 26 `IconChip` files, 31 sheet call sites, 29 `PageHeader`).
3. **Theme customiser lane** (parallel with step 4, disjoint files): prefs model + writer + page (§6).
4. **Area passes (parallel lanes):** new layouts (§5.2) and removal of per-area tints/hue fills (§2.4).

### 8.2 Pins (how excluded pages stay pixel-identical)

- Radius tokens become variables with the old values as fallback; `html.skin-glass` sets the new ones.
- `index.css` re-declares the **old** values for `.library-root, .shs-root, .skin-classic` (radius vars, `--radius`
  used by enjoy's `Button`). No edit in `library.css` or `shadow-sheet.css`.
- Portaled excluded nodes that lack `.library-root` (library `item-menu`, `segment-menu`, `delete-item-dialog`) and the
  changelog page root get `variant="classic"` / `skin-classic`: a one-line, no-visual-change edit each.
- `.glass`, `.glass-bar`, `.glass-float`, `.glass-pop`, `.glass-sheet`, hue tokens, `TONE_CLASS`, `scoreTone` keep
  their exact output. In-scope call sites move to `tone="mono"` / dots instead.
- A test asserts the pin list and that the `glass` branch of `BottomSheetContent` is unchanged
  (`bottom-sheet.test.tsx` already checks it).

### 8.3 Flag vs hard switch (D5)

Recommend **a development flag, then a hard switch** — not a user-facing "经典 / 玻璃" option (that would double QA
and keep two styles alive forever; the customiser's 实色 preset already covers users who dislike transparency).
`html.skin-glass` is set by `main.tsx` from a build-time/localStorage flag (default off) while lanes merge; owner
reviews on device; flip default on in one commit; delete the flag and classic fallbacks two weeks later. The
customiser page ships behind the same flag. **玻璃效果: 标准 / 减弱** (§6.4) forces the existing `html.lite` path.

### 8.4 Tests stay green

- `architecture.test.ts`: all new code is in `styles/`, `components/` (presentational, no feature imports) and per
  feature; `glass-dialog.tsx` imports only Radix + `@renderer/lib/utils`.
- `library-css.test.ts` (3 blur declarations), `shadow-css.test.ts`, `glass-lookup.test.ts`, `floating-tab-bar.test.ts`,
  `changelog-css.test.ts`: untouched files, must pass unchanged — this is the regression alarm for the pins.
- Class-string tests (19 files, e.g. `primitives.test.tsx`, `layout.test.tsx`, `achievements-page.test.tsx`,
  `spell-page.test.tsx`): updated in the same lane that changes the component, one commit per logical change.
- Snapshot `wordbook/__snapshots__/word-card-legacy.test.tsx.snap`: regenerate intentionally in the wordbook lane.
- E2E: lanes must not change `data-testid`, roles or accessible names; selectors keep working (the new layouts move
  elements but keep their ids). New E2E: open 外观与主题, pick 实色, reload, values persist; logout clears them.
- New unit tests: `lib/glass-prefs.test.ts` (clamping, floors, presets, lite/dark computation),
  `layout/glass-prefs.test.ts` (vars written on `:root`, reduced-transparency path), `auth/device-data` test extended
  for the new key.

### 8.5 Size budget

No new dependencies, fonts or images. Expected CSS growth ≈ +4–5 KB raw / ≤ +2 KB gzip (tokens, 3 tiers, elevation,
grain data-URI, pins), partly offset by deleted tint classes. The customiser page is a lazy route chunk (not in the
main bundle); the prefs reader in `main.tsx` is < 1 KB. Check `yarn web:build` before/after in the token lane and in
the final lane; fail the plan if main CSS grows > 3 KB gzip.

### 8.6 Phases and lanes (sketch)

| Phase | Lane | Files (disjoint) |
|---|---|---|
| P0 | A tokens | `styles/*`, `index.css`, `tailwind.config.cjs`, `main.tsx` flag |
| P1 | B shared | `components/*`, `layout/page-header.tsx`, `layout/app-shell.tsx`, `layout/color-scheme.ts`, `app.tsx` (toaster), `index.html` meta, pin one-liners in library/changelog |
| P2 (parallel worktrees) | C practice+progress+vocabulary | `features/practice` (not `shadow/`), `features/progress`, `features/vocabulary` |
| | D chat+agents+realtime | `features/chat`, `features/agents`, `features/realtime`, `features/grammar` |
| | E rooms+rank | `features/rooms`, `features/rank` |
| | F wordbook | `features/wordbook` |
| | G pages+frames | `pages/*` (except the appearance page), `components/announcement-banner.tsx`, `maintenance-screen.tsx`, `feature-gate.tsx` (moved out of B to keep B small) |
| | T theme customiser | `lib/glass-prefs.ts`, `layout/glass-prefs.ts`, the appearance page + its i18n, `lib/storage.ts` (one constant), `auth/device-data.ts` (one line), `main.tsx` (one init call), `app.tsx` (one lazy route). Lane G only adds the Me row link; T owns the page. `components/glass-slider.tsx` comes from lane B |
| P3 | H flip + cleanup | flag default on; device checklist; changelog entry |

`main.tsx` and `app.tsx` are touched by A, B and T: each change is one line; T rebases last.

---

## 9. Risks and unverified items (need a real device)

- **Legibility over busy content:** composer and top bar over images/posters in chat or rooms; mitigated by fill floors
  (§2.6). Check iPhone + mid Android in sunlight brightness.
- **Low-end Android perf:** chat scroll with top bar + composer + tab bar blurring (3 resident). Measure dropped frames
  on a deviceMemory ≤ 4 device with and without `html.lite`.
- **iOS Safari blur flicker** on sheet enter (mitigation in §4.3) and with the keyboard open (composer is T2 and moves
  with `--app-height`; the iOS keyboard fix is itself still unverified on a real iPhone).
- **Dark mode:** T1 at 5.5% white can look flat on OLED; may need .07. Verify on an OLED phone.
- **Non-opaque `<main>`** scrolling cost on old WebViews (§4.3).
- **Graphite user bubble** contrast with selection/lookup highlight and `--active-word`; check long-press lookup on
  user messages.
- **Photo avatars** (upcoming avatar plan) are the one coloured content; rim keeps them from bleeding into glass.
- **Monochrome quiz feedback** (wordbook correct/wrong without green/red fills) must stay unmistakable: icon + border
  weight + text; needs a quick user check.
- **Large-title header** on 320–360px widths with long English titles (truncate rules).
- **User-tuned extremes (O1):** max clarity + max blur on a low-end Android; floors guarantee contrast but not frame
  rate — `html.lite` caps blur regardless. Verify the floors hold over a white poster and a black poster.
- **Live variable writes** while dragging a slider repaint every blurred layer; throttled to rAF, verify on device.
- **Layered E1 shadows** on long lists (many panels with 32px shadows) cost paint on scroll on low-end devices; under
  `html.lite` E1 shadows drop to the 1px contact shadow only.
- **Frozen pieces next to user-tuned glass:** at extreme settings the tab bar/library will look different from the
  rest (by design, D9).
- Nothing here has been run; all numbers are proposals until mockups are measured in the browser pane.

---

## 10. Decisions for the owner (with recommendation)

Already decided by the owner: user-configurable glass (O1), floating layered sections (O2), designer's low-contrast
aesthetic with layout redesign (O3). Open:

1. **D1 Accent:** keep cobalt blue as the only accent (rec.) vs pure ink/graphite with no accent. Rec. cobalt: the
   frozen tab bar, lookup and library already use it.
2. **D2 Wordbook teal identity:** drop it, ink scale only (rec.) vs keep teal only on the one progress bar.
3. **D3 User chat bubble:** graphite fill (rec.) vs accent blue fill (iMessage-like, but the largest coloured area in the app).
4. **D4 Default background:** neutral gradient + top sheen (rec.); grain and solid remain user options in §6.
5. **D5 Rollout:** dev flag → hard switch; customiser + "玻璃效果 标准 / 减弱" replace any 经典 / 玻璃 switch (rec.).
6. **D6 Header:** large title on root tabs + floating title capsule on scroll / on sub-pages (rec.) vs today's
   full-width compact bar.
7. **D7 Changelog page:** pin as-is (rec., per brief) vs let it inherit the new panels.
8. **D9 Frozen pieces and the customiser:** frozen pieces ignore user glass settings for now (rec.; zero regression
   risk), vs a follow-up where the tab bar and lookup read the same variables as multipliers that equal 1.0 at
   default (pixel-identical by default, then user-tunable). Library and shadow sheet stay fixed in either case.

(D8 density is now settled by O2: panels inset 12, gaps 16/28, padding 16, rows 56.)

---

## 11. Mockup plan (after approval)

`docs/superpowers/design/liquid-glass-v1/mockup.html`, 390×844 frames, light + dark, each "current | new" side by side,
with toggles for `html.lite`, reduced transparency, no-`backdrop-filter`, and the three presets (清透 / 磨砂 / 实色):

1. **Practice home** new layout, at rest and scrolled (large title → floating capsule, studio hero, tab bar).
2. **Chat list + conversation page** (continue hero, floating 新对话 pill; bubbles, composer, a T3 sheet open: 3 + 1 blur).
3. **Wordbook home + one quiz question** (今天 hero, teal removal, option states correct/wrong).
4. **Me** new layout (profile hero with stat wells, regrouped panels, logout).
5. **外观与主题** customiser page with working sliders driving the whole mockup's variables (the live preview is the
   point of the mockup), including the floor stop and the reduced-transparency note.
6. **Component sampler:** elevation E0/E1/E2 + well, buttons, chips, segmented, input + error, dialog, toast, empty
   state, banner; rooms lobby as a bonus frame if time allows.

## Rev 3 — owner approval (2026-10-15)

The owner approved the proposal with all recommendations in §"Decisions for the owner" (accent stays cobalt, wordbook teal dropped, own chat bubbles dark grey, default background = grey gradient, development switch then on for everyone with the settings page replacing any classic/glass option, big title that shrinks on scroll, 更新日志 page unchanged, tab bar and lookup ignore the glass sliders for now), plus one addition:

- **The page background colour is freely switchable in the theme settings** (主题自定义 → 背景): the user picks the background themselves. Design it as: a curated set of calm swatches (neutral greys, warm/cool greys, a few muted tints — all low-saturation so text contrast holds), a custom colour picker (hue + lightness, saturation capped), a 'background style' choice (gradient / grain / solid) and an optional second colour for the gradient; the glass tiers read the chosen background through the existing CSS variables, text/ink colours adapt automatically (light/dark per luminance), and the accessibility floor (minimum tint + contrast check) still applies to every chosen colour: if a chosen colour would break AA contrast for body text the UI clamps lightness and shows a short hint. Stored device-locally, cleared at logout, reset restores the default grey gradient. The 跟读库 keeps its own background regardless.
