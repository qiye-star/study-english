# Chat long-press lookup on Android: results

Plan: `docs/superpowers/plans/2026-10-14-chat-longpress-lookup-fix.md`. Status: **diagnosis not run yet. Nothing here is verified on a device.**

Privacy: paste only probe lines. They contain flags, lengths and node names, never message text. Do not paste tokens, and do not paste screenshots that show personal content.

## Owner triage (T0)

Paste the owner's answers verbatim.

| # | Question | Answer |
|---|---|---|
| 1 | Browser and mode (Chrome tab / other / installed app) | |
| 2a | Word highlighted with handles after the long-press? | |
| 2b | Native menu (Copy/Share/Select all)? | |
| 2c | Our bar (查词 · 朗读 · ☆) visible, even partly? | |
| 2d | Google search panel from the bottom? | |
| 3 | What happens when tapping 查词? | |
| 4 | Keyboard open vs closed vs voice mode | |
| 5 | Message kind tried (AI reply / own text / voice transcript / link) | |
| 6 | Control: shadow sheet sentence / vocabulary card long-press | |

## Harness: vitest (T1a)

Command: `cd web && yarn vitest run src/features/chat/chat-lookup.test.tsx`

| Case | Result |
|---|---|
| assistant markdown reply: bar + drawer | |
| own typed message: bar + drawer | |
| voice transcript: bar + drawer | |
| H4 spill into the action row (characterization) | |
| H3 `[H3] link text node still connected` value | |

## Harness: Playwright (T1b)

Command: `cd web && yarn playwright test -c scripts/lookup-harness/playwright.config.cts` (Chromium 1161, Pixel 7, all `/api` mocked).

Paste one JSON line per case. Fields: `case`, `keyboard`, `bar`, `onTop`, `inViewport`, `top`, `bottom`, `vvh`, `selCollapsed`, `drawerOpened`, `unmocked`.

```
(pending)
```

## Device log (T1c)

Setup: phone model, Android version and browser version (no account data).

| Row | Bar visible? | 查词 opened? | Probe lines (paste) |
|---|---|---|---|
| assistant reply, keyboard closed | | | |
| assistant reply, keyboard open | | | |
| own text message, keyboard closed | | | |
| voice transcript, keyboard closed | | | |
| control: shadow sheet sentence | | | |
| control: vocabulary review card | | | |
| installed PWA: assistant reply | | | |

## Findings (T2)

Rules for each status are in plan Task T2, Step 1.

| Hypothesis | Status (confirmed / refuted / unknown) | Evidence (quote) |
|---|---|---|
| H1a bar covered by browser bottom UI | | |
| H1b tap on bar does not reach `onClick` | | |
| H2 keyboard / focus drops the selection | | |
| H3 re-render replaces selected nodes | | |
| H4 `readSelection` rejects the Android selection shape | | |
| H5 bar under page elements / off-screen | | |
| H6 no document selection at all | | |

## Decision

Branches to apply, in R-LP2 order D → E → C → F → A → B → G: (pending)

If nothing above is confirmed: **STOPPED**, reported to the controller on (date). Missing evidence: (pending).

## Device checklist results (owner)

Copy from the plan's checklist section (A1–D1). Each row's result is pass, fail or not tested, with a note.

## Owner answers (2026-10-14, T0)
- Android browser **tab** (not the installed PWA).
- Expects the lookup bar (look up / read aloud / add to vocabulary) after long-pressing chat text.
- Composer keyboard was **not** open.
- The system copy menu appears; our bar does **not** (not seen at all).
- Not answered: which message type; whether the shadow-sheet sentence long-press works as a control.
=> Native selection works; H2 (keyboard) is out. Remaining: H1a (bar covered by Chrome UI / native toolbar), H4 (readSelection rejects), H3 (re-render drops selection).

## Owner follow-up (2026-10-14)
- Control answered: the bar is unusable **everywhere** (chat, shadow sheet, etc.), not only on the chat page. Symptom: the bar shows, and one tap on it makes it disappear (the action does not run).
=> Confirmed global, Android browser tab. Matches H1b: the touch on the bar collapses the native selection -> `selectionchange` -> `useTextSelection` clears -> bar unmounts before/while the click lands. Fix branch B is promoted to the primary fix: keep the bar alive across the press (latch the selection at press time, `preventDefault` on pointerdown/touchstart of the bar so the selection is not collapsed, ignore selectionchange while a press on the bar is in flight), plus a regression test. Branches C-G are only needed if B does not resolve it on the device.

## Execution (scope change: global tap-on-bar bug)

Status: fix implemented and covered by jsdom tests only. **UNVERIFIED on a real Android device.**

Applied (plan branch B, reshaped; plus low-risk D and E):
- B (primary): `useTextSelection` gained `press()` / `release()`; `LookupBar` calls them on pointerdown/touchstart and pointerup/pointercancel/touchend/touchcancel. While pressed, and 600 ms after release, selectionchange does not update (clear) the selection; after the grace the real selection is read again. The bar is `select-none`. No `preventDefault` on touchstart (click must still fire); existing pointerdown/mousedown `preventDefault` kept. The action runs with the latched `selection` prop.
- D: `MarkdownText` components/plugins hoisted to module scope.
- E: `readSelection` clamps a one-sided spill to the context of the other end; `BubbleActions` is `select-none`.
- Not applied: C, F, A, G (no failing test proved a need), T1b Playwright harness, T1c probe (the owner verifies on the phone).
- Shadow sheet: Radix non-modal dialog already has `onInteractOutside={(e) => e.preventDefault()}`, and the bar renders outside the dialog above the scrim, so a press on the bar is not an outside interaction. Other selection clearers (library `copySentence`, word-tap `selectWord`) act on explicit user taps on text, not on the bar. The layer is mounted once, so no page-specific change.

Tests (jsdom): new `lookup-layer.test.tsx` group (4): touch press then collapse then release then click keeps the bar and opens the drawer (failed before the fix); collapse without a press still hides the bar; a press that is cancelled lets go after the grace; bar is `select-none`. New `use-text-selection.test.ts` cases: press/release latch and grace; one-sided spill clamp; two-context reject. `markdown.test.tsx`: link node stays connected. `bubble-actions.test.tsx`: `select-none`. Targeted run: 57 files, 1233 tests pass; `yarn web:typecheck` clean.

NOT verified: real Android Chrome tab behaviour (whether Chrome emits pointercancel/touchcancel instead of a click when the selection collapses, handles, native toolbar overlap, the 600 ms grace being enough), installed PWA, iOS, desktop mouse by hand. If a device still loses the tap, branch B1 (open on touch pointerup) is the next step.
