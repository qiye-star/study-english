# web/src/features/progress/

Learning progress page (`/progress`): stats, score chart, recent items.

## What lives here
- `progress-page.tsx`, `score-chart.tsx` (chart.js), `stats-api.ts` (`GET /api/stats` with local timezone offset).
- `i18n/{en,zh-CN}.json` — this feature's strings.

## Public surface
Public (`index.ts`): `ProgressPage`, `getStats`, `Stats`. Other directories import only `~/features/progress`; add exports there only when another directory needs them.

## Allowed dependencies
- `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via their `index.ts`. See `../CLAUDE.md`.

## Test
- `cd web && yarn vitest run src/features/progress`

## Pitfalls
- Scores use the semantic scale from `components/score-tone.ts`.
