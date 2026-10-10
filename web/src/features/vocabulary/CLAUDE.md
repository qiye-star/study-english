# web/src/features/vocabulary/

Vocabulary book (`/vocabulary`) with spaced review (boxes 1/2/4/7/15/30 days) and add-to-vocabulary buttons.

## What lives here
- `vocabulary-page.tsx`, `review-card.tsx`, `add-vocabulary-button.tsx`, `vocabulary-api.ts`, `save-vocabulary-item.ts` (`saveVocabularyItem`; the lookup → word mapping moved to `features/lookup/word-target.ts`).
- `i18n/{en,zh-CN}.json` — this feature's strings.
- `register.ts` (imported only by `plugins/core.ts`): contributes `wordActions/vocabulary.add` (core, order 0) =
  `word-action.tsx` `AddVocabularyAction`, a pass-through to `AddVocabularyButton` (same DOM as rendering it directly).
- `register-word-actions.tsx` (imported only by `plugins/word-actions`): contributes `wordActionsMenu/vocabulary.add`
  (order 0, `link: "word_actions"`) — the "add to vocabulary" row in the word actions sheet, same save path as the button.

## Public surface
Public (`index.ts`): `VocabularyPage`, `AddVocabularyButton` (kept for the parity tests; product code outside this feature renders `<WordActions>` from `~/lib/extension-points-react` instead — enforced by `architecture.test.ts`). Other directories import only `~/features/vocabulary`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/vocabulary`

## Pitfalls
- Pronunciation playback uses chat's `useTtsPlayer` via `~/features/chat`.
- Do not import `AddVocabularyButton` from another feature: chat / lookup / progress / rooms render the `wordActions` slot (`<WordActions>`), whose core contribution is this button (same DOM; `plugins/word-actions/parity.test.tsx`).
