# web/src/features/lookup/

Select-to-lookup and translation layer over the whole app.

## What lives here
- `lookup-layer.tsx` (sheet, mounted by `layout/app-shell.tsx`), `use-text-selection.ts`.
- `word-target.ts` (`wordTargetFromLookup`, R19: lookup result → `WordTarget` for the `<WordActions>` slot; moved from vocabulary's `vocabularyFromLookup`, same output).
- `dictionary.ts` (local dictionary client + pure helpers: `lookupDictionary`, `visibleDefs`, `dictToLookup`), `use-dictionary-prefetch.ts`, `dictionary-result.tsx`.
- `lookup-bar.tsx` — the selection action bar: look up / translate, read aloud (extension point `selectionActions`), add to vocabulary (`<WordActions variant="icon">`).
- `lookup.ts` (`lookupWord`, `translateText`, cached variants incl. `cachedTranslate`, `normalizeSelection`).
- `prompts.ts` extracts desktop prompts from enjoy command sources (via `~/shims/enjoy-sources`).
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): `LookupLayer`, `cachedTranslate`, `normalizeSelection`, `LOOKUP_SERVER_ERRORS`, `LookupResult`, `TextSelectionInfo`. Other directories import only `~/features/lookup`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/lookup`

## Pitfalls
- Prompts are read from enjoy source text with `?raw`; never copy or edit them in `enjoy/`.
- Lookup is disabled inside realtime call captions.
- Dictionary first: `run` calls `lookupDictionary` before the model; a miss or any error silently falls back to the AI path. Long selections never ask the dictionary. Dictionary results are not cached (they carry the user's `def_lang`).
- Read aloud is contributed by chat (core contribution); lookup never imports chat.
- The bar keeps `data-testid="lookup-trigger"` on its look up / translate button.
- The add-to-vocabulary button is the `<WordActions>` slot (`~/lib/extension-points-react`), not a vocabulary import (no lookup→vocabulary edge).
