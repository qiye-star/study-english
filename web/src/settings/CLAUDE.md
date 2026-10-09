# web/src/settings/

`settings-context.tsx`: `SettingsProvider`/`useSettings` for device-local UI preferences (UI language, native language, `roomVoiceAutoText` = "auto-show room voice text", default off), persisted together at `enjoy-web.settings` as `{ language, roomVoiceAutoText }` and applied to i18n. Writing one preference keeps the other.

## Allowed dependencies
- `i18n/`, `lib/`. No features.

## Test
- `cd web && yarn test` (`settings/*.test.tsx`).

## Pitfalls
- Validate stored values (old or corrupt localStorage) before use, field by field; fall back to defaults.
