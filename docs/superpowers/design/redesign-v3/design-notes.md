# Redesign v3 — design notes (rev 2, after review-1)

Mockup: `mockup.html`. Frames: Practice home at rest + scrolled, Chat, Call 375×812, Call 375×667,
Me; dark Call / Me / Chat. Measured in the browser pane: dock 124px, captions end ≥10px above the
dock on both call heights, caption text = `--ink`, text links / bubble actions 44px.

## Why this direction

- v1 (cream + teal) felt dated; v2 (white + black/gray + one red) read as monotone.
- v3 keeps the **pure white page** (no washes on Practice / Chat / Me) and **frosted glass chrome**,
  and adds a small *semantic* palette where every hue owns exactly one meaning.
- Glass is honest: top bars are transparent at rest and become glass + hairline only once content
  scrolls under them (`scrollTop > 4`). Tab bar, composer and call dock are always glass because
  content always passes beneath them. The call screen keeps one radial blue wash to mark "live".

## Color — one meaning per hue

| Token        | Light     | Dark (on #0F1013) | Meaning                                              |
|--------------|-----------|-------------------|------------------------------------------------------|
| `--bg`       | #FFFFFF   | #0F1013           | page                                                 |
| `--surface`  | #FFFFFF   | #17191E           | cards, lists, bubbles, caption cards                 |
| `--surface-2`| #F5F6F8   | #1E2127           | tracks, neutral chips, partner avatar                |
| `--ink`      | #111318   | #F3F4F6           | primary text (incl. call English captions)           |
| `--ink-2`    | #5B6170   | #A6ABB8           | secondary text; score < 70                           |
| `--ink-3`    | #8A90A0   | #6E7482           | chevrons only (3.19:1 graphic), never text           |
| `--hair`     | rgba(17,19,24,.12) | rgba(255,255,255,.14) | hairlines (inset box-shadow in code)      |
| `--blue`     | #2456DB   | #8FB0FF           | primary action, active state, **the user** (bubble, 你 caption), goal progress |
| `--teal`     | #0E7067   | #5FD1C4           | vocabulary only                                      |
| `--amber`    | #9A4B00   | #F2B056           | streak, hints, reminder, highlighted target words; score 70–84 |
| `--green`    | #157A3B   | #6FD39A           | score ≥ 85, live status dot                          |
| `--red`      | #D1242F   | #FF7B7B           | hang-up label, logout text                           |
| `--red-solid`| #E0313C   | #E0313C           | hang-up key fill (white glyph, 4.49:1)               |
| `--key`      | #FFFFFF   | rgba(255,255,255,.08) | off-state call keys                              |

Tints (light): blue #EAF0FF, teal #E3F5F2, amber #FFF0DE, green #E4F6EA. Dark tints = hue at 14%
alpha. The conversation partner (Emma) is neutral (`surface-2` / `ink`) in chat and call alike.
Score scale applies to every score (发音, 流利, 最近评分, 平均发音); counts (语法 1 处) are neutral.

## Glass recipe (with fallbacks)

```
.glass{background:rgba(255,255,255,.94)}                       /* no backdrop-filter support */
@supports ((-webkit-backdrop-filter:blur(1px)) or (backdrop-filter:blur(1px))){
  .glass{background:rgba(255,255,255,.72);                      /* dark: rgba(23,25,30,.66) */
         -webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8)}
}
@media (prefers-reduced-transparency:reduce){.glass{background:var(--surface);backdrop-filter:none}}
html.lite .glass{backdrop-filter:blur(12px);background:rgba(255,255,255,.86)}  /* deviceMemory ≤ 4 */
```
Rules: ≤ 3 blurred layers per screen (top bar, bottom bar/dock, one transient sheet); never blur
inside an ancestor with `opacity<1` / `filter` / `overflow:hidden + transform`; never animate the
blurred element, only its children. Hairlines as `box-shadow: inset 0 -0.5px 0 var(--hair)`.
Tailwind: expose tokens as `rgb(var(--blue) / <alpha-value>)` so tints and dark overrides share one source.

## Type

System stack: -apple-system / SF Pro / PingFang SC / Inter / Noto Sans SC.
Scale: 11 (tab labels, eyebrows), 12 (meta), 13 (secondary), 15 (body), 17 (bar title, reference
text, short-device call name), 22 (username, call name), 28 (stat numbers), 34 (call avatar initial).
Tight tracking on headings and numerals (-0.015 to -0.03em); eyebrows +0.06em uppercase.
`tabular-nums` on every number. Line height 1.4 body, 1.5 dialogue and captions.

## Radius, spacing, touch, safe area

Radius: 6 (inline, week cells), 10 (badges, segmented), 12 (buttons), 14 (cards, bubbles, lists),
20 (sheets), 28 (call dock), 50% for avatars and call keys only.
Spacing: 4pt grid; 16px gutters; 8px between sibling cards; 22px before section labels.
Touch: icon buttons 44; list rows ≥ 56; text links 44 (`min-height:44px; margin:-13px -8px`);
segmented pill 32 visual / 44 hit (`::before{inset:-6px 0}`); bubble actions 44 with 4px gap;
hint row 32 visual / 44 hit; hold bar 44; call keys 52, hang-up same size, red fill.
Safe area: 47px status / 22px home padding here; `env(safe-area-inset-*)` in code.

## Call screen layout

Flex column: `callhead (flex:none)` → `hero (flex:none)` → `captions (flex:1; min-height:0;
overflow-y:auto; justify-content:flex-end; mask-image top 24px)` → `dock (flex:none, 124px)`.
`@media (max-height:700px)`: avatar 96→64, rings off, name 22→17, level bar folds into the subtitle,
hero padding 24→8. Caption cards are solid `surface` + hairline (nothing behind them to blur).
Header right is 最小化 (chevron-down); hang-up is the only way to end.
Input modes: 自动 shows 免提 / 静音 / 翻译 / 更多 / 挂断. **按住说话** replaces the mic key with a 52px
hold-to-talk key (rest `blue-tint`/`blue`, pressed `blue` fill with white or #0F1013 glyph plus a 3px
blue ring; ring scale animates only under `prefers-reduced-motion:no-preference`) and hides 静音,
since the mic is closed whenever the key is not held. The dock segmented control keeps a
`surface-2` track (dark `rgba(255,255,255,.06)`) so the active mode is unambiguous.
Top bar glass uses `saturate(1.3)` at `.80` alpha (dark `.74`) so a primary button scrolling beneath
it does not bloom; tab bar / composer / dock keep `saturate(1.8)` at `.72`.

## Motion

Inside `@media (prefers-reduced-motion:no-preference)` only: avatar breathing rings (2.4s), live
waveform bars, caption caret. State changes in code: 150–200ms opacity/transform.

## Screen decisions

1. **Practice home** — goal ring ("9 分钟") + streak badge; reference card with amber target words;
   score strip on the score scale; list chips encode item source (chat blue / hint amber / progress
   neutral). History reachable only via 最近评分 › 历史记录.
2. **Chat** — bottom-anchored, newest message 14px above the composer. Composer = hint row (amber,
   inside the glass) + keyboard/voice toggle + hold bar + plus. Cancel hint appears only while
   pressed; auto-read state is a blue dot on the adjustments icon.
3. **Me** — profile + level; three stat cards; groups 学习 (进度 / 词汇本 / 每日目标 + 20px week strip)
   → 语音 → 通知 (学习提醒) → 通用 (外观 / 语言 / 提示词 / 主屏幕) → 账户与服务器 → 关于; logout as red text.

## Review response (review-1)

Accepted and fixed: #1 class collision (`.caption`, explicit colors); #2 flex call layout, short-device
rules, 124px dock, 667 frame; #3 one meaning per hue (blue = you, neutral partner, score scale,
neutral grammar count, swatch label); #4 all hit areas ≥ 44; #5 washes removed, rest/scrolled top
bar + scrolled frame, teal disc deleted, caption cards solid; #6 hint row docked in composer,
bottom-anchored chat; #7 Me groups incl. 外观 / 学习提醒 / 账户 / 服务器地址 / 关于; #8 week strip 20px
with check marks, data consistent with 12-day streak; #9 badge nowrap, subtitle, ring label, history
icon removed; #10 fallbacks + implementation recipe above; #11 helper line removed; #12 minimize
chevron, 8%-white off keys in dark.
Review-2: #1 PTT key replaces mic, 静音 hidden (dark call frame shows pressed state); #2 dock seg
track restored; #3 top-bar glass saturate 1.3 / alpha .80; #4 04b scrolled Me frame; #5 caption list
margin 8px + 40px fade; #6 `.hintrow.collapsed` (150ms) shown in the dark chat frame.
Disagree: review-1 #7 "数据 (导出历史 / 清除缓存)" — not added; no export or cache-clearing feature exists in
`web/`, and mocking a settings row for a feature that cannot ship would mislead the implementation.

## Addendum (2026-10-14) — floating tab bar

Owner request: the bottom bar becomes a fully transparent rounded glass. Plan `docs/superpowers/plans/2026-10-14-floating-glass-bottom-bar.md`, mockup `docs/superpowers/design/floating-glass-bar-v1/mockup.html` (approved: tab bar only, variant B 10% tint, halo kept). Only the tab bar changes: a floating pill inset 12px, bottom `max(10px, safe-area − 8px)`, radius 28 (`rounded-dock`), 64px tall, `.glass-float` = tint `--glass-float` (approved alpha 0.1, never below .06) + `blur(28px) saturate(1.8)` + 1px highlight border + soft shadow; labels and icons carry a halo (`--tab-halo`) because the tint no longer guarantees contrast; the active tab keeps a `--tab-on` pill. Fallbacks keep the shape: no backdrop-filter → `--glass-solid`; `html.lite` → blur 12 + .62; reduced transparency → solid surface + hairline, no halo. Composer, docks and the call dock keep the `.glass` recipe above (.72) and sit 8px above the pill via `--tab-bar-space`. Still one blurred layer for the bar; ≤ 3 per screen unchanged.
