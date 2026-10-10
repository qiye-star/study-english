# admin/src/features/links/

## What lives here
The admin 「学习联动」 page at `/admin/links` (learning links spec §9, mockup frame 07; desktop only ≥ 1024px):
`api.ts` (`LinksView` mirrors `GET /api/admin/links`, snake_case → camelCase; `fetchLinks`, `resetBreaker`),
`strings.ts` (zh-CN copy, also used by the nav item in `components/layout.tsx`), `links-page.tsx`, `link-icon.tsx`
(nav icon), `index.ts` (public exports for `app.tsx`).

## Allowed dependencies
`../../api/*`, `../../components/*`, `../../hooks/*`, `../../lib/*`. No other feature (copy small helpers instead).
`components/layout.tsx` imports only `strings.ts` and `link-icon.tsx` from here (the page imports layout; avoid a cycle).

## Test
`cd admin && yarn vitest run src/features/links` (fetch stubbed, role via `session.setSession`).

## Pitfalls
- Counters are per server process and reset on restart; say so on the page.
- The error list shows only time, link key, event class and exception class: never add user ids, words or text.
- 「复位熔断」 is operator-only (`RoleGate`; the server checks again) and not a dangerous action: no reason dialog.
  Links without event subscriptions (`subscribed: false`) show 「—」 instead of zero counters.
