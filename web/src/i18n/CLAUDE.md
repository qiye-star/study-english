# web/src/i18n/

i18next setup. Merges desktop strings (`enjoy/src/shared/i18n/*.json` via `~/shims/enjoy-sources`) with every `**/i18n/{en,zh-CN}.json` in `src/` (glob, sorted by path).

## What lives here
- `index.ts` — init, `SUPPORTED_LANGUAGES` (`en`, `zh-CN`, `es`), `deepMerge`, `webMessages`.
- `en.json`, `zh-CN.json` — app-wide strings (`web.*`).

## Allowed dependencies
- `i18next`, `react-i18next`, `shims/`.

## Entry points
- Imported for side effects by `main.tsx` and `test/setup.ts`; `settings/` changes the language.

## Test
- `cd web && yarn test` (`i18n/i18n.test.ts` also checks en/zh-CN key parity per directory).

## Pitfalls
- Add new strings to the nearest directory's `i18n/` (en + zh-CN together), not here, unless they are app-wide.
- Spanish only has desktop strings; web keys fall back to English.
- Never edit `enjoy/src/shared/i18n`.
