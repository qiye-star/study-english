# web/src/features/

One directory per product feature: chat, grammar, lookup, practice, progress, rank, realtime, rooms, vocabulary.

## Rules (enforced by `src/architecture.test.ts`)
- Every feature has `index.ts`; it exports only what other directories actually use.
- Outside code imports a feature only as `~/features/<name>`, never `~/features/<name>/<file>`.
- Inside a feature use relative imports (`./x`).
- Features may use `lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `i18n/`, `@renderer/*`.
- Do not use a cross-feature import at module top level (barrels form cycles; only call-time use is safe).
- New cross-feature edges are forbidden (`CROSS_FEATURE_BASELINE` in `src/architecture.test.ts`). To link features, register an
  extension-point contribution in `features/<x>/register*.ts(x)` (imported only by `src/plugins/`, never imports another feature)
  and render a `<Slot>` on the consumer side.

## Adding to a public surface
- Add the export to the feature's `index.ts`, then import it from `~/features/<name>`.
- If a helper is needed by several features and has no feature identity, move it to `lib/` (pure) or `api/` (HTTP) instead.

## Test
- `cd web && yarn test`. Tests may `vi.mock` another feature's internal module path.

## Pitfalls
- Each feature keeps its strings in its own `i18n/{en,zh-CN}.json`.
