# web/src/features/wordbook/spell/

按句拼写 · 模式 A (spec §6.6, §11.5): target-word blanks in dataset sentences, one hidden input, deterministic server grading.

## What lives here
- `cloze-engine.ts` (pure reducer + `interpretInput(prev, next)` hidden-input diff interpreter, `SENTINEL` = U+200B).
- `use-cloze-input.ts` (hidden input: sentinel, space, backspace, IME composition, Enter via keydown / form submit / beforeinput).
- `cloze-board.tsx` (numbered sentences, read-only textbox blanks, letter cells, per-blank result badges), `outcome-badge.tsx`.
- `spell-results.tsx` (score status card + one row per word), `explain-sheet.tsx` (「为什么?」AI + dictionary explanation).
- `spell-page.tsx` (sets → submit → results → next set → summary; report sheet; settings sheet), `prefs.ts`
  (`WORDBOOK_PREFS_KEY`, show letter count), `i18n/`.
- Reused from the parent feature: `../letter-diff` (`LetterDiff`) and `../session-summary` (`SessionSummary`, kind `spell`).

## Public surface
Only `WordbookSpellPage`, re-exported by `../index.ts`. Root keeps `data-testid="wordbook-spell-page"`.

## Allowed dependencies
Same as `../CLAUDE.md`; parent-feature modules via relative `../x` imports (`../wordbook-api`, `../use-wordbook-config`).

## Test
`cd web && yarn vitest run src/features/wordbook/spell`

## Pitfalls
- Android Gboard sends keyCode 229: read the `input` event's value diff, never rely on `keydown` for letters/space/backspace.
- While an IME composes (Gboard English suggestions, pinyin), render the raw DOM value (a controlled reset kills the
  composition) and only preview letters; interpret space/backspace once, at `compositionend`.
- `beforeinput` deletes are handled only when `cancelable` (most Android IMEs are not): otherwise the `input` diff does it.
- Focus the hidden input inside the tap handler (iOS only opens the keyboard in a user gesture); the input is
  `opacity-0` + 1px + 16px font, never `display:none` / `visibility:hidden`.
- Tool buttons and blanks `preventDefault` on mousedown so tapping them does not close the keyboard.
- No per-keystroke aria-live; announce once after submit (`role="status"` score card).
- The server never sends answers: the first-letter hint and 「听这句」 use the headword's word for each blank
  (wrong first letter for irregular forms such as go → went).
