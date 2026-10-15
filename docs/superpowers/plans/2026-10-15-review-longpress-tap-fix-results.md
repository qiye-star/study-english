# Review page: tapping the lookup bar after an own long press (results)

Status: **root cause NOT reproduced; no production code changed.** Nothing here is verified on a real Android device.

## Evidence

- jsdom (`web/src/features/wordbook/review-longpress-tap.test.tsx`, liquid on, real ReviewSession + LookupLayer): own long press on an option word, bar appears, touch sequence on the bar (pointerdown, touchstart, selection collapse, 350 ms hold, pointerup, touchend, mouse events, click) opens the drawer and the question does not advance. Also passes with the click arriving 550 ms after release.
- Chromium (Playwright, Pixel 7 emulation 390x844, production build, mocked API, real CDP touch events): same flow opens the drawer. Selection collapsed at touchstart / touchend / pointerup / mousedown / click: still opens, never advances.
- Geometry at 390x844: bar x126 y700 w138 h54; DOCK y696..762; Continue button y705..753; tab bar y770..834. z-index: bar 40, DOCK 30, tab bar 30. elementFromPoint at the bar's centre and four corners returns elements inside the bar.

## Hypotheses

- H1 stacking (bar under DOCK / tab bar): REFUTED. The bar is above both and receives taps. BUT the bar sits entirely on top of the DOCK (bottom offset `--tab-bar-space + 0.5rem` equals the DOCK's bottom), covering part of the Continue button. If the bar ever unmounts between pointerup and the synthesized click (selection cleared, grace timer), the click retargets to Continue, the question advances and the bar vanishes. Not reproduced, so unconfirmed; it is the best remaining candidate.
- H2 selection collapse vs latch: REFUTED in jsdom and Chromium (latch armed by the bar's pointerdown in this flow). Android native collapse timing itself could not be emulated.
- H3 DOM replacement by re-render: REFUTED by evidence (option span keys are stable; the selection "carry" persisted through the drawer opening in Chromium).
- H4 drawer opens then closes: REFUTED in Chromium (drawer stayed open 1.2 s). Radix modal focus behaviour on a real device not covered.

## Not determined / next diagnostic

Real Android Chrome only. Next step: add temporary, text-free probe logging (event names, timestamps, `getSelection().isCollapsed`, `elementFromPoint` at the tap, whether the bar is still mounted at click) on the bar and DOCK, as done in the chat long-press plan, and ask the owner for: device/browser version, whether the Continue button was activated (did the question change?), whether the OS shows handles/menu after the long press.
Cheap hardening to consider once confirmed: lift the bar above the DOCK on pages that show one so a stray click can never reach Continue.
