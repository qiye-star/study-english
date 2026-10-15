# Tap-to-lookup: results (2026-10-15)

Owner-approved replacement of every app-driven long press with TAP-TO-MARK, TAP-AGAIN-TO-LOOK-UP. Reason: on Android Chrome the
browser's own long-press word selection and floating toolbar raced with our long-press selection, and the lookup bar flashed
and vanished. The native long-press selection -> bar path (`useTextSelection`) is untouched, so people can still long-press to
select and copy natively.

## Behaviour
1. Tap an English word (touch or pen) inside lookup-eligible text: the word gets an underline marker (our own, not a selection).
2. Tap the SAME word again (same text node, same start offset): the word is selected with `selectWordAt` and `readNow()` runs, so the
   existing lookup bar appears (bar and the Android press()/release() latch unchanged).
3. Tap another word: the marker moves. Tap elsewhere, any scroll (capture), resize, pointercancel, a second finger, a route change,
   a non-empty selection, or 6 s: the marker clears.

Eligibility (`lookupTapContext`, `~/lib/lookup-context`): inside `[data-lookup-context]`; not inside a, button, input, textarea,
select, summary, label, `[role=button|link|tab|menuitem|switch|checkbox|textbox]`, contenteditable, or under `data-lookup-tap="off"`
(new `lookupTapOff` helper); not on pinned routes (`isPinnedPath`: /library*, /practice/changelog); pointerType touch or pen only;
movement > 8 px or a hold > 450 ms is not a tap; multi-touch ignored; a tap while a selection exists only clears the marker.
Only Latin-letter words (inner apostrophes and hyphens) inside ONE text node; whitespace, punctuation, digits and CJK give nothing.

## New
- `~/lib/select-word`: `wordRangeAt(x, y, doc?, within?)`; `selectWordAt` reuses it.
- `~/lib/lookup-context`: `lookupTapContext`, `lookupTapOff`, `TAP_OFF_SELECTOR`.
- `features/lookup/tap-lookup.ts` (pure state machine + `isTap`), `use-tap-lookup.ts` (hook), `pending-mark.ts` (marker).
- Marker: CSS Custom Highlight API (`CSS.highlights`, `new Highlight(range)`), rule `::highlight(lookup-pending)` at the end of
  `src/index.css` (underline, 2 px, offset 3 px, colour `rgb(var(--blue))`). Fallback for engines without it: fixed-position 2 px bars from
  `range.getClientRects()`, removed on clear and resize (the hook clears on scroll).
- Hint: `TapLookupHint` / `tap-lookup-pref.ts`, device-local field `tapLookupHintSeen`, locale key `web.wordbookDefs.after.tapLookupHint`
  (zh 点一下单词会出现横线,再点一次查词 / en Tap a word to underline it, tap again to look it up). Shown once after the first answered review question.
- Test helpers `src/test/tap-lookup.ts`.

## Removed
- `features/lookup/use-long-press-lookup.ts` (+ test, `lookup-longpress.test.tsx`) and its wiring in `LookupLayer`.
- `features/wordbook/use-long-press.ts`, `long-press.ts` (+ tests), `~/lib/long-press.ts` (+ test): nothing else used them.
- `data-lookup-press="own"` (`ownLongPress`, `OWN_LONG_PRESS_SELECTOR`), `lookupPressContext`, the review rows' click swallow, contextmenu
  suppression, `select-none` / touch-callout classes and `role=button` / tabIndex / key handlers on answered option rows.
- `long-press-hint.tsx`, `long-press-pref.ts`, locale key `after.longPressHint`. The old `longPressHintSeen` is ignored; logout already removes the
  whole `WORDBOOK_PREFS_KEY` object, so it is cleared there too.

## Review page
Answered option rows are plain divs; their existing `data-lookup-context` word span is the target. Before the answer the options are buttons (ineligible)
and the quiz prompt is not a lookup context (no peeking), unchanged.

## Deviations
- Answered option rows lost their keyboard / assistive-technology "activate to look up" (Enter, Space, click with detail 0): the rows are no longer
  interactive, as the owner's brief says. Keyboard users can still select text natively.
- The brief names `isGlassPinned`; it does not exist, `isPinnedPath(pathname)` is used (the hook reads the router location itself, so
  `LookupLayer` only gained the import and one call).
- Extra guard: a tap while a selection exists, and a hold > 450 ms, count as "not a tap" (they belong to the browser's own long-press selection).
- A one-shot capture `click` listener (500 ms) re-selects the word if the browser's compat click collapsed the selection set on pointerup (Android).
- The review-page lookup-bar tests (`review-tap-lookup.test.tsx`, was `review-longpress-tap.test.tsx`) now reach the bar with two taps.

## Unverified (needs a real phone)
- Android Chrome: the programmatic selection from the second tap must not trigger the native floating toolbar (copy / select all / share).
- Highlight API support per browser, and the fixed-layer fallback underline position.
- Marker legibility on glass and on posters.
- The one-time hint; iOS Safari tapping; double-tap zoom interplay on text; screen readers.
