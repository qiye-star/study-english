# Glass popups (chat + rooms) and 清透 default - results

- Date: 2026-10-15 · Branch `fix/q-gp` · Owner requests: "long-press popups in chat and rooms transparent glass too" and "make the style default to transparent glass".

## Task A - popup inventory (chat + rooms)

Searched `web/src/features/chat` and `web/src/features/rooms` for `onContextMenu`, long-press hooks, Popover / DropdownMenu / ContextMenu, BottomSheet, AlertDialog, `data-testid="msg-actions"`, `bubble-actions`. There is no context menu and no long-press menu in chat: a long press on message text only opens the lookup bar (`features/lookup`, locked, untouched). `hold-to-talk` long-presses record audio (no popup; it only blocks the native context menu).

| # | file:line | what it is | container before | after (liquid skin) |
|---|---|---|---|---|
| 1 | rooms/extras/message-actions.tsx:42 (`MessageActions`, rendered by room-message-list.tsx:198) | tap / long-press / "more" button on a room message: 6 reactions + quote, translate, read aloud, report | plain `bg-surface` card with a shadow | **changed**: `mat-sheet liquid:rounded-tile liquid:p-0` (floating glass bezel around a solid .90 plate = the transient blur layer; text stays on the plate, Rule 4); buttons `liquid:rounded-full liquid:hover:bg-wash liquid:active:bg-wash-2`; reaction buttons round |
| 2 | chat/conversation-header-actions.tsx:93 | header options popover (bilingual, auto speak, speed, recap, settings) | Radix Popover, already `mat-sheet liquid:rounded-tile liquid:p-1` | unchanged (already the same glass) |
| 3 | chat/conversation-settings-sheet.tsx:80, hints-sheet.tsx:26, recap-sheet.tsx:117, scenario-sheet.tsx:111, sentence-practice-sheet.tsx:45, turn-detail-sheet.tsx:72 | chat bottom sheets (opened from taps / bubble actions) | `BottomSheetContent` | unchanged: default liquid branch is already the floating `mat-sheet` T3 |
| 4 | rooms/room-page.tsx:389 (report), room-settings-sheet.tsx:125, create-room-sheet.tsx:48, extras/invite-sheet.tsx:78, agents/persona-sheet.tsx:41 | room sheets (report, settings, create, invite, persona) | `BottomSheetContent` | unchanged (same T3) |
| 5 | chat/conversations-page.tsx:145, rooms/room-settings-sheet.tsx:194 | delete / leave confirmations | `AlertDialogContent` + `LQ_DIALOG` | unchanged (`mat-sheet` dialog) |

Not popups (inline, no change): `BubbleActions` rows in chat/message-bubble.tsx:36 (copy / translate / read aloud rows inside the bubble), room `ReactionBar` chips, room assist dock (drag gesture, resident layer), hold-to-talk bars.

Why not the `glass` prop of `BottomSheetContent` or `.glass-pop`: those paint text straight on blur (lookup only, locked look). Chat and room popups are text-heavy, so they use `mat-sheet` (glass bezel + plate), the same transient layer as every other liquid sheet; the lookup bar/drawer files were not touched.

Blur budget: room page resident layers = title capsule + composer/assist dock (tab bar hidden in the room) = at most 2; the action popup is the single transient layer (only one message can be selected at a time). `rooms/` is already in the BLUR_OWNERS allowlist, so no allowlist change. Test added in message-actions.test.tsx: exactly one blur layer, `mat-sheet`, no text outside plates.

## Task B - default theme is 清透

- `GLASS_DEFAULTS` now = `{ preset: "clear", ...GLASS_PRESETS.clear, radius: 1, bgStyle: "gradient", reduced: false, bg: 雾灰 / 石墨 }` (tint .70, blur 1.25, saturate 1.8, rim 1.3, shadow .80). Storage schema stays `v: 1`; no version bump. A stored theme keeps its values and its preset name; a stored theme without a name parses as 清透; `reset()` and `applyPreset` unchanged (reset returns to the new default). `styles/theme.css` keeps the 磨砂 numbers as the pre-JS fallback (the writer overrides them at boot, `main.tsx`).
- Floors untouched (`BASE` / `FLOOR` / `CEIL`, slider ranges). At the default every tier sits on its floor: light T1/T2/bar/T3 = .50/.55/.62/.62, dark = .04/.50/.58/.58; blur 30px chrome / 40px sheet.
- Appearance page: fresh user has the 清透 chip pressed and "清透" in the heading. The "已到可读下限" warning would have shown on first open (the default sits on the floor), so it now only shows when tint is clearer than the 清透 preset.
- Contrast (unit test in lib/glass-theme.test.ts; strict = plate over black in light / white in dark; card = T1 fill over the worse gradient end):

  | | ink | ink-2 |
  |---|---|---|
  | plate, light (strict) | 14.89 | 4.97 |
  | plate, dark (strict) | 12.01 | 5.75 |
  | section card T1, light | 17.02 | 5.68 |
  | section card T1, dark | 15.00 | 7.18 |

  Capsule title on bar fill over a strict backdrop: 6.94 (light), 3.75 (dark; accepted >= 3 rule for 17px titles, Rev 4). All identical in kind to the 磨砂 numbers in picks.md (plates are independent of the slider).
