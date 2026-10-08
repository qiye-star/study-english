# web/src/features/vocabulary/

Vocabulary book (`/vocabulary`) with spaced review (boxes 1/2/4/7/15/30 days) and add-to-vocabulary buttons.

## What lives here
- `vocabulary-page.tsx`, `review-card.tsx`, `add-vocabulary-button.tsx`, `vocabulary-api.ts`, `save-vocabulary-item.ts` (`vocabularyFromLookup`).
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): `VocabularyPage`, `AddVocabularyButton`, `vocabularyFromLookup`. Other directories import only `~/features/vocabulary`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/vocabulary`

## Pitfalls
- Pronunciation playback uses chat's `useTtsPlayer` via `~/features/chat`.
