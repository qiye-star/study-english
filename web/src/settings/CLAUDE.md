# web/src/settings/

`settings-context.tsx`: `SettingsProvider`/`useSettings` for device-local UI preferences (UI language, native language, `roomVoiceAutoText` = "auto-show room voice text", default off), `colorScheme` (`system | light | dark`, default `system`, type and `readStoredColorScheme` in `color-scheme-pref.ts`), persisted together at `enjoy-web.settings` as `{ language, roomVoiceAutoText, colorScheme }` and applied to i18n. Writing one preference keeps the others.

## What lives here
- `color-scheme-pref.ts`: `ColorScheme` type, `readStoredColorScheme` (no React; `layout/color-scheme.ts` reads it before first render).

## Allowed dependencies
- `i18n/`, `lib/`. No features.

## Test
- `cd web && yarn test` (`settings/*.test.tsx`).

## Pitfalls
- Validate stored values (old or corrupt localStorage) before use, field by field; fall back to defaults.
- Tests with a whole-object `toEqual` on the stored settings (settings-context, me-page) must be updated when a field is added.
