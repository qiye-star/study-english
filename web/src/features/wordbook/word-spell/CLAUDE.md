# web/src/features/wordbook/word-spell/

拼写入口与单词拼写(plan 2026-10-27 R-W1 / R-W9)。

## What lives here
- `spell-hub-page.tsx` — `/wordbook/spell`: two rows, 例句拼写 (`/wordbook/spell/sentences`, the old `../spell/` page) and 单词拼写 (`/wordbook/spell/words`). Lazy via `../lazy-pages.tsx`.
- `word-spell-api.ts` — `startWordSpell(api, count)`: `POST /api/wordbook/word-spell/start` with `count` (10 default, 20) and `tzOffsetMinutes`. Words never go in the URL. Answers use `wordbook-api.ts`'s `/answers` with `mode: "free"`.

## Status
- W1 (server) and W2 (entry page + API) are in. The single-word page (`/wordbook/spell/words`, dictation and 看中文拼英文) is not built yet (W3/W4); that route is not registered until then.

## Rules
- Words are not graded here; the server response decides right or wrong.
- Word spelling does not change boxes or rank (free-mode answers only).
