# web/src/pages/

Screens that are not owned by a single feature: `login-page.tsx`, `install-page.tsx`, `me-page.tsx` (the 「我的」 home), `me-services-page.tsx` (`/me/services`), `chat-hub.tsx` (the 对话 section shell: `ChatHubLayout` shows the AI 对话 | 联机 switch when rooms are on; `app.tsx` wraps `/chat`, `/rooms`, `/rooms/ended` with it via a render prop; the only place that knows both chat and rooms).

「我的」 structure (slimmed; low-frequency settings live in sub-pages):
- `me-page.tsx` home: one profile card (avatar, name, email-binding line, 3 stat tiles; the whole card links to `/me/account`), then 学习 (progress + week strip, vocabulary, wordbook, agents, `meRows` slot), 偏好 (playback rate, 中文释义 (自动显示 / 点击后显示, `settings/zh-defs-pref.ts`), room voice auto-text when rooms are on, appearance or colour scheme, language, iOS install hint), 设置 (账号设置 with 去绑定邮箱 / 已绑定 badge, 语法检查规则 with 默认 / 已自定义, 语音服务 → `/me/services`, 朗读音色 → `/me/voice`).
- `/me/account` → `features/account/account-settings-page.tsx` (`AccountSection` + `MyInviteSection` + logout at the bottom, `data-testid="account-logout"`).
- `/me/grammar` → `features/grammar/grammar-prompt-page.tsx` (editor; 恢复默认 in the top bar).
- `/me/services` → `me-services-page.tsx` (read-only STT/TTS info, retry on failure).
- The 段位卡 is not on 「我的」 (the practice hub carries rank).
- Routes for these are in `src/app.tsx`; the three sub-pages sit next to `/me/appearance` and `/me/agents`.

## Allowed dependencies
- Features only via `~/features/<name>`; `components/`, `layout/`, `auth/`, `settings/`, `api/`, `lib/`, `pwa/`, `i18n/`, `@renderer/*`.
- Not `audio/` (pages compose features). Only `app.tsx`/`main.tsx` import pages (architecture test).

## Entry points
- Routes in `src/app.tsx`. Strings in `pages/i18n/`.
- `appearance/` — 外观与主题 (`/me/appearance`, lazy from `app.tsx`; liquid only; plan `2026-10-15-liquid-glass` L3): sliders, presets, background picker, all through `useGlassTheme()`.

## Test
- `cd web && yarn test` (`pages/*.test.tsx`).

## Pitfalls
- New feature screens belong in `features/<name>/`, not here.
- Login form must never log credentials.

## Liquid glass
- Liquid glass (plan 2026-10-15-liquid-glass L11): Me = profile hero (`me-hero`) + 外观与主题 row (`me-appearance`, liquid only, links to `/me/appearance`; the colour select stays for classic); login form is an E1 panel.
