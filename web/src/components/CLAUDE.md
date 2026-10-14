# web/src/components/

Shared presentational UI primitives for the redesign (glass bars, cards, sheets, chips, tones).

## What lives here
- Layout chrome: `glass-top-bar.tsx`, `glass-tab-bar.tsx`, `bottom-sheet.tsx`.
- Building blocks: `surface-card.tsx`, `section-group.tsx`, `list-card.ts`, `stat-tile.tsx`, `icon-button.tsx`, `icon-chip.tsx`, `segmented-control.tsx`, `avatar.tsx`, `tone-badge.tsx`, `markdown.tsx`.
- Admin-driven notices: `announcement-banner.tsx` (`AnnouncementBanner`, shared `useAnnouncements` store polling the public
  `GET /api/announcements` every 5 min / on visibility / at once when an API call answers 503 `Maintenance`
  (`noteMaintenance`, wired as `ApiClient.onMaintenance`, at most every 10 s); dismissals in `localStorage["announcement.dismissed"]`) and
  `maintenance-screen.tsx` (full-maintenance page). `app.tsx`'s `AnnouncementFrame` places the banner above every route.
- Feature switches: `feature-gate.tsx` (`FeatureGate`: loading / disabled / error + retry / ready; used by rank and rooms pages).
- `zh-note-fold.tsx` — `ZhNoteFold`: folded "Chinese" note (note_zh / hint_zh). No copy of its own: callers pass already-translated `showLabel` / `hideLabel` from their lazy locales; 44 px toggle, `lang="zh-CN"` text, never read aloud.
- `zh-toggle.tsx` — `ZhToggle`: stateless 「中文」 pill (`aria-pressed`, 44 px). No copy of its own (callers pass the label). Used by the wordbook after-answer panel and the lookup drawer (plan `2026-10-14-review-bilingual-longpress`).
- Semantics: `tone.ts` (one meaning per hue), `score-tone.ts` (≥85 / 70–84 / <70).
- Hold-to-talk: `hold-to-talk-bar.tsx` (bar + overlay + drop zones + live region; stateful by necessity) and `use-hold-gesture.ts`, used by chat, realtime calls and rank matches; strings in `i18n/` (`web.hold.*`). `allowToText={false}` hides the 转文字 zone (voice-only: any slide-up cancels, never `fill`).

## Allowed dependencies
- React, npm UI packages, `lib/`, `@renderer/lib/utils` (shim) and `@renderer/components/ui/*`. Never `features/`, `pages/`, `layout/`, `auth/`, `settings/` (architecture test).

## Test
- `cd web && yarn test` (`primitives.test.tsx`, `markdown.test.tsx`).

## Pitfalls
- Use design tokens from `styles/theme.css` (e.g. `bg-surface`, `text-ink-2`); no raw hex colors.
- Touch targets ≥ 44px; keep components stateless where possible.
