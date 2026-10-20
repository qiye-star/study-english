# web/src/components/captcha/

Shared human-verification (ALTCHA proof-of-work) widget. Spec `docs/superpowers/specs/2026-10-20-captcha-altcha-design.md` §10, plan `docs/superpowers/plans/2026-10-20-captcha-altcha.md` W2–W3.

## What lives here
- `captcha-field.tsx` — `CaptchaField` (lazy shell). Renders a labelled group and loads `captcha-widget.tsx` with `React.lazy` only when it is rendered. In an insecure context (`window.isSecureContext === false`) it loads nothing and shows the HTTPS notice (spec R-C13).
- `captcha-widget.tsx` — the widget itself: `import "altcha"`, the `en` and `zh-cn` language packs, and `<altcha-widget>` with `challenge="/api/captcha/challenge"`, `auto="off"`, `hideFooter`. Reports `onPayload(string | null)`. Exposes `CaptchaHandle.reset({ again })`.
- `locales.ts` + `locales/{en,zh-CN}.json` — strings under `web.captcha.*`, merged by `ensureCaptchaI18n()`. Not under `i18n/`, so the eager glob never sees them (INDEX X37).
- `use-captcha-gate.ts` — `useCaptchaGate(api, scope)`: reads the mode once (`GET /api/captcha/config`, failure means `off`), says whether a captcha is `needed` (adaptive: all scopes except login until a 428; always: all), holds the payload in memory, `onServerError` (428 opens the widget) and `consumed()` (single use; re-arms the widget when still needed).
- `index.ts` — public surface: `CaptchaField`, `CaptchaFieldProps`, `CaptchaHandle`, `useCaptchaGate`, `CaptchaScope`.

## Measured (W8, `yarn web:build`, gzip -9, kB = 1000 bytes)
- `captcha-widget-*.js` (the `altcha` chunk): 40.75 kB gzip. `captcha-field-*.js` (shell): 0.90 kB gzip. Main bundle delta: +0.62 kB against the 411.67 kB baseline (`check-main-bundle.mjs --max-delta=0.65`).
- Re-measure after changing `altcha` or the language packs; do not edit the baseline to hide growth.

## Allowed dependencies
- `~/api` (types only), `~/i18n`, `~/lib`, React, `react-i18next`, the `altcha` package.
- Never a feature, `pages/`, `auth/` or `settings/` (`architecture.test.ts`).

## Rules
- The widget fetches its challenge from the same origin (`/api/captcha/challenge`) by itself. That is the only request outside `ApiClient`, and it carries no user data. Components never call `fetch` for anything else.
- The payload is only handed to the caller. Never put it in the DOM text, in storage, in a URL or in a log.
- `reset()` on the element takes a state name, not an options object, so `CaptchaHandle.reset({ again: true })` calls `reset()` and then `verify()`.
- The payload is single use (server R-C14): after each submission the caller calls `reset({ again })` again.
- The `altcha` import must come before the language packs, because the packs write into `globalThis.$altcha` when they are evaluated.
- `language` is `zh-cn` for `zh-CN` and `en` otherwise (altcha has no `es` pack).

## Test
- `cd web && yarn vitest run src/components/captcha src/architecture.test.ts`
- The widget tests replace `altcha` with a stub and a fake `<altcha-widget>` element; the real solver does not run under jsdom (not verified in a browser here).
