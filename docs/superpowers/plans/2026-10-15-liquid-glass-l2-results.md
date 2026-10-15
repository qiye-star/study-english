# Liquid glass · L2 results (2026-10-15)

Branch `feat/lg-l2`. Plan: `2026-10-15-liquid-glass-l2-shared.md`. Targeted tests only.

## Deviations (plan vs reality)

1. Every plan anchor and test matched the code; no frozen name or ruling changed. Anchors that are substrings of other
   lines were matched with a trailing newline (e.g. `"\n  return (\n"` in `glass-top-bar.tsx`, because `return () =>` in
   `useScrolled` also contains `  return (`).
2. L2-5 close button: `glass-lookup.test.tsx` / `bottom-sheet.test.tsx` do not pin the close-button class string, so
   `liquid:rounded-full liquid:hover:bg-wash` was appended (applies to both branches, invisible at rest in `glass`).
3. L2-6 banner test: assertion added on the same element that has `bg-amber-tint`
   (`getByText("提醒").parentElement`), not through `getAllByRole("paragraph")`.
4. L2-7: nothing to change (`glass-top-bar.tsx`, `bottom-sheet.tsx`, `liquid.ts` already in `BLUR_OWNERS`); no commit.
5. L2-9 snapshot diff: 3 lines, only the added tokens `mat-surface liquid:rounded-panel`; line endings unchanged.
6. New files were written LF and converted to CRLF to match the rest of `components/`.
7. Cosmetic: the large-title test prints React "not configured to support act(...)" (as in L0); passes.

## Results to record

- `glass-lookup.test.tsx` did not pin the close-button class string.
- `layout.test.tsx` / `primitives.test.tsx`: no change needed.

## Verification

- `src/components src/layout src/styles src/features/wordbook src/features/library src/test src/architecture.test.ts`:
  155 files / 1203 passed, 1 skipped. Class-asserting tests of chat/rooms/rank/spell/plugins/login: 6 files / 71 passed.
- `yarn web:typecheck`: clean.

## UNVERIFIED

- No browser run: capsule fade with `backdrop-filter` on iOS; large-title truncation at 320-360px with long English titles;
  real look of the floating sheet, banner, `well` stat tiles.
