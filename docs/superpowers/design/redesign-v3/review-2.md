# Redesign v3 — review 2

I re-checked rev 2 (`mockup.html`, 9 frames, plus `design-notes.md`) in the browser pane. Each frame
was screenshotted, and I measured these in JS: caption styles, call layout at 812 and 667,
backdrop-filter layer count, hit areas, a contrast sweep over all text nodes, and the score/badge classes.

**Verdict: needs changes (small).** All 4 musts and all 6 shoulds from review-1 are fixed. There is one
new functional gap (must) and one visual regression (should). Fix those two and this is approved;
the nice items can wait until implementation.

## Review-1 items: verification

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Caption class collision | Fixed | `.caption`, en = `#111318` light / `#F3F4F6` dark, 15px, margin 0, no blur |
| 2 | Call at 667 | Fixed | 667 frame: last caption bottom 520, dock top 530 (10px clear); 812: 643 vs 653. Dock 124px, avatar 64px on short |
| 3 | One meaning per hue | Fixed | Emma avatar `surface-2` in chat and call; 你 eyebrow blue; 流利 88 green; 语法 badge gray; scores 92/78/64 = green/amber/ink-2 |
| 4 | Hit areas | Fixed | seg 44 hit, `.link` 44, bubble actions 44 with 4px gap, hint row 32 visual / 44 hit |
| 5 | Glass / pure white | Fixed | No washes on Practice/Chat/Me; top bar transparent at rest (no bg, no hairline), glass in the 01b scrolled frame; teal disc gone; ≤ 2 blurred layers per screen |
| 6 | Hint chip overlap | Fixed | Hint row inside composer glass; chat bottom-anchored, last message 14px above composer |
| 7 | Me completeness | Fixed (with 数据 declined) | 通知/学习提醒, 通用/外观, 账户与服务器, 关于/版本/反馈 present. **Declining 数据 is accepted**: don't mock rows for features `web/` doesn't have |
| 8 | Week strip | Fixed | Tint cells with check icons, today outlined; 日 done, consistent with the 12-day streak |
| 9 | Practice first card | Fixed | Badge nowrap (22px, one line), subtitle one line (17px), ring "9 / 分钟", history icon removed |
| 10 | Fallbacks | Fixed | Recipe in notes (`@supports`, reduced-transparency, `html.lite`, ≤ 3 layers, inset hairlines) |
| 11 | Helper line | Fixed | Removed; auto-read shown as a blue dot on the adjustments icon |
| 12 | Exits / dark keys | Fixed | Header is `ti-chevron-down`; dark off keys `rgba(255,255,255,.08)` |

The contrast sweep over every text node (composited against its opaque background) found **0 failures**
in light or dark.

## New issues

### 1. MUST: "按住说话" mode has no hold-to-talk control
The dark call frame shows segmented = 按住说话 and the mic key = 已静音. There is nothing to press
and hold anywhere on the screen. "Muted" combined with "push-to-talk" is also contradictory, because in
PTT the mic is closed whenever you're not holding. This was latent in rev 1, but rev 2 is now the spec,
so it has to be resolved.

Fix: in PTT mode the second key *becomes* the hold target. Keep it 52px, label it "按住说话", use
`background:var(--blue-tint); color:var(--blue)` at rest and `var(--blue)` fill with a white (light) or
`#0F1013` (dark) glyph while pressed. Add a 3px `--blue` ring scale animation only under
`prefers-reduced-motion:no-preference`. Hide 静音 in PTT mode. Show the pressed state in the dark call
frame, or add a small inset.

### 2. SHOULD: call-dock segmented control lost its track (regression)
In the dock, `.seg` computes `background: transparent`, and the *off* segment is white with a 1px
border. Measured light: both spans `rgb(255,255,255)` + `1px solid rgba(17,19,24,.07)`. The result
reads as two separate buttons, not one control. In dark, the off segment is filled and the on segment
is only slightly brighter, so it is ambiguous which mode is active. The Me voice card seg is still correct.

Fix:
`.dock .seg{background:var(--surface-2)}` (dark: `rgba(255,255,255,.06)`),
`.dock .seg span:not(.on){background:transparent;border-color:transparent;box-shadow:none}`.
Keep the `::before` 44px hit extension.

### 3. SHOULD: scrolled top bar blooms the primary button into a blue orb
In 01b the reference card's `开始录音` button (`#2456DB`) sits under the bar. With
`blur(20px) saturate(1.8)` at `.72` alpha it becomes a soft, saturated blue blob in the top-right,
behind the status icons. That is physically honest, but it is exactly the "glowing orb" look the brief
bans, and it is the frame that is supposed to sell the glass.

Fix (top bar only; tab bar/composer can keep 1.8): `saturate(1.3)` with background `rgba(255,255,255,.80)`.
Dark: `rgba(23,25,30,.74)`. Re-shoot 01b with the same scroll position.

### 4. NICE: Me groups below the fold are never shown
The Me content is 1801px tall, but the frame shows only down to 语音. The new 通知 / 通用 / 账户与服务器 /
关于 groups, which were the main fix for review-1 #7, are invisible to anyone reading the mockup.
Add a `04b 我的 · 滚动后` frame (as done for 01b) scrolled to the bottom so logout and 关于 are visible.

### 5. NICE: oldest caption butts into the hero
At 812 the clipped oldest caption starts directly under the level bar. At 667 its faded text sits
right under the subtitle line, which looks like overlapping text. Fix: caption list
`margin-top:8px`, mask `linear-gradient(to bottom, transparent 0, #000 40px)` (24→40).

### 6. NICE: hint row is permanent
The composer is 118px including the 32px hint row. Collapse the row (0px, 150ms height/opacity) when
no hints are available or after the user dismisses it for the session. That gives the chat its 32px back.

## Still good, keep
Palette and one-meaning-per-hue mapping. The dark palette (now the strongest frames). The rest/scrolled
top bar behavior. The flex call layout with short-device rules. The 0.5px-hairline, no-shadow
component vocabulary.
