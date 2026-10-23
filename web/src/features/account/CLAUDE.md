# web/src/features/account/

Account settings shown on the 「我的」(me) page: nickname, email (masked, bind / change), and password change. Accounts v2 plan (`docs/superpowers/plans/2026-10-14-accounts-foundation-email.md`, tasks W1–W7). Also holds the registration, forgot-password and bind-email pages and the forced-binding banner.

## What lives here
- `index.ts` — public surface: `AccountSection`, `MyInviteSection`, `AccountSettingsPage` (all lazy entries) plus the auth-route pages. Nothing else is imported from outside.
- `lazy.tsx` — lazy wrappers (`React.lazy` + `Suspense`), so the main bundle does not grow with the section bodies.
- `account-settings-page.tsx` — `/me/account` (linked from the Me profile card and 账号设置 row): `AccountSection` + `MyInviteSection` + the logout button (`account-logout`) at the bottom. Logic lives in the reused sections; the page only composes.
- `account-section.tsx` — the section body: loads the profile once, renders `NicknameRow`, the email row (`emailStatusOf(profile)`: masked address + verified state; the row links to `EMAIL_BINDING_PATH`, so bind and change reuse the bind page) and the change-password row. Only the masked address is ever rendered.
- `nickname-row.tsx` — nickname input and save; 422 maps to a fixed localized message, the input is never echoed.
- `password-sheet.tsx` — change-password bottom sheet; validates 8–128 characters locally, then calls `useAuth().changePassword`.
- `account-api.ts` — the only place that builds account requests (`fetchProfile`, `saveNickname`). Calls go through `ApiClient`; components never call `fetch`.
- `bind-email-page.tsx` — `/account/email` (X26, W6): bind when unbound, change with the current password when verified; `?required=1` from `RequireAuth`; success calls `refreshProfile()` and returns to `state.from`.
- `binding-banner.tsx` — pending-binding banner (deadline + 「去绑定」 link); `BindingBanner` in `lazy.tsx` only loads it while `emailStatus.binding.state === "pending"`.
- `accounts-contract.test.ts` — reads `server/tests/fixtures/accounts_contract.json` key by key (copied byte-identical from the server branch; INDEX X28) and checks every field against `UserProfile` / `AuthUser` / `EmailBindingInfo`, the email-status logic, and the real `ApiClient` parsers.
- `captcha-contract.test.ts` — reads `server/tests/fixtures/captcha_contract.json` (copied byte-identical from `feat/cap-s`) and checks the captcha config, challenge shape, 428 / 503 / 404 errors against `ApiClient`, `useCaptchaGate` and `translateServerError`. Asserts shapes and key names only (fixture `cost` is a test value).
- Captcha on the account pages (W4–W6): sign-up, forgot-password and bind-email code requests use `useCaptchaGate` + `CaptchaField` from `~/components/captcha`; the bind-email confirm step does not send a payload. Payloads are single use: each request calls `consumed()` afterwards.
- `locales/{en,zh-CN}.json` — strings under `web.account.*`, merged lazily by `locales.ts` (`ensureAccountI18n`, called from every lazy entry; X37). Not under `i18n/`, so the eager glob never sees them.

## Allowed dependencies (INDEX X35)
- Shared layers only: `~/api`, `~/auth` (`useAuth`), `~/components`, `~/i18n`, `~/lib`, `@renderer/*`.
- No import of another feature (`~/features/<x>`). `auth/auth-context.tsx` must never import this feature. Other features must not import it either; `pages/me-page.tsx` reaches it only through `~/features/account`.

## Test
- `cd web && yarn vitest run src/features/account src/auth/auth-context.test.tsx` (and `src/pages` for the me page).
- Tests drive `AuthProvider` with `fetchImpl` from `~/test/fetch-mock`; no real network. The contract test needs the fixture file in `server/tests/fixtures/`; re-copy it when the server re-records it.

## Pitfalls
- Never log or persist the password or tokens. Only `auth-storage` stores the (rotated) access token.
- Display name: read `displayNameOf(user)` from `~/api/types` (`displayName ?? name`). Do not repeat the fallback expression.
- Logout from the account area is `logout(true)` in the auth context; it asks the server to end the session first and always clears local state even when that request fails.
- English labels must not overflow at 360–375 px: keep buttons `whitespace-nowrap` and titles `truncate`.
- The bundle budget is ≤ 1.5 kB gzip for the whole F plan (`web/scripts/check-main-bundle.mjs`); keep new code inside this lazy section.
