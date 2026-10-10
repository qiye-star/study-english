# web/src/features/wordbook/

背单词 (spec `docs/superpowers/specs/2026-10-10-wordbook-design.md` §11): book picker, daily plan, learn, review, summary;
the spelling-in-context mode lives in `spell/`. Hidden unless `/api/wordbook/config` says enabled.

## What lives here
- `wordbook-api.ts` (types + calls, `WORDBOOK_SERVER_ERRORS`), `use-wordbook-config.ts`.
- Pages: `home-page.tsx` (/wordbook), `books-page.tsx` (/wordbook/books), `learn-page.tsx`, `review-page.tsx`; entries
  `wordbook-card.tsx` (practice page) and `me-row.tsx` (`WordbookMeRow`, 我的 → 学习). No bottom tab.
- Session chrome: `session-header.tsx` (× close + `StepBar`), shared `DOCK` bar (sticky above the tab bar).
- `use-speaker.ts` (TTS via `useTtsPlayer` + server default model/voice, US/UK voice by accent), `use-rank-enabled.ts`.
- `use-today.ts` (`useWordbookToday`), `page-status.tsx` (loading / translated error + retry / note), `ui.ts` (shared button / dock classes, `bookTitle`, `fmt`), `test-fixtures.ts` (snake_case server samples for tests only).
- `session-machine.ts` (learn/review queue), `word-card.tsx`, `choice-question.tsx`, `typing-question.tsx`, `letter-diff.tsx`, `plan-ring.tsx`, `session-summary.tsx`.
- `spell/` – see `spell/CLAUDE.md`. `i18n/{en,zh-CN}.json`.
- Wordbook v2 (spec `2026-10-11-wordbook-recall-design.md`): `recall-cover.tsx` (meaning cover button), `recall-rating-bar.tsx`
  (`RecallRatingBar` 不认识 / 模糊 / 认识, `SpotBar`, `RatingBadge`), `recall-card.tsx` (review quick-recall front / back).
  `session-machine.ts` also exports `startCard` / `cardReducer` / `ratingPayload` (peek + clamped `elapsedMs`), `planLearnQuiz`,
  `slotId` / `slotKey`, `learnTally`. The review page calls `reviewBatch(api, 20, { recall: true })`; `/config.learn` carries
  `autoplay` / `showExample`.

## Public surface
`index.ts`: pages (lazy, from `lazy-pages.tsx`), `WordbookCard`, `WordbookMeRow`, `useWordbookEnabled`, `useWordbookConfig`.
Other directories import only `~/features/wordbook`.

## Allowed dependencies
`lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via `index.ts`
(TTS: `useTtsPlayer` from `~/features/chat`, called inside components only — never at module top level).

## Test
`cd web && yarn vitest run src/features/wordbook`. Page tests set `zh-CN` in `beforeEach` and assert Chinese copy. To stub TTS,
`vi.mock("~/features/chat/use-tts-player", …)` (mocking the `~/features/chat` barrel does not reach `use-speaker.ts`).

## Pitfalls
- Teal is the wordbook identity colour; blue only for primary actions and the active blank; wrong answers are neutral, never red.
- `/answers` returns `expected` = the headword and `correctOption` = the exact correct option text (choice questions;
  null for typed / known). `correctOptionOf` uses it verbatim; never rebuild the server's meaning line (Ruling Z-e).
- Grading happens on the server; never grade or reveal answers client-side beyond what the response returns.
- `wordbook-api.ts` types/signatures are shared by every lane (plan P-W4); changing them needs a plan Addendum.
- Response keys are camelCased deeply by `ApiClient`: never rely on word-keyed maps from the server (`reviewBatch` re-keys
  `cards` by `card.key`); word text lives in values, which are never transformed.
- Pages are code-split (`lazy-pages.tsx`, each with its own Suspense + `PageLoading`): never export a page module statically
  from `index.ts`, or the main chunk grows again (base 1,537.8 kB; with eager pages 1,622.8 kB; lazy 1,562.2 kB).
- `session-summary.tsx` serves learn, review and spell (`kind: "spell"`); `letter-diff.tsx` is shared with `spell/`.
- Spell prefs use `WORDBOOK_PREFS_KEY` from `~/lib/storage` (one key; `auth/device-data.clearDeviceData()` clears it at logout).
- The 练习 bottom tab stays highlighted on `/wordbook/*` (`layout/bottom-nav.tsx` `also`).
- E2E: `web/e2e/wordbook.spec.ts` (learns each card with 模糊) and `wordbook-recall.spec.ts` (needs `WORDBOOK_SPOT_CHECK_PCT=100`;
  the review part makes a word due through `e2e/support/wordbook-db.ts`). Zero upstream; the e2e guard lets `/api/wordbook/*`
  through except `/explain`.
- Boxes, spot checks and the two-fuzzy rule are decided by the server: the client only reports `rating`, `revealedBefore`
  and `elapsedMs`. Never show a box or spot-check result before the response, and never send an `elapsedMs` above
  600000 (the server rejects it with 422): use `ratingPayload` / `clampElapsed`.
- While covered, the meaning, examples and phrases are not in the DOM at all (no blur or opacity tricks).
- Audio: no autoplay before the first tap (iOS); `speaker.prime()` only on the first gesture; read in click handlers, not
  effects, so StrictMode cannot read twice (a second `play()` with the same id stops playback).
