# Liquid glass v1: component picks and design notes

Mockup: `docs/superpowers/design/liquid-glass-v1/mockup.html` (single self-contained file: no network, no fonts, no
images, inline lucide SVG). Spec: `docs/superpowers/specs/2026-10-15-liquid-glass-overall-design-proposal.md` (Rev 3,
approved). Status: design only. No source changes.

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
  capsule, composer, 新对话 FAB, tab bar; T3 sheets). Wells (−1) sit inside panels. No E1 inside E1.
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
- **Blur budget per frame (live counter in each frame header):**
  - Theme page: 2 at rest, 3 after scroll (capsule + preview bar + tab bar).
  - Practice, wordbook, Me: 1 at rest, 2 after scroll.
  - Chat list: 2 at rest, 3 after scroll (capsule + FAB + tab bar).
  - Conversation: 3, plus 1 transient T3 sheet (toggle button).
  - All frames stay ≤ 3 resident + 1 transient. Lite caps blur at 12px; reduced transparency gives 0.
- **Contrast (default 磨砂, default backgrounds; the live table is in the mockup, section D):**
  - E1 panels pass AA:
    - light mode: ink 17.6:1, ink-2 5.9:1
    - dark mode: ink 14.4:1, ink-2 6.9:1
  - E2 under the strict worst case (alpha composited over a solid black backdrop in light mode, solid white in dark
    mode, ignoring blur):
    - light mode: ink 6.9:1, but ink-2 only 2.3:1
    - dark mode: ink 3.8:1, ink-2 1.8:1
  - So the proposal's §2.6 claim ("floors guarantee 4.5:1 worst case") does **not** hold for secondary text on
    chrome. In practice the 24px blur averages a large area, so this only bites over big uniform dark or bright
    blocks under the bar (see Q4).

## New layout vs restyle

- New layouts (§5.2): practice home, chat list, wordbook home, Me, and the new 外观与主题 page.
- Restyle: the conversation page. The structure is unchanged; the title becomes a capsule, the composer floats,
  AI bubbles are E1 and the user's own bubbles are graphite.
- Frozen and drawn as-is: the floating tab bar.

## Open for the owner

1. Approve the 14 picks and their use / adapt / skip calls.
2. Background storage: one background per colour mode (this mockup), or a single shared one.
3. The swatch list (names and values are in the mockup's `SW` table).
4. E2 worst case for secondary text. Options:
   - Keep secondary text off chrome: capsules show only the 17px title and icons, and the composer hint sits in a
     well. This is what the mockup does.
   - Raise the T2 floors.
   - Accept it, since blur averages out the patches.

   Recommendation: the first option, written down as a rule.
5. 新对话 FAB as E2 (the 3rd resident blur on the chat list), or as E1 (no blur).
6. The proposal's mockup plan also lists a wordbook quiz frame and a component sampler (dialog, toast, banner). They
   are not in this mockup; add them in v2 if wanted.

Unverified: everything was checked only in desktop Chromium (Browser pane, 1500×950, light and dark, sliders,
presets, lite, reduced transparency; no console errors). Real-device blur quality, frame rate on low-end Android,
iOS Safari flicker and outdoor legibility of custom backgrounds have not been checked.
