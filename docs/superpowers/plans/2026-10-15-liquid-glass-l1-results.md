# Liquid glass · L1 results (2026-10-15)

Branch `feat/lg-l1`. Targeted tests only. Plan: `2026-10-15-liquid-glass-l1-theme-engine.md`.

## Deviations (plan vs reality)

1. **theme-color follows the chosen background (owner Q2, not in the plan; INDEX D-7 superseded).** `layout/color-scheme.ts`
   gains `setThemeColorOverride(color | null, win?)` (module-level override; while set, both `theme-color` metas get that
   colour and lose `media`; `null` restores the original behaviour incl. "follow system"). `applyGlassTheme` sets it to the
   hex of the guarded `top` colour (`flat` for `bgStyle: "solid"`) only when `data-glass="v2"`; it clears it when the
   attribute is `pin` (library, changelog) or the switch is off, and `initGlassTheme`'s cleanup clears it. The writer's
   `MutationObserver` now also watches `data-glass` so route pins restore/re-apply the metas. Tests: `color-scheme.test.ts`
   (+1) and `glass-theme.test.ts` (+4). Existing `color-scheme` tests untouched and green. Known gap: when the colour mode
   flips, `applyColorScheme` rewrites the metas with the previous mode's override for about one animation frame until the
   writer re-applies.
2. **rAF scheduler (plan code bug).** The plan's `schedule()` (`if (!frame) frame = raf(apply)` with `apply` resetting
   `frame = 0`) leaves `frame` stuck when `raf` runs its callback synchronously (the plan's own test double does), so the
   dark-flip test failed. Replaced with a `pending` flag; behaviour with a real rAF is identical.
3. `MATERIAL_KEYS` is a plain `readonly Material[]` (dropped `as const satisfies`, no behaviour change).
4. Test-data only: `glass-theme.test.ts` custom-background assertion rewritten to compare against `guardBackground`
   output (the plan has no such test; typed via `withBg` to satisfy TS7018).
5. `device-data.test.ts` uses static imports of the store/key instead of the plan's dynamic `import()`.
6. New files are written CRLF to match the repo; existing files edited with CRLF preserved.
7. TDD order: the model, store and writer tests were run red-first only conceptually (tests and code written back to back,
   first run was green except the rAF issue in 2).

## Verification

- Targeted: `src/lib src/settings src/layout src/auth src/architecture.test.ts` 35 files / 285 tests; `yarn web:typecheck` clean.
- New tests: glass-theme 11, store 4, writer 9 (5 plan + 4 theme-color), color-scheme +1, glass-quality +1, device-data +1.
- `src/layout/app-shell-shadow.test.tsx` (not touched by L1) intermittently fails its 1s `findBy` when run in the big
  parallel batch (passes alone and in about half the batch runs); looks like load flakiness.

## UNVERIFIED

- Real iOS standalone status bar colour (theme-color on a home-screen PWA), device frame cost of per-frame variable writes,
  `prefers-reduced-transparency` (L0 CSS) interplay. No browser/device run.
