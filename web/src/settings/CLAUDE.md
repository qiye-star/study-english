# web/src/settings/

`settings-context.tsx`: `SettingsProvider`/`useSettings` for device-local UI preferences (UI language, native language, `roomVoiceAutoText` = "auto-show room voice text", default off), `colorScheme` (`system | light | dark`, default `system`, type and `readStoredColorScheme` in `color-scheme-pref.ts`), persisted together at `enjoy-web.settings` as `{ language, roomVoiceAutoText, colorScheme }` and applied to i18n. Writing one preference keeps the others.

## What lives here
- `color-scheme-pref.ts`: `ColorScheme` type, `readStoredColorScheme` (no React; `layout/color-scheme.ts` reads it before first render).
- `tts-voice-pref.ts`:朗读音色偏好(「我的 → 朗读音色」,`/me/voice`):场景 `word | sentence | message`,每个场景存可选的 `{model, voice}`,键 `enjoy-web.tts.voice`(登出时清)。`useTtsVoicePref()` 给页面用;播放处用纯函数 `resolveTtsVoice(scene, ai)`(存的对儿仍在 `ai.voices` 里才用,否则 `ai.defaultTts`;ai 未加载时返回空串),`storedTtsVoice` 只返回有效的存储项(单词页按口音时用它判断用户是否显式选过)。读存储逐项校验,坏值只丢弃自己那一项。`message` 场景在对话页让位于会话里显式选的音色(角色或会话设置)。
- `glass-theme-store.ts`: liquid-glass 主题自定义 store (`getGlassTheme`, `setGlassTheme` with 300 ms persistence, `subscribeGlassTheme`, `resetGlassThemeMemory`, `useGlassTheme()`), key `enjoy-web.appearance.glass`, separate from `enjoy-web.settings`; cleared at logout. Pure maths in `lib/glass-theme.ts`.

## Allowed dependencies
- `i18n/`, `lib/`. No features.

## Test
- `cd web && yarn test` (`settings/*.test.tsx`).

## Pitfalls
- Validate stored values (old or corrupt localStorage) before use, field by field; fall back to defaults.
- Tests with a whole-object `toEqual` on the stored settings (settings-context, me-page) must be updated when a field is added.
