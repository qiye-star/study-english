# web/src/features/wordbook/spell/

按句拼写 · 模式 A (spec §6.6, §11.5): target-word blanks in dataset sentences, one hidden input, deterministic server grading.

## What lives here
- `cloze-engine.ts` (pure reducer), `use-cloze-input.ts` (hidden input: sentinel, space, backspace, IME composition),
  `cloze-board.tsx`, `spell-results.tsx`, `explain-sheet.tsx`, `spell-page.tsx`, `prefs.ts` (show letter count), `i18n/`.
- Until WS3 lands, `spell-page.tsx` is a stub rendering `<div data-testid="wordbook-spell-page" />`.

## Public surface
Only `WordbookSpellPage`, re-exported by `../index.ts`.

## Allowed dependencies
Same as `../CLAUDE.md`; parent-feature modules via relative `../x` imports.

## Test
`cd web && yarn vitest run src/features/wordbook/spell`

## Pitfalls
- Android Gboard sends keyCode 229: read the `input` event's value diff, never rely on `keydown` for letters/space/backspace.
- Focus the hidden input inside the tap handler (iOS only opens the keyboard in a user gesture).
- No per-keystroke aria-live; announce once after submit.
