# web/src/features/grammar/

Grammar checking of user sentences and the user-editable grammar prompt.

## What lives here
- `grammar-api.ts` (`cachedGrammar`, IndexedDB cache keyed by text + local prompt revision, `bumpGrammarRev`).
- `grammar-prompt-api.ts`, `grammar-prompt-editor.tsx` (shown on the Me page).
- `grammar-types.ts`.
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): types, `cachedGrammar`, `MAX_GRAMMAR_TEXT`, `GRAMMAR_SERVER_ERRORS`, `bumpGrammarRev`, `GrammarPromptEditor`. Other directories import only `~/features/grammar`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/grammar`

## Pitfalls
- Never reset the revision to 0 on logout; it is bumped (stale cache entries must not hit again).
- Prompt and model are decided by the server (`POST /api/ai/grammar`).
