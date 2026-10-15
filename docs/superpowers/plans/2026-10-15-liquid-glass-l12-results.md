# Liquid glass · L12 results (2026-10-15)

Branch `feat/lg-l12`. Plan: `2026-10-15-liquid-glass-l12-final.md`, Tasks L12-1..L12-3 plus the owner-driven timeout item.
L12-4 (bundle) and L12-5 (full verification) are controller tasks: not run here (bundle not measured, no full suite, no build, no E2E).

## Commits

1. `feat(web): liquid glass on for everyone` (L12-1): `initGlassFlag()` always sets `data-glass="v2"` and deletes the stored
   `enjoy-web.dev.glass`; `GLASS_FLAG_KEY` / `readGlassFlag` and `?glass=` handling removed; `main.tsx` comment updated. One revertable commit
   (revert = no attribute again = classic look). `html[data-glass]` mechanics (`isLiquid`, `useLiquid`, `setGlassPinned`, `GlassRoutePin`) untouched.
   Grep for `GLASS_FLAG_KEY|readGlassFlag|glass=v2|enjoy-web.dev.glass` in `web/src` and `web/e2e`: only the cleanup string in `glass-flag.ts` and its test remain.
2. `test(web): central liquid colour guard` (L12-2): `web/src/styles/liquid-colour-guard.test.ts`.
3. `test(web): longer timeouts for tree-scanning guards and the shadow sheet shell test` (owner item).
4. `docs: liquid glass docs, checklist and results` (L12-3): README section + UNVERIFIED list, three CLAUDE.md files, design-notes pointer,
   `2026-10-15-liquid-glass-device-checklist.md`, this file.

## Colour guard findings

The plan's guard (tint / teal classes need a liquid override in the same line or the next two) scanned the in-scope sources
(150+ files; 66 of them contain a tint or teal class, all but one neutralised). It found **4 lines in 1 file, 0 elsewhere**:

| Area | Findings |
|---|---|
| components, layout, pages, plugins, app.tsx | 0 |
| practice, chat, grammar, agents, realtime, rooms, rank, vocabulary, progress | 0 |
| wordbook | 4 (`features/wordbook/home-page.tsx:48,49,53,54`, `BookCard` progress bar + legend, `bg-teal` / `bg-teal-tint`) |

Decision: not a tiny fix, and not needed. `BookCard` is the **classic-only** branch; under liquid `home-page.tsx` renders `WordbookTodayLiquid`
(`if (liquid)`), which has no teal (L9 test asserts it). So the four lines are dead under the new skin. They are listed in the guard's
`LINE_EXCEPTIONS` (line-level, `home-page.tsx` + substring `bg-teal`, with the reason in the test). The guard was not loosened otherwise
(`SKIP` unchanged from the plan, `NEUTRALISED_ELSEWHERE` unchanged: `stat-tile.tsx`, `hold-to-talk-bar.tsx`).

Follow-ups:
- `web/src/features/wordbook/home-page.tsx:48-54`: delete `BookCard` (and the exception) when the classic branches are removed (INDEX Q5).
- The guard covers only tint and teal. It does not police other hue classes (blue accent, green / amber dots, red errors, hang-up key, reset-progress
  button are allowed by design and not scanned); the plan has no stricter rule, so none was added.

## Timeouts (owner item)

- `glass-budget.test.ts` ("only allowlisted files use a blurring material or Tailwind backdrop-blur") and `locked-pages.test.ts`
  ("no locked file mentions a liquid token, class or attribute"): third argument `30000`; assertions unchanged. Both new colour-guard tests also have `30000`.
- `layout/app-shell-shadow.test.tsx`: **plain timeout, not a race.** The test clicks a button and then `findByTestId("shadow-sheet")` waits for the
  lazy-loaded sheet chunk; it passes alone in about 0.5 s and failed once in the batch with the default 1 s `findBy` limit (the lazy import is slow under
  parallel transform load; the DOM dump showed the page correct, the sheet simply not mounted yet). Raised the `findBy` limit to 5000 ms and the test
  timeout to 15000 ms; nothing else changed.

## Verification (targeted)

- `cd web && yarn vitest run src/styles src/layout src/components src/lib src/settings src/pages src/test src/app src/features/wordbook src/features/library src/features/lookup src/architecture.test.ts`:
  196 files / 1545 passed, 1 skipped (includes the new guard, 2 tests).
- Earlier L12-1 batch (`src/lib src/layout src/styles src/components src/architecture.test.ts`): 385 passed, 1 failed = the known `app-shell-shadow` flake (before the timeout fix).
- `yarn web:typecheck`: clean.
- Wordbook snapshot `word-card-legacy.test.tsx.snap`: the run rewrote it with a line-ending-only diff (`git diff --ignore-space-at-eol` empty); reverted with `git checkout`, not committed.
  L12 did not need a content change to it (the plan has no step for it).

## Deviations

1. The colour guard has one addition to the plan's code: the line-level `LINE_EXCEPTIONS` list (see above) and explicit `30000` timeouts.
2. Docs: no new "UNVERIFIED list" section existed in `web/README.md`, so the unverified items sit in the new "液态玻璃皮肤" section (Chinese, like the rest of the README).
3. The overall `2026-10-15-liquid-glass-results.md` (plan L12-3 step 5) was not written separately; the per-lane results docs plus this file and the device checklist
   are the record. The controller can merge them into one.

## UNVERIFIED

Everything visual and on-device (see `2026-10-15-liquid-glass-device-checklist.md`). The pinned routes were checked only by the existing unit tests
(`GlassRoutePin`, `locked-pages`), not in a browser. Bundle size not measured (L12-4 not run). Full suite, build and E2E not run.
