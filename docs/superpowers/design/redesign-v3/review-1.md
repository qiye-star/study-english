# Redesign v3 — review 1

Reviewed: `mockup.html` + `design-notes.md`, rendered in the browser pane (7 frames, 375×812), with
contrast ratios, hit areas and a 667px-high call frame measured in JS.

**Verdict: needs changes.** The direction is right: restrained, not AI-flavored, and the dark mode
is real work rather than an inversion. There are two rendering bugs, the call screen breaks on short
phones, and the semantic color mapping contradicts itself in four places.
Severity count: **must 4 · should 6 · nice 2**.

## Keep these (do not lose them in the next round)

1. **Palette values and discipline.** Deep, slightly desaturated cobalt `#2456DB`, teal `#0E7067`,
   amber `#9A4B00` and green `#157A3B` on 5–6% tints all clear AA (tint pairs measured 4.8–5.6:1;
   dark-mode pairs 6.3–7.2:1). There are no gradients on UI, no glow, no emoji, and red appears only on
   hang-up/logout. This is the fix for v2's monotone and should stay.
2. **Dark mode built as its own palette.** `#0F1013` bg / `#17191E` surface, raised semantic hues,
   14%-alpha tints, active call keys `#8FB0FF` with a dark glyph (8.9:1). The dark Me and Chat frames
   are the most finished-looking screens in the set.
3. **Restrained component vocabulary.** 0.5px hairlines instead of shadows, 12/14px radii, 44px icon
   buttons, a 52px call key row where hang-up matches its peers in size, and tabular numerals. Keep the
   hold bar as the single dominant composer control too, because it reads as WeChat without copying it.

## Issues

### 1. MUST: class collision makes call captions gray at 12px (rendering bug)
The canvas rule `.spec .cap{font-size:12px;color:#5b6170;margin:12px 2px 0}` (meant for the frame
captions) also matches the caption cards `.cap`. Measured: every caption card computes
`color:#5B6170; margin:12px 2px 0`. Two consequences:
- Light: the English line, which is the most important text on the call screen, renders as secondary gray.
- Dark: `#5B6170` on dark glass is **2.92:1**, a hard AA fail. It is also *dimmer* than the Chinese line
  below it, which inverts the hierarchy.

Fix: rename the canvas caption to `.spec > p.frame-cap`, or the card to `.caption`. Set explicitly
`.caption .en{color:var(--ink)}`, `.caption .zh{color:var(--ink-2)}`, `.caption{margin:0}`.
Re-screenshot both call frames afterwards, because the current images are not what you designed.

### 2. MUST: call screen collapses on a 667px device; the dock covers the live caption
I simulated a 375×667 frame (20px status bar, 12px dock bottom inset). The hero is 273px tall and the
dock is 149px tall, and the captions overlap the dock by **68px**. The live Emma line (the thing the
user is reading) sits under the glass, and that is with only two captions.

Fix:
- Make the call screen a flex column: `hero (flex:none) / captions (flex:1; min-height:0; overflow-y:auto;
  display:flex; flex-direction:column; justify-content:flex-end) / dock (flex:none)`. Captions then
  bottom-anchor above the dock and older ones scroll away upward. Do not position the dock absolutely
  over the content. Add `mask-image: linear-gradient(to bottom, transparent 0, #000 24px)` to the
  caption list top edge.
- Add `@media (max-height:700px)`: avatar 96→64px, rings off, h2 22→17px, level bar folds into the
  subtitle line, hero padding-top 122→64px. That frees about 90px.
- Compress the dock to one control row plus a slim mode row. Mode row height 32px with no `.lbl` text
  (the segmented control is self-explanatory), dock padding `8px 10px 10px`, gap between rows 6px.
  Target dock height ≤ 124px, measured at 149px today.
- Add a 375×667 frame of the call screen to the mockup as proof.

### 3. MUST: semantic color mapping contradicts itself
The notes promise "color is never decorative, every hue owns a meaning". The mockup breaks that in four places:

| Conflict | Where |
|---|---|
| Teal = AI partner (chat avatar "E") **and** = "you" (call caption eyebrow 你) | Chat vs Call |
| Same Emma: teal avatar in chat, blue avatar in call | Chat vs Call |
| Scores: 发音 92 green, 流利 88 **blue**, 平均发音 88.4 green, but notes say "green = score ≥ 85" | Chat badges / Me |
| Swatch row says "琥珀 · 目标" but the goal ring, goal bar and week grid are all blue; amber is streak/hint/grammar | Canvas swatches vs screens |

Fix (one meaning per hue):
- **blue** = primary action, active state, the user ("you" bubble, "你" caption eyebrow, goal progress).
- **teal** = vocabulary only. The partner avatar becomes neutral: `background:var(--surface-2); color:var(--ink)`,
  the same in chat and call.
- **green / amber** = a score scale for *every* score: ≥85 green, 70–84 amber, <70 `--ink-2`. Do not use
  red, which stays reserved for hang-up and logout. So 流利 88 becomes green. The grammar count badge
  becomes neutral (`surface-2` / `ink-2`) because it is a count, not a score.
- **amber** = streak + hints + highlighted target words. Fix the swatch label to "琥珀 · 连续/提示".

### 4. MUST: hit areas below 44px on the controls people tap most
Measured: `.seg span` **32px** tall (call dock mode toggle and voice card, used mid-call with one
hand); `.h-sec a` "历史记录 / 全部 24" **18px**; Me goal "15 分钟 ›" **18px**; "更换" **26×18px**;
hint chip **36px**; bubble actions 40px with 2px horizontal gaps.

Fix:
- seg: keep the 32px visual pill but give the track `padding:6px 3px` so the hit row is 44px, or use
  `::before{inset:-6px 0}`.
- Text links (`.h-sec a`, goal "15 分钟 ›", "更换"): `min-height:44px; padding:0 8px; margin:-13px -8px`
  so layout is unchanged.
- Hint chip: 36→44px tall (or see #6).
- Bubble actions: 40→44px, with gap 2→4px.

### 5. SHOULD: glass has nothing to refract at rest, and the wash breaks "pure white"
In the screenshots the Practice/Me top bars read as a slightly lavender band with a hairline. They sit
over a smooth 10%-blue gradient, and blurring a smooth gradient produces the same gradient, so there
is no visible frost. The wash also makes the top 260px `≈#E9EEFB`, which is no longer the pure white
page the brief asked for. On the call screen the teal disc (10% alpha, 60px blur) is invisible in light
mode. In dark mode it reads as a faint green glow, the beginning of an "orb" tell. The caption cards
look like plain white cards with a border.

Fix:
- Remove `.wash.top` on Practice, Me and Chat, so the page is `#FFFFFF`.
- Top bars: transparent with no border at rest, then glass (`rgba(255,255,255,.72)`, blur 20, saturate
  1.8) and hairline once `scrollTop > 4`, as iOS large-title bars do. Glass is then honest: it only
  appears when real content (colored chips, amber highlights, score numerals, blue user bubbles) passes
  under it. Add a **scrolled-state frame** of Practice home showing the list under the top bar to prove it.
- Tab bar and composer stay glass permanently, because content always passes under them.
- Call: keep `.wash.a` (blue radial, it marks "live" mode); delete `.wash.b`.
- Caption cards: drop backdrop-filter and use `background:var(--surface); border:.5px solid var(--hair)`.
  They have nothing behind them, and dropping blur there is also a performance win (see #10).

### 6. SHOULD: hint chip floats over messages
In both chat frames the chip sits on top of "Hot, please. And one almond croissant." because the
chip's top edge is 8px inside that bubble. The mockup is also top-anchored, so the last AI message
("That'll be $7.40") is hidden behind the composer. A real chat is bottom-anchored.

Fix: dock the hint into the composer glass as a 32px row above the input row (`padding:6px 8px 0`,
left-aligned, amber icon + "提示 · 3 句可用", 44px hit area via padding). It never overlaps a bubble
then. Re-lay the frame bottom-anchored so the newest message ends 12px above the composer.

### 7. SHOULD: Me page is incomplete for a learning app
Missing:
- **外观 (浅色 / 深色 / 跟随系统)**. Dark mode is a deliverable, so there must be a switch.
- **学习提醒** (daily reminder on/off + time), the main retention lever behind a daily goal and a streak.
- **账户** (username, change password, server address `enjoy.example.com` as a tappable row rather than
  fine print).
- **数据** (export history, clear cache), plus **关于 / 版本 / 反馈**.

Fix: groups in this order: 学习 (进度, 词汇本, 每日目标 moved here as a row) → 语音 → 通知 (学习提醒) →
通用 (外观, 语言) → 账户与服务器 (账户, 服务器地址, 服务器语音服务) → 关于. The goal card is duplicated on
Practice home, so on Me collapse it into the week strip only (see #8) plus a "每日目标 15 分钟 ›" row.

### 8. SHOULD: week grid is the heaviest element on Me and contradicts the streak
There are six 28×28 solid-blue squares, darker and larger than anything else on the page, and the eye
lands there before on the profile. The data also disagrees with itself: streak "12 天" while 日
(three days ago) is empty.

Fix:
- Squares 28→20px, radius 6.
- Done days `--blue` at 100% only for today-if-done. Past done days use `--blue-tint` with a 1px
  `--blue` inner check icon (12px), and missed days use `--surface-2`.
- Fix the data: either fill 日 or change the streak to 3 天.

### 9. SHOULD: Practice home first card wraps and its numerals are unclear
The "12 天" streak badge wraps inside its fixed 22px height (measured 57×22 with two lines of text
overflowing). The goal subtitle wraps to two lines (34px). "9′" uses a prime mark, which reads as feet
or arcminutes, not minutes.

Fix:
- `.badge{white-space:nowrap;flex:none}`.
- Shorten the subtitle to "已完成 9 / 15 分钟".
- Ring center: "9" at 15px/600 with "分" at 10px below, or show "60%".
- Remove the top-bar history icon: "最近评分 › 历史记录" already covers it, and two entry points to the
  same place is noise.

### 10. SHOULD: performance and fallbacks for backdrop-filter (iOS Safari / low-end Android)
The call screen stacks 5+ blurred layers (status pill, 2+ caption cards, dock, plus seg pill), some over
animating content (breathing ring, caret). Each blurred layer over animated pixels re-rasterizes every
frame, which causes jank on 4GB Android devices. Recipe for implementation (Tailwind 3.4, autoprefixer
already in `web/postcss.config.cjs`, so the `-webkit-` prefix is emitted):

```css
/* tailwind: bg-white/[.94] supports-[backdrop-filter]:bg-white/[.72]
             supports-[backdrop-filter]:backdrop-blur-[20px] supports-[backdrop-filter]:backdrop-saturate-[1.8] */
.glass{background:rgba(255,255,255,.94)}
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .glass{background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8)}
}
@media (prefers-reduced-transparency:reduce){ .glass{background:var(--surface);backdrop-filter:none;-webkit-backdrop-filter:none} }
html.lite .glass{ /* set when navigator.deviceMemory <= 4 or hardwareConcurrency <= 4 */
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);background:rgba(255,255,255,.86)}
```

- Limit to **≤ 3 blurred layers per screen**: top bar, bottom bar/composer/dock, and one transient (sheet).
- Never put `backdrop-filter` inside an ancestor with `opacity<1`, `filter`, or `overflow:hidden +
  transform`. iOS drops or flickers the blur in those cases.
- Never animate the blurred element itself; animate its children's `opacity`/`transform` only.
- 0.5px borders round to 1px on DPR-1/1.5 Android. Use `box-shadow: inset 0 -0.5px 0 var(--hair)`
  (Tailwind `shadow-[inset_0_-0.5px_0_var(--hair)]`), which degrades more gracefully than `border-[0.5px]`.
- Expose tokens as `rgb(var(--blue) / <alpha-value>)` in `tailwind.config.cjs` so tints and dark
  overrides stay one source of truth.

### 11. NICE: chat composer helper line is permanent noise
"上滑取消 · 松开发送 · 自动朗读 已开" sits under the hold bar all the time. WeChat shows the cancel hint
only *while* the bar is pressed. Fix: show it only in the pressed state, as an overlay above the bar.
Move the auto-read state to the top-bar adjustments sheet, and show it as a small blue dot on the
`ti-adjustments` icon when on. That frees 19px.

### 12. NICE: call header has two exits, and the dark off-keys float
The top-right ✕ beside a red hang-up key is ambiguous (end? minimize?). Use `ti-chevron-down` = "最小化"
and keep hang-up as the only way to end the call. In dark mode the off-state keys (`#17191E` on dark
glass) are 1.03:1 against the dock and are carried only by a 14% hairline. Use
`background:rgba(255,255,255,.08)` for `.phone.dark .ctl .k`.

## Measurements (for reference)

| Pair | Ratio |
|---|---|
| ink-2 `#5B6170` / white · / surface-2 · / blue-tint | 6.20 · 5.73 · 5.43 |
| blue / blue-tint · teal / tint · amber / tint · green / tint | 5.37 · 5.27 · 5.55 · 4.81 |
| red `#D1242F` / white (logout) | 5.24 |
| white glyph / `#E0313C` hang-up (graphic, needs 3:1) | 4.49 |
| dark: ink-2 / bg · ink-3 / bg | 8.28 · 4.06 (ink-3 must stay non-text) |
| dark: blue · amber · teal · green on their 14% tints | 6.33 · 7.06 · 7.19 · 7.21 |
| **dark caption text (bug #1)** | **2.92** |
| light chevron ink-3 `#8A90A0` / white (graphic) | 3.19 (passes 3:1) |

Hit areas: icon buttons 44×44, call keys 52×52, tabs 124×56, list rows ≥56, hold bar 257×44,
primary buttons 48 tall all pass. Failures are listed in #4.
