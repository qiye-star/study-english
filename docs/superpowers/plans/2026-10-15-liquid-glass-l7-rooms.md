# Liquid glass · L7 rooms (lobby, create, room, voice, assist, extras, ended) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4, §6, §7 (room page = capsule + composer + tab bar; the assist
> dock must not add a 4th blur), spec §7 "Rooms" row; v2 `convo()` for bubbles/composer. Starts after **L2**; parallel.

**Goal:** rooms follow the chat grammar: lobby with a large title and E1 panels/row cards, code input wells, own bubbles
graphite, others E1 tiles, floating composer (`mat-chrome-bar`, inset 8, radius 26) whose status row and input sit on plates,
assist dock as an **E1** panel (never blurred), reaction bar mono with graphite for "mine", buttons in `rooms/ui.ts` pills,
sheets/dialogs via L2 + `LQ_DIALOG`, tutor/agents bits mono.

**Architecture:** additive classes (R-LG1) only; no structure change. `PageHeader large` on the lobby.

## Global Constraints

- Owned files: `web/src/features/rooms/**` (INDEX §9).
- Keep test ids/roles; assertions to respect: `room-composer.test.tsx` (`border-blue/40` present/absent, `size-tap`,
  `before:-inset-`), `room-message-list.test.tsx` (`not /\bself-(start|end)\b/`, `items-end`, `max-w-[88%]`,
  `flex-row-reverse`, `size-7`) — never add a `self-*` token; `assist-dock.test.tsx:44` (`not "backdrop"` in the dock
  class) — the dock gets `mat-surface`, never a backdrop class; `assist-entry.test.tsx`, `reaction-bar.test.tsx`
  (`bg-blue-tint` present/absent: additive keeps them true).
- Worktree `.claude/worktrees/lg-l7`, branch `feat/lg-l7`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/rooms` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L7

- **R-L7-1** Composer = one `mat-chrome-bar` element; status row, input wrapper and any text on it are plates (Rule 4).
- **R-L7-2** Assist dock = `mat-surface` (E1) inset 8 with radius 26 on the top corners; never blurred (INDEX §7).
- **R-L7-3** "Mine" (bubbles, reactions, chosen tutor answer, chosen agent) = graphite; others = E1 tile / mono chip.
- **R-L7-4** The tutor countdown ring is ink; it turns red only when urgent (existing rule).

## Per-file edits

| File:line | Current fragment | Append / change |
|---|---|---|
| `ui.ts` | `primaryButton`, `smallPrimaryButton` (`… bg-blue …`) | each + ` ${LQ_PRIMARY}` (import from `~/components/liquid`) |
| `ui.ts` | `ghostButton`, `smallGhostButton` (`… border-hair bg-surface …`) | each + ` ${LQ_SECONDARY}` |
| `ui.ts` | `fieldInput` | + ` ${LQ_FIELD}` |
| `room-composer.tsx:80` | `className="glass glass-edge-t absolute inset-x-0 bottom-0 z-30 px-2 pb-2 pt-2"` | + ` mat-chrome-bar liquid:inset-x-2 liquid:bottom-2 liquid:rounded-float` |
| `room-composer.tsx:82` | `"mx-1 mb-2 flex min-h-8 items-center gap-1 rounded-badge bg-surface-2 pl-3 text-sub text-ink"` | + ` plate liquid:rounded-full` |
| `room-composer.tsx:70` | `… rounded-[8px] bg-blue-tint pl-2 pr-0.5 text-meta font-semibold text-blue …` | + ` plate liquid:rounded-full liquid:text-ink` |
| `room-composer.tsx:101` | `cn("relative flex h-tap min-w-0 flex-1 items-center rounded-button bg-surface pr-1.5 transition-shadow duration-fast",` | first string + ` plate liquid:rounded-full` |
| `room-composer.tsx:129` slash menu | `"absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface py-1 shadow-card dark:shadow-none"` | + ` mat-float liquid:rounded-tile` (unblurred popup) |
| `room-composer.tsx:133` | `i === current && "bg-surface-2"` | `i === current && "bg-surface-2 liquid:bg-wash"` |
| `room-composer.tsx:155` | `className={cn(keyClass, "bg-blue text-on-blue active:bg-blue/9…` | + `, "liquid:rounded-full"` inside the `cn` |
| `room-message-list.tsx:250` | `className="min-w-0 rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5">` | + ` ${LQ_TILE}` (template) |
| `room-message-list.tsx:280` | `mine ? "rounded-tr-inline bg-blue-tint" : "rounded-tl-inline border-[0.5px] border-hair bg-surface")}>` | `mine ? "rounded-tr-inline bg-blue-tint liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite liquid:[&_.text-ink-2]:text-on-graphite/75 liquid:[&_.text-blue]:text-on-graphite" : "rounded-tl-inline border-[0.5px] border-hair bg-surface mat-surface liquid:rounded-tile liquid:rounded-tl-tail")}>` |
| `room-message-list.tsx:320` | `className="min-w-0 rounded-card rounded-tr-inline bg-blue-tint px-3 py-2 text-body leading-d…` | + ` liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite` |
| `room-message-list.tsx:44`, `:287` | `<span className="font-semibold text-blue">…`, `… text-label font-semibold text-blue">` | + ` ${LQ_INK}` |
| `voice/voice-bubble.tsx:163` | `mine ? "bg-blue text-on-blue" : "bg-surface-2…"` | `mine ? "bg-blue text-on-blue liquid:bg-on-graphite liquid:text-graphite" : "bg-surface-2 … liquid:bg-wash"` |
| `voice/voice-bubble.tsx:168` | `mine ? "text-blue" : "text-ink"` | `mine ? "text-blue liquid:text-on-graphite" : "text-ink"` |
| `assist/assist-dock.tsx:152` | `cn("absolute inset-x-0 z-[29] flex flex-col overflow-hidden rounded-t-[16px] bg-surface",` | first string + ` mat-surface liquid:inset-x-2 liquid:rounded-t-float` |
| `assist/assist-dock.tsx:163` | `… rounded-[8px] bg-blue-tint text-blue [&_svg]:size-4">` | + ` ${LQ_ICON_WELL}` |
| `assist/assist-dock.tsx:177` | `… rounded-[7px] bg-amber-tint px-[7px] text-label font-semibold text-amber">` | + ` ${LQ_CHIP}` |
| `assist/assist-dock.tsx:198` | `… rounded-button rounded-tr-[6px] bg-blue-tint px-3 py-[7px] text-body text-…` | + ` liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite` |
| `assist/assist-dock.tsx:206` | `… rounded-badge px-2.5 text-sub font-semibold text-blue …` | + ` liquid:rounded-full` |
| `assist/assist-dock.tsx:218` | `className="rounded-inline bg-surface-2 px-2 py-[3px] text-meta text-ink"` | + ` well liquid:rounded-full` |
| `assist/assist-entry.tsx:18` | `open ? "bg-blue-tint text-blue" : "bg-blue text-on-blue shadow-[…] active:bg-blue/90")}>` | `open ? "bg-blue-tint text-blue ${LQ_CHIP_ON}" : "bg-blue text-on-blue shadow-[…] active:bg-blue/90")}>` (template literal) |
| `assist/suggestion-card.tsx:27`, `:32` | `` `${action} bg-blue text-on-blue …` ``, `` `${action} bg-surface text-ink shadow-hair active:bg-surface-2` `` | + `` ` ${LQ_PRIMARY}` `` / `` ` ${LQ_SECONDARY}` `` |
| `code-input.tsx:26` | `"flex h-14 items-center justify-center rounded-button border-[0.5px] border-hair bg-surface text-headline …"` | + ` well liquid:rounded-tile liquid:border-0` |
| `create/join-requests.tsx:14-15` | `sbtnPrimary`, `sbtnGhost` | + `${LQ_PRIMARY}` / `${LQ_SECONDARY}` |
| `create/join-requests.tsx:79` | `"overflow-hidden rounded-button bg-surface text-sub text-ink shadow-[…]"` | + ` mat-float liquid:rounded-tile` |
| `create/scenario-picker.tsx:29` | `on ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 font-medium text-ink-2")}>` | `on ? "… ${LQ_CHIP_ON}" : "… ${LQ_CHIP}"` (template literals) |
| `create/settings-fields.tsx:83`, `room-settings-sheet.tsx:139` | switch `data-[state=unchecked]:bg-surface-2` | + ` liquid:data-[state=unchecked]:bg-wash-2` |
| `create/settings-fields.tsx:144`, `room-settings-sheet.tsx:28`, `:135`, `:175`, `agents/agents-section.tsx:58` | grouped list `… rounded-card (border-[0.5px] border-hair) bg-surface (shadow-hair)` (inside sheets) | + ` well liquid:rounded-inset liquid:border-0` |
| `create/settings-fields.tsx:171` | stepper `… rounded-badge bg-surface-2 text-ink …` | + ` ${LQ_ICON_WELL}` |
| `create/settings-fields.tsx` `Segments` (room level/join segments; Read) | track and option classes (`rounded-lg`, `bg-seg-on text-ink shadow-seg`) | mirror L2-3: track + ` liquid:rounded-full liquid:bg-wash liquid:shadow-well`; option + ` liquid:rounded-full`; checked + ` liquid:bg-surface liquid:text-blue liquid:shadow-[0_2px_8px_-3px_rgba(17,19,24,.25)]` |
| `room-settings-sheet.tsx:165`, `agents/agents-section.tsx:82` | `… rounded-[9px] px-3 … hover:bg-surface-2 …` | + ` liquid:rounded-full liquid:hover:bg-wash` |
| `room-settings-sheet.tsx:193`, `:200` | `<AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">`; confirm `h-11 rounded-button bg-red-solid text-white hover:bg-red-solid…` | + ` ${LQ_DIALOG}`; + ` ${LQ_DANGER_TEXT}`; cancel + ` ${LQ_SECONDARY}` |
| `rooms-lobby-page.tsx` | `<PageHeader …` (Read) | add `large` |
| `rooms-lobby-page.tsx:118` | lobby row `… active:bg-surface-2 …` | + ` liquid:active:bg-wash liquid:px-4` |
| `rooms-lobby-page.tsx:119`, `extras/invite-page.tsx:95`, `extras/summary-card.tsx:24` | `… rounded-badge bg-blue-tint text-blue">` | + ` ${LQ_ICON_WELL}` |
| `rooms-lobby-page.tsx:137` | `"mt-3 flex min-h-row items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-3 shadow-hair …"` | + ` ${LQ_TILE} liquid:mt-4` |
| `rooms-lobby-page.tsx`, `ended/ended-rooms-page.tsx`, `room-page.tsx`, `extras/*-page.tsx` page wrappers | `px-gutter` | + ` ${LQ_PAGE}` |
| `ended/ended-rooms-page.tsx:60-61` | row `active:bg-surface-2`; icon `rounded-badge bg-surface-2 text-ink-2` | + ` liquid:active:bg-wash`; + ` ${LQ_ICON_WELL}` |
| `extras/invite-page.tsx:80` | `… rounded-card bg-surface-2 text-ink-2"><LinkIcon …` | + ` ${LQ_ICON_WELL}` |
| `extras/invite-page.tsx:104`, `extras/summary-page.tsx:39` | `cn(badge, "bg-blue-tint text-blue")` | `cn(badge, "bg-blue-tint text-blue", LQ_CHIP)` |
| `extras/summary-page.tsx:54`, `extras/activity-line.tsx:43` | `… text-blue" />` icons | + ` ${LQ_INK}` |
| `extras/summary-page.tsx:74` | `className="flex-none [&_button:not(:disabled)]:text-teal">` | + ` liquid:[&_button:not(:disabled)]:text-ink` |
| `extras/message-actions.tsx:9` | `"aria-pressed:bg-blue-tint aria-pressed:text-blue …"` | + ` liquid:aria-pressed:bg-wash` |
| `extras/message-actions.tsx:46` | `on ? "bg-blue-tint" : "hover:bg-surface-2 active…"` | `on ? "bg-blue-tint liquid:bg-wash" : …` |
| `extras/reaction-bar.tsx:25` | `mine ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink")}>` | `mine ? "… ${LQ_CHIP_ON}" : "… ${LQ_CHIP}"` |
| `agents/target-row.tsx:39`, `agents/tutor-start.tsx:43` | `pressed ? "bg-blue text-on-blue" : "bg-surface-2 text-ink-2"` / `a.id === chosen ? "bg-blue text-on-blue" : "bg-surface-2 text-ink"` | on + ` ${LQ_CHIP_ON}`; off + ` ${LQ_CHIP}` |
| `agents/target-row.tsx:45` | `block ? "text-ink-2" : "text-blue"` | `block ? "text-ink-2" : "text-blue liquid:text-ink-2"` |
| `agents/tutor-bar.tsx:44` | `urgent && seconds <= 10 ? "stroke-red" : "stroke-blue",` | `urgent && seconds <= 10 ? "stroke-red" : "stroke-blue liquid:stroke-ink",` |
| `agents/tutor-bar.tsx:95`, `:98` | `mine ? "border-blue bg-blue-tint" : "border-hair bg-surface")`; `mine ? "font-semibold text-blue" : "text-ink"` | `mine ? "border-blue bg-blue-tint liquid:border-transparent liquid:bg-surface liquid:shadow-[inset_0_0_0_1.5px_rgb(var(--ink))]" : "border-hair bg-surface mat-surface"` + base ` liquid:rounded-tile`; `mine ? "font-semibold text-blue liquid:text-ink" : "text-ink"` |
| `agents/agent-answer.tsx:17`, `agents/agents-section.tsx:76`, `agents/persona-sheet.tsx:13` | chips `rounded-full bg-surface-2 px-… text-label text-ink-2` | + ` ${LQ_CHIP}` |
| `agents/agent-answer.tsx:62` | `… text-label font-semibold text-amber">` | + ` ${LQ_INK2}` |

---

## Task L7-1: buttons, inputs, lobby, create, ended, extras

- [ ] **Step 1 (test):** Append to `rooms-lobby-page.test.tsx` (Read; reuse its render):
```tsx
import { setLiquid } from "~/test/glass";
  it("liquid: large title and E1 row cards (plan 2026-10-15-liquid-glass L7)", async () => {
    setLiquid(true);
    // render the lobby like the first existing test, then:
    expect(await screen.findByRole("heading", { level: 1 })).toHaveClass("text-large");
    setLiquid(false);
  });
```
- [ ] **Step 2:** Apply rows for `ui.ts`, `code-input.tsx`, `create/**`, `rooms-lobby-page.tsx`, `ended/**`, `extras/**`, `room-settings-sheet.tsx`.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/rooms src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid rooms lobby, buttons and sheets`.

## Task L7-2: room page — composer, bubbles, voice, assist, agents

- [ ] **Step 1 (test):** Append to `room-composer.test.tsx`:
```tsx
import { setLiquid, textOutsidePlates } from "~/test/glass";
  it("liquid: one blurred composer, text only on plates (Rule 4, R-L7-1)", () => {
    setLiquid(true);
    // render the composer like the first existing test, then:
    const composer = screen.getByTestId("room-composer");
    expect(composer.className).toContain("mat-chrome-bar");
    expect(textOutsidePlates(composer)).toEqual([]);
    setLiquid(false);
  });
```
  and to `assist/assist-dock.test.tsx`:
```tsx
  it("liquid: the dock is an E1 panel without blur (R-L7-2)", () => {
    setLiquid(true);
    // render the dock open like the existing height test; select the dock element the same way, then:
    expect(dock.className).toContain("mat-surface");
    expect(dock.className).not.toContain("backdrop");
    expect(dock.className).not.toMatch(/mat-chrome|mat-sheet/);
    setLiquid(false);
  });
```
  If `textOutsidePlates` reports a placeholder-like text node (e.g. an empty-state hint rendered as text in the input
  wrapper), make sure that element is inside the `plate` wrapper; never filter strings out in the test.
- [ ] **Step 2:** Apply rows for `room-composer.tsx`, `room-message-list.tsx`, `voice/**`, `assist/**`, `agents/**`.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/rooms src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid room page, composer and assist dock`.

## Task L7-3: docs

- [ ] `web/src/features/rooms/CLAUDE.md`: bullet "Liquid glass (plan 2026-10-15-liquid-glass L7): composer one mat-chrome-bar with plates; assist dock E1 (never blurred, budget = capsule + composer + tab bar); mine = graphite."
- [ ] Commit `docs(web): rooms liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] Room with assist dock open + keyboard on iOS: dock (E1) and composer (E2) do not overlap; 3 blur layers max.
- [ ] Voice bubbles of mine: play button `on-graphite` circle readable in dark mode (graphite is light grey there).
