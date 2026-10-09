# web/src/components/

Shared presentational UI primitives for the redesign (glass bars, cards, sheets, chips, tones).

## What lives here
- Layout chrome: `glass-top-bar.tsx`, `glass-tab-bar.tsx`, `bottom-sheet.tsx`.
- Building blocks: `surface-card.tsx`, `section-group.tsx`, `list-card.ts`, `stat-tile.tsx`, `icon-button.tsx`, `icon-chip.tsx`, `segmented-control.tsx`, `avatar.tsx`, `tone-badge.tsx`, `markdown.tsx`.
- Feature switches: `feature-gate.tsx` (`FeatureGate`: loading / disabled / error + retry / ready; used by rank and rooms pages).
- Semantics: `tone.ts` (one meaning per hue), `score-tone.ts` (≥85 / 70–84 / <70).
- Hold-to-talk: `hold-to-talk-bar.tsx` (bar + overlay + drop zones + live region; stateful by necessity) and `use-hold-gesture.ts`, used by chat, realtime calls and rank matches; strings in `i18n/` (`web.hold.*`). `allowToText={false}` hides the 转文字 zone (voice-only: any slide-up cancels, never `fill`).

## Allowed dependencies
- React, npm UI packages, `lib/`, `@renderer/lib/utils` (shim) and `@renderer/components/ui/*`. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test).

## Test
- `cd web && yarn test` (`primitives.test.tsx`, `markdown.test.tsx`).

## Pitfalls
- Use design tokens from `styles/theme.css` (e.g. `bg-surface`, `text-ink-2`); no raw hex colors.
- Touch targets ≥ 44px; keep components stateless where possible.
