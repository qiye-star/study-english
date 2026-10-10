# web/src/features/wordbook/

背单词 (spec `docs/superpowers/specs/2026-10-10-wordbook-design.md` §11): book picker, daily plan, learn, review, summary;
the spelling-in-context mode lives in `spell/`. Hidden unless `/api/wordbook/config` says enabled.

## What lives here
- `wordbook-api.ts` (types + calls, `WORDBOOK_SERVER_ERRORS`), `use-wordbook-config.ts`.
- Pages: `home-page.tsx` (/wordbook), `books-page.tsx` (/wordbook/books), `learn-page.tsx`, `review-page.tsx`; entry `wordbook-card.tsx`.
- `session-machine.ts` (learn/review queue), `word-card.tsx`, `choice-question.tsx`, `typing-question.tsx`, `letter-diff.tsx`, `plan-ring.tsx`, `session-summary.tsx`.
- `spell/` – see `spell/CLAUDE.md`. `i18n/{en,zh-CN}.json`.

## Public surface
`index.ts`: pages, `WordbookCard`, `useWordbookEnabled`, `useWordbookConfig`. Other directories import only `~/features/wordbook`.

## Allowed dependencies
`lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via `index.ts`
(TTS: `useTtsPlayer` from `~/features/chat`, called inside components only — never at module top level).

## Test
`cd web && yarn vitest run src/features/wordbook`

## Pitfalls
- Teal is the wordbook identity colour; blue only for primary actions and the active blank; wrong answers are neutral, never red.
- Grading happens on the server; never grade or reveal answers client-side beyond what the response returns.
- `wordbook-api.ts` types/signatures are shared by every lane (plan P-W4); changing them needs a plan Addendum.
- Response keys are camelCased deeply by `ApiClient`: never rely on word-keyed maps from the server (`reviewBatch` re-keys
  `cards` by `card.key`); word text lives in values, which are never transformed.
