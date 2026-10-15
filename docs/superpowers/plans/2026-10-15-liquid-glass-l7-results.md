# Liquid glass · L7 results (2026-10-15)

Branch `feat/lg-l7`. Plan: `2026-10-15-liquid-glass-l7-rooms.md`. Targeted tests only (no full suite, build or E2E).

## Deviations (plan vs reality)

1. Every plan anchor matched the code; no frozen name or ruling changed. Test data: the composer test renders a `QuoteBar` as `above` and a `banner` so the Rule 4 assertion covers real text; the lobby test also asserts the ended-link row is `mat-surface`.
2. **Rule 4 additions beyond the plan rows** (same owned files): the composer carries more text than the plan listed, so `plate liquid:rounded-full` was also added to `extras/quote-block.tsx` (QuoteBar), `extras/activity-line.tsx`, `agents/target-row.tsx` (row) and `agents/tutor-bar.tsx` (base). The plan said `mat-surface` for the non-mine tutor bar; it sits inside the blurred composer (`above`), so `plate` is used instead.
3. **Tutor bar "mine" mark**: plan used `liquid:shadow-[inset...]`; `plate` also paints `box-shadow` at the same specificity (K2), so the mark is `liquid:border-[1.5px] liquid:border-ink` instead.
4. **Code input cells** (`code-input.tsx`): plan said `well`; `well` would override the focused `shadow-[inset_0_0_0_1.5px_blue]` ring, so the cells use `liquid:bg-wash` and the shadow is chosen by state (focused: blue ring, else `liquid:shadow-well`).
5. **Voice bubble translation tag** (`voice-bubble.tsx`, "译" label on a mine bubble): `bg-surface` would be white-on-white under the plan's descendant text override, so mine gets `liquid:bg-on-graphite/15`.
6. Extra E1 panels from the mapping table (not in the per-file rows): lobby pending/outcome cards, invite card, summary list/card, reopen bar get `LQ_TILE`/`LQ_PANEL`.
7. Composer input focus ring (`focus-within:ring-[3px]`) is overridden by `plate`'s box-shadow in liquid; the `focus-within:border-blue` border remains. Accepted, not fixed.
8. A heredoc-written edit script was truncated by the shell tool; edits were re-applied with the Write tool (no product impact).

## Verification

- `cd web && yarn vitest run src/features/rooms src/components src/test src/styles src/architecture.test.ts`: 81 files / 647 passed. `src/features/rooms` alone: 57 files / 411 passed (3 new liquid tests: lobby, composer, assist dock). `yarn web:typecheck`: clean.
- All edited files keep their original (CRLF) line endings; wordbook snapshot untouched.

## UNVERIFIED

- No browser or device run: composer plus assist dock overlap with the iOS keyboard; blur layer count on the real room page (capsule + composer + tab bar = 3); legibility of graphite own bubbles and voice play button in dark mode (graphite is light grey there); `mat-float` slash menu over the plated input; `plate` stacking (assist pill inside the input plate).
