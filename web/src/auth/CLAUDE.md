# web/src/auth/

Session state and route protection.

## What lives here
- `auth-context.tsx` — `AuthProvider`/`useAuth` (user, `api` client, login/register/logout).
- `require-auth.tsx` — route guard redirecting to `/login`; while `bindingRequired` it sends every other route to `/account/email?required=1` (X26).
- `email-binding.ts` — `EMAIL_BINDING_PATH` and the pure `emailStatusOf` / `bindingRequiredOf` helpers. `AuthProvider` reads `/api/me` after login and at startup, and a 403 `email_binding_required` sets the flag (`onBindingRequired`). Never import `features/account` from here (X35).
- `validation.ts` — username/password form rules.
- `device-data.ts` — `clearDeviceData()` run on logout: practice draft, playback rate, Chinese-definition pref, composer mode, grammar revision bump, lookup/hints/TTS caches.

## Allowed dependencies
- `api/`, `lib/`, `settings/`, feature public surfaces (`~/features/<x>`) for cache-clearing hooks only.

## Test
- `cd web && yarn test` (`auth/*.test.ts(x)`).

## Pitfalls
- Logout must never throw: every cleanup step is wrapped in try/catch.
- Never log the token; storage goes through `api/auth-storage.ts`.
- New per-user local caches must be cleared in `device-data.ts` and covered by its test.
