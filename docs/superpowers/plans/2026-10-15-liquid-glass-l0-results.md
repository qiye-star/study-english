# Liquid glass · L0 results (2026-10-15)

Branch `feat/lg-l0`. Targeted tests only (no full suite, build or E2E). Plan: `2026-10-15-liquid-glass-l0-foundation.md`.

## Deviations (plan vs reality)

1. **`liquid:` selector (INDEX §4.2, K1 fallback applied).** Measured Tailwind output order: plain, `data-[..]:`, `hover:`,
   **`liquid:`**, `dark:`, `max-md:`. So `liquid:` is emitted *before* `dark:`. With the frozen `&:is([data-glass="v2"] *)` the
   specificity is (0,2,0), a tie with `dark:` (`:is(.dark *)`, 0,2,0), and `dark:` would win in dark mode. Applied the
   mitigation INDEX K1 names: the variant is now `&:is(html[data-glass="v2"] *)` (0,2,1). Actual selector string:
   `.liquid\:bg-wash:is(html[data-glass="v2"] *)`; stacked `liquid:active:` → `.liquid\:active\:bg-wash-2:active:is(html[data-glass="v2"] *)`;
   `liquid:dark:` → `:is(.dark *):is(html[data-glass="v2"] *)`. `liquid-variant.test.ts` asserts the new string and drops the
   "after dark:" ordering assertion (kept: after plain and after hover). Names, rulings and the variant name are unchanged.
2. **`glass-budget.test.ts` `blurs()` regex** `:\s*(?!none)` matched `backdrop-filter: none` by backtracking `\s*`; fixed to
   `:\s*(?!none|\s)`. Test data only.
3. **`BLUR_OWNERS` additions (pre-existing classic `.glass` users, documentation of the status quo):**
   `features/lookup/lookup-layer.tsx` (BottomSheetContent `glass` prop), `features/agents/persona-editor-sheet.tsx`,
   `features/wordbook/spell/spell-page.tsx`; plus two false positives of the source scan: `lib/glass-flag.ts` (the `"glass"`
   query-parameter name) and `test/glass.ts` (lists the blur class names).
4. **`locked-pages.test.ts` `KNOWN_SHARED`** gains `~/components/glass-tab-bar` (imported by locked `layout/bottom-nav.tsx`
   before this lane; the plan's list missed it).
5. **TypeScript:** `GlassRoutePin` and the test's `Nav` need an explicit `: null` return type (TS7010 under this repo's
   tsconfig). Behaviour unchanged.
6. Cosmetic: `GlassRoutePin` test prints React "not configured to support act(...)" warnings (plan imports `act` from `react`);
   tests pass.
7. TDD order: for tasks L0-3 and L0-5..L0-7 the implementation edit landed before the first test run (the first run was
   green or red only on the test-data issues above).

## Verification

- Tests (targeted): `src/styles src/lib src/layout src/test src/architecture.test.ts` 38 files / 374 passed;
  `src/components src/features/library` 74 files / 541 passed, 1 skipped; `src/app*` + word-card 4 files / 24 passed.
  `yarn web:typecheck`: clean. Wordbook snapshot untouched.
- `liquid-variant.test.ts` compiles the variant through real Tailwind/PostCSS (no browser).
- Switch off = no `data-glass` attribute: no new CSS rule matches (all scoped `html[data-glass="v2"]`); the only classic-DOM
  changes are the added `page-bg` class on the two root wrappers (no rule without the attribute) and `GlassRoutePin`
  (no-op without the attribute).

## UNVERIFIED

- No browser/device run (grain/sheen/blur rendering, `:is()` support on old WebViews, `?glass=v2` on a phone).
- `prefers-reduced-transparency` block is only guarded by source assertions.
