# web/src/features/practice/

Read-aloud pronunciation practice: record, assess, history, saved practice items.

## What lives here
- Pages: `practice-page.tsx`, `assessment-page.tsx`, `history-page.tsx`, `practice-list-page.tsx`.
- `assessment-api.ts` (assess, fetch, delete, audio), `practice-items-api.ts`, `save-practice-item.ts` (`savePracticeItem`, `goPractice`). Sources include `library` (shadowing library, plan 2026-10-13-video-import-web-shadow); `PracticeItemSource` / `AssessmentSource` must match the server.
- `mobile-score-result.tsx` (score view reused by chat).
- `use-shadow-session.ts` — `useShadowSession`: record → WAV → assess (`save: true`, no `source`) → keep the recording for retry. Shared by `practice-page.tsx` and the shadow sheet (plan 2026-10-14-shadow-sheet); with default options it is the page's old logic verbatim (`keepAudio`, `silenceError`, `starter`, `maxDurationMs` are sheet/test-only).
- `shadow/` — the in-place read-aloud sheet opened from chat and lookup. Main bundle (tiny): `shadow-context.tsx` (`ShadowSheetProvider`, `useShadowSheet`, `normalizeShadowInput`), `shadow-host.tsx` (`ShadowSheetHost`, `lazy`). Lazy chunk only: `shadow-sheet.tsx`, `shadow-result.tsx` (`ShadowResult`), `shadow-fx.tsx`, `word-tap.ts`, `shadow-locales.ts` + `locales/`, `shadow-sheet.css` (`.shs-*`). `test-utils.tsx` (`WithShadowSheet`) is for tests only.
- `i18n/{en,zh-CN}.json` — this feature's strings.
- The page header renders `<Slot point="practiceHeaderActions" />` before the practice-list link; the changelog entry arrives through it (no import of `~/features/changelog`: that would be a new cross-feature edge, plan 2026-10-14-changelog R-2).

## Public surface
Public (`index.ts`): pages, assessment API + types, `MAX_PRACTICE_TEXT`, `savePracticeItem`/`goPractice`, `MobileScoreResult`, `ShadowSheetProvider`/`ShadowSheetHost`/`useShadowSheet`/`useShadowSheetOpen` (+ `ShadowOpenInput`, `ShadowSource`). Other directories import only `~/features/practice`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/practice`

## Pitfalls
- Draft key `PRACTICE_DRAFT_KEY` lives in `lib/storage.ts` and is cleared on logout.
- Recording uses the shared `audio/` engines; release the mic on every exit.
- Shadow sheet: callers close their own panel, then `useShadowSheet().open({ text, list?, index?, source })`; `source` only feeds 收藏. The assessment is saved **without** `source` (server default `practice`, so it shows in History; `source=chat` rows without a message are deleted by `cleanup_orphan_chat_recordings`).
- The sheet is a **non-modal** Radix Dialog with its own scrim (z-35/36 < selection bar z-40 < lookup drawer z-50): a modal one would make `lookup-bar.tsx` unclickable. The close confirmation is an in-sheet overlay, never a second dialog (nested focus scopes recurse, see wordbook/CLAUDE.md). While recording/assessing the reference loses `data-lookup-context` so the selection bar stays away.
- Lazy chunk: never import `shadow-sheet`, `shadow-result`, `shadow-fx`, `word-tap`, `shadow-locales` or the CSS from main-bundle files (`shadow-lazy.test.ts`); copy lives in `shadow/locales/` (not `i18n/`, which is merged eagerly). `word-tap.ts` / `shadow-fx.tsx` duplicate `features/library` helpers on purpose (features may not import each other's internals); lift both to `lib/` in a separate plan if you dedupe.
- Waveform is simulated (CSS), not mic-level driven; recording cap in the sheet is 60 s (page: 5 min). Device behaviour is unverified: see `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`.
- `test/render.tsx` must not import this feature (architecture rule 2 + cold-compile cost); tests wrap with `WithShadowSheet`.
