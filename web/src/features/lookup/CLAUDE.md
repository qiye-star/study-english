# web/src/features/lookup/

Select-to-lookup and translation layer over the whole app.

## What lives here
- `lookup-layer.tsx` (sheet, mounted by `layout/app-shell.tsx`), `use-text-selection.ts` (also `readNow()`: read the selection at once, respects the press latch), `use-tap-lookup.ts` (global tap-to-mark / tap-again-to-look-up hook, mounted once by `LookupLayer`, disabled while the drawer is open) with its pure state machine `tap-lookup.ts` and the marker `pending-mark.ts`, `glass.ts` (well / source-chip classes for the drawer's inner controls, no blur).
- `word-target.ts` (`wordTargetFromLookup`, R19: lookup result → `WordTarget` for the `<WordActions>` slot; moved from vocabulary's `vocabularyFromLookup`, same output).
- `dictionary.ts` (local dictionary client + pure helpers: `lookupDictionary`, `visibleDefs`, `drawerDefs`, `dictToLookup`), `use-dictionary-prefetch.ts`, `dictionary-result.tsx`.
- `lookup-bar.tsx` — the selection action bar: look up / translate, read aloud (extension point `selectionActions`), add to vocabulary (`<WordActions variant="icon">`).
- `lookup.ts` (`lookupWord`, `translateText`, cached variants incl. `cachedTranslate`, `normalizeSelection`).
- `prompts.ts` extracts desktop prompts from enjoy command sources (via `~/shims/enjoy-sources`).
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): `LookupLayer`, `cachedTranslate`, `normalizeSelection`, `LOOKUP_SERVER_ERRORS`, `LookupResult`, `TextSelectionInfo`. Other directories import only `~/features/lookup`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/lookup`

## Pitfalls
- Prompts are read from enjoy source text with `?raw`; never copy or edit them in `enjoy/`.
- Realtime call captions carry `data-lookup-context` (`realtime/call-captions.tsx`); the full-screen call (z-50) sits above the bar (z-40), see plan 2026-10-15 Q6.
- Dictionary first: `run` calls `lookupDictionary` before the model; a miss or any error silently falls back to the AI path. Long selections never ask the dictionary. Dictionary results are not cached (they carry the user's `def_lang`).
- Read aloud is contributed by chat (core contribution); lookup never imports chat.
- The bar keeps `data-testid="lookup-trigger"` on its look up / translate button.
- The add-to-vocabulary button is the `<WordActions>` slot (`~/lib/extension-points-react`), not a vocabulary import (no lookup→vocabulary edge).
- 「跟读这段」(`lookup-practice`) closes the drawer, then opens the shadow sheet (`useShadowSheet` from `~/features/practice`); it no longer navigates. The sheet's sentences are `data-lookup-context` containers, so this layer's selection bar works over it (bar z-40 > sheet z-36); the word-actions panel's 「跟读这个词」 (contributed by practice's `register-word-actions.tsx`) closes its own panel and opens the sheet too; because it does not navigate, `LookupLayer` collapses the drawer itself when `useShadowSheetOpen()` turns true (only on that transition).
- Android Chrome collapses the native selection when a finger touches the bar. `useTextSelection` therefore exposes `press()`/`release()` (the bar calls them on pointer/touch down and up/cancel): while a press is in flight and for 600 ms after, selectionchange does not update the selection, so the bar stays and the click runs with the latched selection; afterwards the real selection is read again. Never `preventDefault` on `touchstart` in the bar (it would suppress the click); the bar is `select-none`. Any new overlay that wants to coexist with the bar must not clear the selection on pointerdown (the shadow sheet's Radix dialog already `preventDefault`s `onInteractOutside`).
- `readSelection` clamps a one-sided spill (one end inside a `[data-lookup-context]`, the other in the bubble's action row) to that context; two different contexts still reject. `MarkdownText` components must stay module-level so a selection inside a link survives re-renders (a streaming reply still loses its selection on each delta).
- Native long-press on Android is not reproducible in Chromium/Playwright; the fix is covered by jsdom event-sequence tests only (plan 2026-10-14-chat-longpress-lookup-fix, results doc).
- 「中文」 chip in the drawer (plan `2026-10-14-review-bilingual-longpress` R-Z4): with `def_lang` en and English definitions, Chinese definitions and phrase translations hide behind `ZhToggle` (`data-testid="lookup-zh"`, from `~/components/zh-toggle`); the state is per lookup (keyed by the entry object), never stored. No chip when Chinese already shows or there is none; the AI fallback path is unchanged.
- Tap-to-lookup (replaced the global long-press recogniser; docs/superpowers/plans/2026-10-15-tap-lookup-results.md): `useTapLookup` listens on the document (capture, passive, touch and pen only; the desktop mouse keeps native select / double-click). A tap (<= 8 px, <= 450 ms, one finger, no selection present) on a word of a `[data-lookup-context]` (`lookupTapContext` in `~/lib/lookup-context`: not inside a/button/input/textarea/select/summary/label/role button|link|tab|menuitem|switch|checkbox|textbox/contenteditable, not under `data-lookup-tap="off"`, not on `isPinnedPath` routes) underlines the word with `PendingMark`; a tap on the SAME word (same text node + start offset, `wordRangeAt`) selects it with `selectWordAt` and calls `readNow()`, so the unchanged bar appears (a one-shot capture `click` within 500 ms re-selects if the browser collapsed it). Another word moves the marker; tapping elsewhere, any scroll (capture), resize, pointercancel, a second finger, a route change, a non-empty selection or 6 s clears it (`tap-lookup.ts` is pure: idle / marked{key,at}). It never calls `preventDefault`, never touches `user-select` / `touch-action`, never logs. The native long-press selection -> bar path (`useTextSelection`) is untouched.
- `PendingMark` (`pending-mark.ts`): CSS Custom Highlight API (`CSS.highlights` + `new Highlight(range)`, rule `::highlight(lookup-pending)` in `index.css`, accent = `--blue`); engines without it get fixed-position 2 px bars from `range.getClientRects()`, removed on clear / resize (scroll clears via the hook). Tests stub both (`~/test/tap-lookup`).
- Mark new English learning text with `{...lookupContext}` from `~/lib/lookup-context`, and list it in a `src/lookup-marks.<lane>.test.ts`.
- Opt a subtree out of tap-to-lookup with `{...lookupTapOff}` (`data-lookup-tap="off"`) from `~/lib/lookup-context`. A lookup context must not sit inside a button / link / role=button (it would be ineligible).
- The bar is `.glass-pop`, and the drawer is `BottomSheetContent glass` (`.glass-sheet`); on library screens both are solid (`:has`, R-G5).
