# Liquid glass v2: component picks, rules and design notes

Mockup: `docs/superpowers/design/liquid-glass-v2/mockup.html`. It is a single self-contained file: no network, no
fonts, no images, inline lucide SVG. v1 (`../liquid-glass-v1/`) is kept unchanged for comparison.

Spec: `docs/superpowers/specs/2026-10-15-liquid-glass-overall-design-proposal.md` (Rev 3, approved). Status: design
only, no source changes.

## Owner decisions on v1 (2026-10-15)

1. The 14 picks and their use / adapt / skip calls are **approved** (table below).
2. Each colour mode keeps its **own background** (light slot and dark slot).
3. The swatch list is approved: 8 light and 8 dark swatches, saturation ≤ 30%. Values are in the mockup's `SW` table.
4. **Rule 4 is a hard rule** (next section).
5. The chat-list 新对话 button becomes an **unblurred** floating panel.
6. v2 adds the wordbook quiz screen (after the answer) and a shared-component sampler.

## RULE 4 (hard rule for the implementation): blurred layers carry only titles and icons

- A blurred layer is anything with `backdrop-filter`: `mat-chrome` (title capsule, composer, session dock) and
  `mat-sheet` (bottom sheet, dialog, menu). On such a layer, text may appear directly **only** as a title of 17px or
  more at weight ≥ 600, or as an icon of 20px or more. The worst-case target for these is ≥ 3:1 (proposal §2.6).
- Every other piece of text on a blurred layer sits on a **plate**: a recessed well with a **fixed** fill. That
  covers sentences, hints, labels, list rows, form fields, secondary text and button labels.
  - Fill: `--plate`, `rgba(255,255,255,.90)` in light mode and `rgba(23,25,30,.90)` in dark mode.
  - Edge: `inset 0 0 0 .5px var(--hair-2)` plus a faint inner shadow.
  - Corners: concentric radius (layer radius − 8).
  - The plate is **not** driven by the transparency slider. Under reduced transparency it becomes `--surface`.
- Worst case on a plate (solid black or white backdrop, blur ignored):

  | | ink | ink-2 |
  |---|---|---|
  | Light mode | 14.8:1 | 4.9:1 |
  | Dark mode | 12.0:1 | 5.7:1 |

  Bare glass, by comparison, gives ink-2 only 2.3:1 on light E2 and 1.8:1 on dark E2. That is why rule 4 exists.
- Things that are mostly text **do not blur at all**:
  - Toasts: a plate-filled pill.
  - The announcement banner: an E1 panel with a 16px amber icon. This differs from the proposal's "T2 strip".
  - The 新对话 floating panel: E1 material with an E2 shadow, fill ≥ .86.
- How each blurred element applies the rule:
  - Title capsule: title and icons only, never a subtitle.
  - Composer: the hint row and 按住说话 are plates; the icon buttons are bare.
  - Session dock: the secondary button is a plate pill, the primary is solid accent.
  - Sheets and dialogs: an 8px glass bezel around a plate that holds the content. The title and close icon sit on
    glass.
  - Any blurred element that carries glyphs uses the **bar floor** (light .62 / dark .58).
- Test idea for the plan: extend `styles/glass-budget.test.ts` to check that `mat-chrome` / `mat-sheet` components
  render no text node outside a `.plate` other than their title slot. A lint-style check on the component files is
  enough.
- The frozen tab bar is exempt: its own halo rule is already approved.

## How the reactbits.dev research was done (be honest)

- I browsed reactbits.dev in the Browser pane on 2026-10-15 and read the full component list from the sidebar.
  For about 25 candidates I read each page's description and its "Customize" controls (they show what the effect
  does, for example Glass Surface's distortion, chromatic offsets and renderer choice). Screenshots of the demos
  **timed out**: the WebGL demo pages did not finish rendering in the pane. So I judged the visuals from the
  descriptions and controls, plus what I already knew about these components, not from watching the demos.
- I did **not** open the "Code" tab. After the owner said licensing was fine, I tried to open it for dependency
  notes, but the session's permission classifier blocked it. Every effect in the mockup is my own CSS/JS, and **no
  reactbits code is in this repo**. The dependency column below is from memory and is **unverified**. The
  implementation plan should check each one before porting.
- No npm dependency is proposed. Every pick below works with plain CSS, plus a few lines of JS where noted.

## Shortlist (14)

| # | Component (reactbits category) | Why it fits | Perf cost | Repo equivalent | Call | reactbits deps (unverified) |
|---|---|---|---|---|---|---|
| 1 | Glass Surface (Components) | Source of the three depths E1/E2/T3. Frosted only; drop the SVG displacement refraction (Chromium-only; Safari/Firefox need WebGL plus a backdrop image) | E1: 0 blur. Each E2/T3: 1 `backdrop-filter` | `fx/GlassSurface` (`.lib-glass`, library only) | **adapt** | none (SVG filter / WebGL path) |
| 2 | Glass Icons (Components) | Mono glass icon: white gradient, rim and inner shadow, ink icon. For empty states and onboarding. List rows keep flat circle wells (§5.1) | CSS only, 0 blur | none (`IconChip` is a flat tinted chip) | **adapt** | unknown; the refraction/dispersion props suggest a shader. We take none of it |
| 3 | Magic Bento (Components) | Keep only the cursor edge light that also lights neighbouring tiles. Used on the wordbook half panels. Drop stars, tilt, magnetism, click wave | `pointermove` writes 2 CSS vars; 0 blur; off under lite / reduced transparency | `fx/SpotlightCard` (add an edge variant) | **adapt** | gsap (~25 kB gz). Not needed |
| 4 | Spotlight Card (Components) | A faint white light that follows the finger on hero panels while pressed | no rAF, CSS vars only | `fx/SpotlightCard` | **use** | none |
| 5 | Pill Nav (Components) | Segmented control: pill well track with a sliding white thumb and a slight overshoot | transform only | `components` SegmentedControl (restyle) | **adapt** | gsap. Not needed |
| 6 | Elastic Slider (Components) | Stretch-and-rebound feel for the customiser sliders | transform only | `fx/ElasticSlider` (stepped). The customiser needs continuous values: ship a native range with a glass thumb first (§6.4), elastic is optional | **use** | motion (~30–40 kB gz). Not needed |
| 7 | Gradual Blur (Animations) | Bottom-of-list fade. On new pages, default to mask fade only (0 blur) so the budget stays free for the capsule and composer | real blur = 1 layer; mask = 0 | `fx/GradualBlur` | **adapt** | older versions used mathjs. Not needed |
| 8 | Fade Content / Animated Content (Animations) | Section entrance: opacity + 10px rise, staggered 60ms, **no blur** | opacity/transform once | gate in `fx/motion.ts` | **adapt** | gsap. Not needed |
| 9 | Blur Text (Text Animations) | Word-by-word unblur, only for an empty-state line or first-run onboarding. Not on large titles (too busy on every tab switch) | animates `filter`, so keep word count small; off on lite | `fx/BlurText` | **adapt** | motion. Not needed |
| 10 | Count Up (Text Animations) | Stat wells and due counts roll to the new value | rAF ~0.9 s, once | `fx/CountUp` | **use** | motion. Not needed |
| 11 | Noise (Animations) | The "颗粒" (grain) background style: static SVG `feTurbulence` tile (~400 B data URI), rasterised once; no 24 fps canvas | static, 0 rAF; lite falls back to gradient | none | **adapt** | none (canvas) |
| 12 | Glare Hover (Animations) | One diagonal sheen across the primary pill on press/hover. No loop (the looping `SpecularButton` stays library-only) | one pseudo-element transform | `fx/SpecularButton` (looping variant) | **adapt** | none |
| 13 | Animated List (Components) | Rows spring in, and the selection highlight glides to the tapped row. Only for short lists in sheets (switch book, pick persona) | transform only; not for long lists | none | **adapt** | motion. Not needed |
| 14 | Dock (Components) | Magnification needs hover, which phones lack. The frozen floating tab bar already covers this | n/a | `glass-tab-bar.tsx` | **skip** | motion |

Also looked at and skipped:
- Counter (rolling digits): 10 DOM nodes per digit.
- Fluid Glass, Reflective Card, Holo Card: WebGL/three or a camera feed.
- Scroll Stack: pinned scroll plus scaling.
- Grainient, Dither, Silk, Soft Aurora, Aurora: animated colour or WebGL. The library keeps its own CSS aurora.
- Dot Grid: cursor physics.
- Card Nav / Gooey Nav: menu metaphors we don't use.

## Design decisions (aligned with proposal Rev 3)

- **Aesthetic:** restrained porcelain/graphite glass. Near-monochrome ink scale (`--ink` #111318 / #F3F4F6 and
  `--ink-2` #5B6170 / #A6ABB8, neither pure black nor pure white). Depth comes from rim, inner highlight and wide
  faint shadows. No hard borders, no tinted cards.
- **Accent:** cobalt #2456DB / #8FB0FF only (Rev 3 D1). It appears on one filled primary pill per screen, the
  progress arc/bar, switch-on, selected segment text, the unread dot and links. The owner's shortlist idea of
  "muted or pure ink" was settled by Rev 3 in favour of cobalt, so it matches the frozen tab bar, lookup and library.
- **Elevation:** E0 base (page background) → E1 section (T1 `mat-surface`, **never blurs**) → E2 floating (title
  capsule, composer, session dock, tab bar; T3 sheets and dialogs). v2: the 新对话 panel and toasts float without blur. Wells (−1) sit inside panels. No E1 inside E1.
- **Radii:** panels 26, tiles/half panels/bubbles 22 (tail 8), composer 26, sheets 32, dialogs 30, field 20. Pills
  and circles never scale. All other radii are `base × --gx` (0.5–1.3; presets 紧凑 0.6 / 标准 1 / 圆润 1.25). Tab
  bar stays 28.
- **Layout:** panels inset 12px from the screen edges, 16px gaps, 28px between groups, 16px padding. Section titles
  sit inside panels. Only the large title and subtitle sit on E0. Root tabs: a large title, plus a floating E2
  title capsule (44px, inset 12) after 60px of scroll. Sub-pages: the capsule is always there and turns to glass
  after 4px of scroll.
- **Customiser (§6.1 model):** 透明度 (transparency) is a 0–100 slider (tint factor 1.35 → 0.55 on each tier's
  default). The other controls:
  - 模糊 (blur): 0–1.5 × 24/32 px.
  - 饱和度 (saturation): 1.0–2.0.
  - 圆角 (radius), 边缘高光 (rim highlight), 阴影 (shadow).
  - Presets 清透 / 磨砂 / 实色 (Clear / Frosted / Solid). Solid also sets the background to solid.
  - 玻璃效果 标准 / 减弱 (glass effect standard / reduced) forces `html.lite`.
  - Reset.

  Floors from §6.1: T1 .50 / .04, T2 .55 / .50, top bar .62 / .58, T3 .62 / .58, +.20 when blur < 8px, ≥ .80 under
  lite. The transparency slider shows "已到可读下限" (readability floor reached) when a floor clamps.
  Reduced transparency makes every tier solid and disables the glass sliders.
- **Background (Rev 3 addition):** each colour mode stores its own background (正在编辑 浅色/深色 toggle). It has:
  - 8 calm swatches per mode (saturation ≤ 30%).
  - Custom colour: hue, 浓度 (saturation, capped at 30) and lightness.
  - An optional second colour for the gradient's lower end.
  - A style choice: 渐变 / 颗粒 / 纯色 (gradient / grain / solid).

  The ink side (dark text or light text) is chosen automatically. The rule picks whichever side needs the smaller
  lightness change to keep `ink-2` ≥ 4.5:1 on the worse end of the gradient. The lightness is then clamped to that
  value, and a hint is shown, for example "亮度 55 → 25…" (lightness 55 → 25, to keep body text ≥ 4.5:1). Under
  the AA rule, light backgrounds need L ≥ ~89–91 and dark ones L ≤ ~25; all 16 swatches pass unclamped. The
  glass tiers read the chosen colour through `--page-top/--page-bottom/--page-flat`.
- **Blur budget per frame (live counter in each frame header; v2):**

  | Screen | At rest | After scroll |
  |---|---|---|
  | 外观与主题 (theme page) | 2 | 3: capsule + preview bar + tab bar |
  | Practice, wordbook, Me, component sampler | 1 | 2 |
  | Chat list | 1 | 2 (the 新对话 panel no longer blurs) |
  | Conversation | 3: capsule + composer + tab bar | 3 |
  | Quiz | 2 | 3: capsule + dock + tab bar |

  Transient layers (+1 each): the dialog, the bottom sheet, and the conversation's sheet toggle. A toast adds 0 (it
  does not blur). All frames stay ≤ 3 resident + 1 transient. Lite caps blur at 12px; reduced transparency gives 0.
- **Contrast (default 磨砂, default backgrounds; the live table is in the mockup, section D):**
  - E1 panels:
    - light mode: ink 17.6:1, ink-2 5.9:1
    - dark mode: ink 14.3:1, ink-2 6.9:1
  - Bare E2/T3 in the strict worst case: ink-2 2.3–2.8:1 (light) and 1.8–2.3:1 (dark). Solved by rule 4.
  - Plates: ink-2 4.9:1 (light) and 5.7:1 (dark).
  - Capsule title, 17px, at the default bar fill: 9.9:1 (light) and 5.6:1 (dark). At the dark bar floor .58 it is
    about 3.8:1, which still meets the proposal's ≥ 3 rule for large text.

## New layout vs restyle

- New layouts (§5.2): practice home, chat list, wordbook home, Me, the 外观与主题 page, and the wordbook quiz
  (choice question, after the answer).
- New shared components (sampler):
  - Banner and maintenance page.
  - Buttons: primary, secondary, destructive, small, disabled, icon.
  - Chips, badges and score dots.
  - Segmented control.
  - Inputs: placeholder, focus, error, multiline.
  - List rows and empty state.
  - Dialog with toast, and a bottom sheet with a form.
- Restyle: the conversation page. The title becomes a capsule, the composer floats, AI bubbles are E1 and the
  user's own bubbles are graphite.
- Frozen and drawn as-is: the floating tab bar.
- Quiz states:
  - Correct option: ink 1.5px border, filled check in the letter circle, and a green "正确" mark (icon + word).
  - The user's wrong pick: red ✕ and "你的选择", with the option text dropped to ink-2.
  - Other options: unchanged.
  - Study panel: an EN / 中文 segmented control (中文 selected), showing definitions, phrases and examples with
    their translations.
- Destructive confirm (重置单词进度): a solid red pill. This follows proposal §2.4, which allows red fill only here
  and on the hang-up key.

## Open for the owner (v2)

1. **Plate visibility.** Under 清透, plates look clearly more solid than the surrounding glass. Recommendation:
   accept it, because legibility comes first.
2. **Dark capsule title floor.** It is about 3.8:1 in the worst case, which meets ≥ 3. Should titles also reach
   4.5? That needs a dark bar floor of about .72. Recommendation: no.
3. **Announcement banner.** The proposal says it is a T2 glass strip. Under rule 4 it carries sentences, so v2 makes
   it an unblurred E1 panel. Please confirm.

Unverified: v2 was checked only in desktop Chromium (Browser pane, 1500×950):
- All 20 frames render in light and dark.
- Live blur counters are as listed above.
- Presets, 清透, lite and reduced transparency work.
- The contrast table updates live.
- No console errors.

Real-device blur quality, low-end Android frame rate, iOS Safari flicker and outdoor legibility of custom
backgrounds have not been checked.
