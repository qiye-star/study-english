# Liquid glass · L9 results (2026-10-15)

Branch `feat/lg-l9`. Plan: `2026-10-15-liquid-glass-l9-wordbook.md`. Targeted tests only.

## Deviations (plan vs reality)

1. `recall-rating-bar.tsx` `TONE` is the rating BADGE map (not rating buttons, which use `GHOST_DOCK` / `PRIMARY`): instead of
   `LQ_ON_BLUR` the badge gets `liquid:rounded-full liquid:bg-wash liquid:text-ink` (mapping table: decorative status chip).
2. Listen keys / icon squares: the `LQ_ICON_WELL` value is written as literal `liquid:` tokens instead of importing the constant
   (same classes; avoids an import in 6 files). `review-page.tsx:202` is the intro icon square (`rounded-button`), same treatment.
3. `spell/spell-page.tsx` has its own two docks (typing submit, results) not listed in the plan: given `mat-chrome-bar` + the
   same inset classes; its local `GHOST` gets a `GHOST_DOCK` (plate) in the results dock. No `bottom-*` / `bg-surface` added
   (spell-page.test assertions green).
4. `today-liquid.tsx`: dropped `tracking-tightest` (token does not exist); the new home test asserts `progressbar.innerHTML`
   has no `teal` (stronger than `className`). Classic header gear (goals sheet) is kept by the shared `PageHeader`.
5. `choice-question.tsx` listen/option edits applied to both option renderings (button and answered row) via one replace-all.
6. Snapshot regenerated: 3 lines, only added tokens (`mat-surface liquid:rounded-panel` etc.); line endings unchanged.
7. `data-lookup-context` / `ownLongPress` markers untouched (lookup-marks tests green).

## Verification

- `cd web && yarn vitest run src/features/wordbook src/i18n src/architecture.test.ts`: 60 files / 449 passed.
- `yarn web:typecheck`: clean.

## UNVERIFIED

- No browser/device run: monochrome quiz feedback legibility, dock plate pills over a scrolling card in the 清透 preset,
  home hero spacing at 360px.
