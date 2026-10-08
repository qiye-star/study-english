# web/src/features/practice/

Read-aloud pronunciation practice: record, assess, history, saved practice items.

## What lives here
- Pages: `practice-page.tsx`, `assessment-page.tsx`, `history-page.tsx`, `practice-list-page.tsx`.
- `assessment-api.ts` (assess, fetch, delete, audio), `practice-items-api.ts`, `save-practice-item.ts` (`savePracticeItem`, `goPractice`).
- `mobile-score-result.tsx` (score view reused by chat).
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): pages, assessment API + types, `MAX_PRACTICE_TEXT`, `savePracticeItem`/`goPractice`, `MobileScoreResult`. Other directories import only `~/features/practice`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/practice`

## Pitfalls
- Draft key `PRACTICE_DRAFT_KEY` lives in `lib/storage.ts` and is cleared on logout.
- Recording uses the shared `audio/` engines; release the mic on every exit.
