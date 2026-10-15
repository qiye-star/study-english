# Liquid glass · L6 results (2026-10-15)

Branch `feat/lg-l6`. Plan: `2026-10-15-liquid-glass-l6-agents-realtime.md`. Targeted tests only.

## Deviations (plan vs reality)

1. All anchors matched; no frozen name or ruling changed. The import line is inserted after line 1 (except `process-card.tsx`, whose first line is a multi-line import).
2. Small pills/badges (`persona-picker` Badge and 已停用 chip, `process-capsule`): `LQ_CHIP` brings `liquid:h-7`, so `liquid:h-auto` (or `liquid:h-6` for the 24px process-card pills) is appended through `cn()` to keep their height.
3. The persona-editor input class is split into `inputBase` + `LQ_FIELD` (input/select) and `LQ_FIELD_MULTI` (textarea): tailwind-merge does not know the custom `rounded-field`, so the two radii must not be merged in one string.
4. `tutor-start-sheet` choices are multi-line left-aligned cards, not chips: `LQ_CHIP_ON` + `liquid:rounded-tile` when selected, a wash well + `liquid:rounded-tile` otherwise (instead of `LQ_CHIP`, which would force a 28px pill).
5. `step-sheet` 关闭 (bg-surface-2) also got `LQ_SECONDARY` (not listed in the plan; mapping table "ghost buttons").
6. `persona-chip`: `plate` goes on the button itself (it is the labelled pill), not on a separate label element.
7. Tutor recap bar: three ink strengths (ink/85, ink/55, ink/30; skip keeps ink-2 at 40%) instead of ink/85 for every verdict, so the segments stay distinguishable.
8. Realtime: the `LQ_PRIMARY` tokens are written literally in `realtime-call-screen.tsx` (plain string, no import). The PTT bar the regex note refers to is the shared `HoldToTalkBar` (L2); the regex was narrowed as instructed. The caption score badge got `liquid:rounded-full liquid:bg-wash liquid:text-ink-2` and a `ScoreDot`.
9. Not changed (not applicable): `tutor-bar-panel.tsx` (renders only `TutorBar`), `call-caption-translation.tsx` (active toggle stays blue), `memory/confirm-sheet.tsx` (uses `GHOST`/`DANGER` from `memory/ui.ts`).
10. `liquid:backdrop-filter-none` exists in Tailwind 3.4.17 (`.backdrop-filter-none` in corePlugins), so no arbitrary-property fallback was needed.

## Verification

- `src/features/agents` + `src/features/chat/conversation-page.agent.test.tsx` + `src/architecture.test.ts`: 31 files / 191 passed. `src/features/realtime`: 178 passed. `yarn web:typecheck`: clean.
- New tests: persona-picker (graphite chip), tutor-bar (Rule 4, seen red first), realtime-call-screen (dock `mat-float`, wash hidden, hang-up red, seen red first); one negative regex narrowed.

## UNVERIFIED

- No browser run: call screen at 667px height, readability of the dock labels on `mat-float`, that `liquid:backdrop-filter-none` beats `.glass` in the real cascade, the look of the persona chip and tutor bar plates inside the composer.
