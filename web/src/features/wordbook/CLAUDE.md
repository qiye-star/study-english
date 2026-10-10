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

## Public surface
`index.ts`: pages, `WordbookCard`, `WordbookMeRow`, `useWordbookEnabled`, `useWordbookConfig`. Other directories import only `~/features/wordbook`.

## Allowed dependencies
`lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via `index.ts`
(TTS: `useTtsPlayer` from `~/features/chat`, called inside components only — never at module top level).

## Test
`cd web && yarn vitest run src/features/wordbook`. Page tests set `zh-CN` in `beforeEach` and assert Chinese copy. To stub TTS,
`vi.mock("~/features/chat/use-tts-player", …)` (mocking the `~/features/chat` barrel does not reach `use-speaker.ts`).

## Pitfalls
- Teal is the wordbook identity colour; blue only for primary actions and the active blank; wrong answers are neutral, never red.
- `/answers` returns `expected` = the headword, not the correct option: `correctOptionOf` (learn-page) matches it for
  word/cloze and rebuilds the server's `meaning_line` (`meaningLine` in word-card) for meaning questions.
- Grading happens on the server; never grade or reveal answers client-side beyond what the response returns.
- `wordbook-api.ts` types/signatures are shared by every lane (plan P-W4); changing them needs a plan Addendum.
- Response keys are camelCased deeply by `ApiClient`: never rely on word-keyed maps from the server (`reviewBatch` re-keys
  `cards` by `card.key`); word text lives in values, which are never transformed.
