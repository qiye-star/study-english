# Liquid glass · device checklist (2026-10-15)

Everything here is UNVERIFIED: no item has been run on a real device. Sources: INDEX §10 point 4, §12 (K1-K10) and every
lane's "Device checklist" section. The skin is on for everyone since L12 (no `?glass` parameter); compare `/library` and
`/practice/changelog` with the classic look (they stay classic by design).

## iPhone (Safari and home-screen PWA)

- [ ] UNVERIFIED Sheet enter: no backdrop blur flicker (K3); open the chat settings sheet and the lookup sheet repeatedly.
- [ ] UNVERIFIED Status bar colour follows the chosen background in the standalone PWA (L1 theme-color), also after flipping the colour mode.
- [ ] UNVERIFIED Textarea well with radius 20 keeps the 16px font (no zoom on focus) on practice; login pill inputs keep 16px, and the page background reaches under the status bar.
- [ ] UNVERIFIED Keyboard open in a conversation: the floating composer (inset 8, bottom 8) sits above the keyboard (the `--app-height` fix is itself unverified).
- [ ] UNVERIFIED Room with the assist dock open and the keyboard up: dock and composer do not overlap; at most 3 blur layers.
- [ ] UNVERIFIED Capsule fade with blur when scrolling past 60px; large title back at rest.
- [ ] UNVERIFIED Route pin: switching the tab to 跟读库 and back shows no background flash (K8).
- [ ] UNVERIFIED Native range thumb look in the appearance page (webkit pseudo-elements).
- [ ] UNVERIFIED Reduce transparency (iOS setting) makes all panels solid.
- [ ] UNVERIFIED Old WebViews without `:is()` / `rgb(r g b / a)` / backdrop-filter variables fall back to the classic look (K7).

## Low-end Android (Chrome)

- [ ] UNVERIFIED Scrolling a long conversation with capsule + composer + tab bar blurring (K4): frame rate; `html.lite` caps blur at 12px.
- [ ] UNVERIFIED Dragging 透明度 / 模糊 at 390px on a mid Android: no visible jank in the preview strip and the capsule.
- [ ] UNVERIFIED Native range thumb look on Firefox Android (moz pseudo-elements).
- [ ] UNVERIFIED Recording on practice: the accent pill shows the stop icon; the timer stays ink-2 on the panel.
- [ ] UNVERIFIED Me at 360px: three stat wells fit (连续 / 口语时长 / 平均发音 on one line each); large titles truncate sanely at 320-360px.

## OLED dark and outdoors

- [ ] UNVERIFIED Custom backgrounds outdoors (K6); a custom dark colour in the light slot is lifted to L about 91 with the hint, and the page stays readable.
- [ ] UNVERIFIED The 已到可读下限 hint appears at the far right in light mode (the dark floor is reached later).
- [ ] UNVERIFIED Graphite own bubbles: long-press lookup selection / active-word highlight is readable on graphite.
- [ ] UNVERIFIED Voice bubbles of mine in dark mode: the `on-graphite` play button circle is readable (graphite is light grey there).
- [ ] UNVERIFIED Monochrome quiz feedback is unmistakable at a glance (ring + filled check + green 正确; red ✕ 你的选择).
- [ ] UNVERIFIED Dock plate pills over the scrolling card are readable in the 清透 preset.
- [ ] UNVERIFIED Call screen at 667px height: dock labels readable on `mat-float`, captions end above the dock; your captions are distinguishable from the partner (label 你 / name).
- [ ] UNVERIFIED Rank card on practice next to the studio hero: only one filled accent pill on that screen; progress chart: the accent last point is the only accent on the progress page.
- [ ] UNVERIFIED Contrast over busy content under the capsule (K5).

## Anywhere (browser pass at 390x844, light and dark)

- [ ] UNVERIFIED practice: large title at rest, capsule after 60px scroll, 1 to 2 blur layers, studio hero has exactly one blue pill.
- [ ] UNVERIFIED chat list: 新对话 pill above the tab bar, not blurred; continue hero.
- [ ] UNVERIFIED conversation: graphite own bubbles, floating composer, capsule shows only title + icons; settings sheet with 8px bezel; 3 + 1 layers.
- [ ] UNVERIFIED wordbook home and a choice question after answering; dock plate button.
- [ ] UNVERIFIED Me: profile hero with 3 wells, rank row, 外观与主题 row; open it: all sliders, presets 清透/磨砂/实色, radius 紧凑/标准/圆润, background swatches (switch 正在编辑), custom colour, second colour, grain, solid, 减弱, 恢复默认; reload persists; logout + login resets.
- [ ] UNVERIFIED `/library` and `/practice/changelog` look exactly as before.
- [ ] UNVERIFIED Console has no errors; DevTools `prefers-reduced-transparency: reduce` makes all panels solid.
