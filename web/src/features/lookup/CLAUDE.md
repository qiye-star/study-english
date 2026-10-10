# web/src/features/lookup/

Select-to-lookup and translation layer over the whole app.

## What lives here
- `lookup-layer.tsx` (sheet, mounted by `layout/app-shell.tsx`), `use-text-selection.ts`.
- `word-target.ts` (`wordTargetFromLookup`, R19: lookup result → `WordTarget` for the `<WordActions>` slot; moved from vocabulary's `vocabularyFromLookup`, same output).
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
- The add-to-vocabulary button is the `<WordActions>` slot (`~/lib/extension-points-react`), not a vocabulary import (no lookup→vocabulary edge).
