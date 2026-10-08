# web/src/api/

HTTP client and server contracts shared by all features.

## What lives here
- `client.ts` — `ApiClient` (JSON/form requests, camelCase ↔ snake_case, `ApiError`, auth header).
- `ai.ts` — `/api/ai/*` helpers incl. SSE chat streaming (`streamChatCompletion`).
- `auth-storage.ts` — persisted session token (`enjoy-web.auth`), memory fallback.
- `server-config.ts` — cached server AI config (models, voices); `error-messages.ts` — server error → i18n key.
- `types.ts` — shared response types.

## Allowed dependencies
- `lib/` and npm packages only. No React components, no `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test).

## Entry points
- `new ApiClient({ getToken, fetchImpl })` (created in `auth/auth-context.tsx`).

## Test
- `cd web && yarn test` (`api/*.test.ts`; use `test/fetch-mock.ts`).

## Pitfalls
- Never log tokens or full request bodies. Feature-specific endpoints live in their feature (`*-api.ts`), not here.
- Response keys are camelCased deeply: be careful with user-provided map keys.
