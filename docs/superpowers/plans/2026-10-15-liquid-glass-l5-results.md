# Liquid glass · L5 results (2026-10-15)

Branch `feat/lg-l5`. Plan: `2026-10-15-liquid-glass-l5-chat.md`. Targeted tests only.

## Deviations (plan vs reality)

1. Anchors and tests matched the code; no frozen name or ruling changed. All edits were CRLF-preserving.
2. `BLUR_OWNERS`: `features/chat/conversation-page.tsx` was already listed (L0, classic `.glass` composer); only the
   `conversation-header-actions.tsx` line was appended. Existing text of the conversation-page entry is unchanged.
3. `sheet-form.tsx`: the plan says append `LQ_FIELD` to the field class at `:13` (the textarea). A pill radius on a multi-line
   textarea is wrong, so `textareaClass` got `LQ_FIELD_MULTI` and `selectClass` got `LQ_FIELD`.
4. `conversations-page.tsx` / `conversation-list-liquid.tsx`: test data for the two list tests uses the file's own `conv()` helper
   and `CONFIG_ROUTES`. Hero = `items[0]`; verified newest-first in `server/app/routers/conversations.py` (`updated_at desc`).
5. Rule 4: `textOutsidePlates(composer)` is `[]` with no L6 filtering needed (the tutor/persona parts render nothing in that test).
6. Added a negative case in `result-badges.test.tsx` (no score dot while pending). Chat `listCount` etc. i18n keys added to both files.
7. Cosmetic: AlertDialog "Missing Description" warnings in the list tests are pre-existing.

## Verification

- `src/features/chat src/features/grammar src/components src/test src/styles src/architecture.test.ts`: 66 files / 1311 passed.
- `yarn web:typecheck`: clean.

## UNVERIFIED

- Everything visual (no browser/device run): composer geometry (inset 8) above the iOS keyboard, graphite selection/active-word
  highlight on long-press, 3 blur layers scrolling on low-end Android, `liquid:[&_.text-ink-2]:...` arbitrary variants in real CSS.
