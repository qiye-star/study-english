# web/src/settings/

`settings-context.tsx`: `SettingsProvider`/`useSettings` for device-local UI preferences (UI language, native language), persisted at `enjoy-web.settings` and applied to i18n.

## Allowed dependencies
- `i18n/`, `lib/`. No features.

## Test
- `cd web && yarn test` (`settings/*.test.tsx`).

## Pitfalls
- Validate stored values (old or corrupt localStorage) before use; fall back to defaults.
