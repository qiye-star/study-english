# Liquid glass · L6 agents + realtime call Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4, §6 (mapping), §12 D-3; v2 mockup `convo()` (composer plates)
> and the spec §2.4 rows "Call screen radial blue wash", "Achievements/agents tints". Starts after **L2**; parallel with
> L3–L5, L7–L11. Coordinates with L5 only through classes on agents components rendered inside the chat composer.

**Goal:** agents (persona picker/editor, memory page, process card/capsule, source chips, step sheet, tutor bar/recap/start,
agent settings) lose all tints: selection = graphite chip, notes = neutral wells, statuses = mono chips with coloured 16px
icons only, word marks underlined, buttons pills. The agents parts that live **inside the chat composer** (tutor entry chip,
tutor bar, persona control) put their text on plates (Rule 4). Realtime call: the blue radial wash is replaced by the page
background + sheen, caption cards are E1 tiles, the call dock and text-draft panel become **unblurred** floating panels
(`mat-float`; INDEX D-3, they carry key labels), keys are wells, the hang-up key keeps its red fill, push-to-talk pressed
stays accent, the live dot turns green.

**Architecture:** additive classes only (R-LG1); no structure change. `.glass` on the call dock / draft is neutralised under
liquid with `liquid:backdrop-filter-none` + `mat-float` (higher specificity than `.glass`).

## Global Constraints

- Owned files: `web/src/features/agents/**`, `web/src/features/realtime/**` (INDEX §9).
- `agents/memory` stays self-contained and `agents/tutor` is only reached via `import()` (architecture test) — import
  `~/components/liquid` (a component-layer module) is allowed there.
- `memory/layout-360.test.ts` scans memory sources: never add `w-[NNNpx]` ≥ 328 or `overflow-x-auto`.
- Negative assertions in `realtime-call-screen.test.tsx:205-210` (`not /rounded-full|h-key|w-key/` on the PTT key): when
  adding `liquid:rounded-full` there, narrow that regex to classic tokens: `not.toMatch(/(?<![\w:-])(rounded-full|h-key|w-key)\b/)`.
- Worktree `.claude/worktrees/lg-l6`, branch `feat/lg-l6`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/agents src/features/realtime` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L6

- **R-L6-1** Selected persona / chip / filter = `LQ_CHIP_ON` (graphite). Unselected = `LQ_CHIP`.
- **R-L6-2** Process step status: the icon keeps green (done) / accent spinner (running) / red (failed) at 16px; the tile
  behind it becomes a well. Status pills mono; failed text stays red.
- **R-L6-3** Inside the chat composer every agents text sits on `plate` (TutorEntry chip, tutor bar status/notes, persona
  control label).
- **R-L6-4** Call screen: wash `liquid:hidden`; root gets `page-bg`; dock/draft `mat-float` unblurred; keys
  `liquid:bg-wash`; hang-up unchanged; PTT pressed `bg-blue` unchanged (accent = active control).

## Per-file edits — agents

| File:line | Current fragment | Append / change |
|---|---|---|
| `agent-settings-page.tsx:51`, `persona-editor-sheet.tsx:195`, `:204`, `memory/manage-tab.tsx:104` | switch `data-[state=unchecked]:bg-surface-2` / `enabled ? "bg-blue" : "bg-surface-2"` | + ` liquid:data-[state=unchecked]:bg-wash-2` / `enabled ? "bg-blue" : "bg-surface-2 liquid:bg-wash-2"` |
| `agent-settings-page.tsx:140`, `persona-editor-sheet.tsx:207`, `persona-picker.tsx:134` | note `rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber…` | + ` ${LQ_NOTE}` |
| `step-sheet.tsx:28` | note `rounded-[10px] bg-blue-tint px-3 py-2 text-meta text-blue` | + ` ${LQ_NOTE}` |
| `agent-settings-page.tsx:186`, `persona-editor-sheet.tsx:39`, `tutor/tutor-start-sheet.tsx:35` | `on ? "bg-blue-tint font-semibold text-blue" : "b…"` / `on ? "border-blue bg-blue-tint text-blue" : "border-hair bg-surface te…"` | on-branch + ` ${LQ_CHIP_ON}`; off-branch + ` ${LQ_CHIP}`; base string of the chip + ` liquid:rounded-full` |
| `memory/items-tab.tsx:90` | `filter === f ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink-2")` | `filter === f ? "bg-blue-tint text-blue ${LQ_CHIP_ON}" : "bg-surface-2 text-ink-2 ${LQ_CHIP}")` (use template literals) |
| `persona-editor-sheet.tsx:42-43` source tone map (`lookup: "bg-teal-tint text-teal"`, `… "bg-amber-tint text-amber"`) | values | each value + ` ${LQ_ICON_WELL}` (it is an icon tile) |
| `persona-editor-sheet.tsx:36` | field `… focus-visible:ring-blue/30"` | + ` ${LQ_FIELD_MULTI}` if it is a textarea, else ` ${LQ_FIELD}` (Read the element) |
| `persona-editor-sheet.tsx:226` | `… rounded-button px-1 text-sub font-semibold text-red …` | unchanged (destructive text link) |
| `persona-editor-sheet.tsx:236`, `report-persona-sheet.tsx:66`, `step-sheet.tsx:38` | `… rounded-button bg-blue text-body font-semibold text-…` (sheet primary) | + ` ${LQ_PRIMARY}` |
| `persona-picker.tsx:33` | `builtin ? "bg-surface-2 text-ink-2" : "bg-blue-tint text-blue")` | + ` ${LQ_CHIP}` on both branches |
| `persona-picker.tsx:42` | `on ? "border-blue bg-blue text-on-blue" : "border-hair"` | `on ? "border-blue bg-blue text-on-blue ${LQ_CHIP_ON}" : "border-hair liquid:border-transparent liquid:bg-wash"` + base ` liquid:rounded-tile` |
| `persona-picker.tsx:111` | `rounded-[5px] bg-amber-tint px-1.5 text-label font-medium text-amber` | + ` ${LQ_CHIP}` |
| `process-capsule.tsx:38` | `… rounded-full bg-blue-tint px-2.5 py-1 text-meta font-medium text-blue` | + ` ${LQ_CHIP}` |
| `process-card.tsx:18-20` | `cn(base, "bg-green-tint text-green")`, `cn(base, "bg-blue-tint text-blue")`, `cn(base, "bg-red-tint text-red")` | each + `, "liquid:bg-wash liquid:shadow-well liquid:rounded-full"` (icon colour stays) |
| `process-card.tsx:49`, `:51` | `cn(pill, "bg-blue-tint text-blue")`, `cn(pill, "bg-green-tint text-green")` | + `, LQ_CHIP` |
| `process-card.tsx:44`, `:53` | `cn(pill, "hit-expand bg-surface text-red", …)`, `cn(pill, "bg-surface text-red")` | + `, "liquid:rounded-full liquid:bg-wash"` |
| `process-card.tsx:64` | `failed ? "bg-red-tint" : "bg-surface-2"` | `failed ? "bg-red-tint well" : "bg-surface-2 well"` + base ` liquid:rounded-inset` |
| `process-card.tsx:68` | `failed ? "bg-surface text-red" : personal ? "bg-amber-tint text-amber" : "bg-teal-tint text-teal"` | wrap: `cn(…, LQ_ICON_WELL)` and keep `text-red` for failed (add `failed && "liquid:text-red"`) |
| `source-chips.tsx:30` | `… rounded-full bg-teal-tint px-2.5 text-meta font-medium text-teal …` | + ` ${LQ_CHIP}` |
| `chat-parts.tsx:109` (TutorEntry, inside the composer) | `… rounded-full bg-blue-tint px-2.5 text-sub font-semibold text-blue …` | + ` plate liquid:text-ink` (Rule 4) |
| `memory/profile-tab.tsx:86-87` | `className="flex flex-col gap-2 bg-amber-tint p-3.5">`, `<p className="break-words text-sub text-amber">` | + ` ${LQ_NOTE}`; + ` ${LQ_INK}` |
| `memory/ui.ts` | `PRIMARY = \`${BASE} bg-blue …\``, `GHOST = …`, `DANGER = \`${BASE} bg-red-solid …\``, `FIELD = "…"` | PRIMARY + ` ${LQ_PRIMARY}`; GHOST + ` ${LQ_SECONDARY}`; DANGER + ` ${LQ_DANGER_TEXT}` (清空 is destructive, not the reset confirm); FIELD + ` ${LQ_FIELD}`; `KIND_TONE` unchanged (ToneBadge is mono via L2) |
| `memory/confirm-sheet.tsx` | sheet buttons (Read) | primary + `LQ_PRIMARY`, cancel + `LQ_SECONDARY`, destructive + `LQ_DANGER_TEXT` |
| `tutor/tutor-bar.tsx:66-78` (inside the composer) | level text `text-ink-2`; confirming `font-semibold text-blue`; progress `h-1 rounded-full bg-blue`; status `mt-2 rounded-[10px] bg-amber-tint px-2.5 py-1.5 text-sub text-a…` | root container (Read: the outermost element) + ` plate liquid:rounded-[18px] liquid:px-3 liquid:py-2`; progress track + ` ${LQ_BAR_TRACK}`; status box + ` liquid:bg-transparent liquid:text-ink-2 liquid:px-0` (already on the plate) |
| `tutor/tutor-bar-panel.tsx` | outer wrapper (Read) | nothing if it only renders `TutorBar`; if it renders text outside it, + ` plate` on that wrapper |
| `tutor/tutor-recap-card.tsx:13`, `:24`, `:63` | `BAR` map `{ good: "bg-green", ok: "bg-blue", weak: "bg-am…" }`; title `tone === "green" ? "text-green" : "text-amber"`; words `text-body text-teal` | use sites + ` liquid:bg-ink/85`; title + ` ${LQ_INK}`; words + ` ${LQ_MARK}` |
| `persona-chip.tsx` (persona control in the conversation capsule) | Read: if it shows a text label next to the avatar inside `GlassTopBar` leading, add ` plate liquid:rounded-full liquid:px-2` to that label element; if it is avatar-only, no change | Rule 4 |

## Per-file edits — realtime

| File:line | Current fragment | Append / change |
|---|---|---|
| `realtime-call-screen.tsx:19` `DOCK` | `"glass relative z-30 mx-4 mb-[max(12px,env(safe-area-inset-bottom))] flex-none rounded-dock border-[0.5px] border-hair"` | + ` mat-float liquid:backdrop-filter-none liquid:rounded-float liquid:mx-2` |
| `call-text-draft.tsx:41` | `"glass relative z-30 mx-4 mb-2 flex flex-none flex-col gap-2 rounded-sheet border-[0.5px] border-hair p-3"` | + ` mat-float liquid:backdrop-filter-none liquid:rounded-tile liquid:mx-2` |
| `realtime-call-screen.tsx:250` wash | `className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[52%] bg-[radial-gradient(…var(--blue-wash)…)]"` | + ` liquid:hidden` |
| `realtime-call-screen.tsx` root | the outermost element of the call screen (Read; it carries `bg-background` or `bg-bg`) | + ` page-bg` |
| `realtime-call-screen.tsx:238` | `className="text-amber">{t("web.realtime.degraded")}` | + ` liquid:text-ink-2` |
| `realtime-call-screen.tsx:267` | `… rounded-button bg-blue px-4 text-body font-semibold …` | + ` ${LQ_PRIMARY}` |
| `realtime-call-screen.tsx:277` | `"relative z-30 mx-4 mb-2 flex flex-none flex-col gap-2 rounded-card border-[0.5px] border-hair bg-surface p-2 shadow-card"` | + ` mat-float liquid:rounded-tile liquid:mx-2` |
| `call-dock.tsx:18` `KEY_CIRCLE` | `"relative flex h-key w-key items-center justify-center rounded-full border-[0.5px] …"` | + ` liquid:border-transparent liquid:bg-wash liquid:shadow-well` |
| `call-dock.tsx:23` | `circle: cn(KEY_CIRCLE, "border-transparent bg-blue text-on-blue")` | unchanged (`bg-blue` is a plain class; add `liquid:bg-blue` so the well does not override it: `cn(KEY_CIRCLE, "border-transparent bg-blue text-on-blue liquid:bg-blue liquid:shadow-none")`) |
| `call-dock.tsx:25` | `circle: cn(KEY_CIRCLE, "border-transparent bg-red-solid text-white")` | `cn(KEY_CIRCLE, "border-transparent bg-red-solid text-white liquid:bg-red-solid liquid:shadow-none")` |
| `call-dock.tsx:127` PTT | `active ? "border-transparent bg-blue text-on-blue" : "border-hair …"` | active + ` liquid:bg-blue`; inactive + ` liquid:border-transparent liquid:bg-wash liquid:shadow-well`; base + ` liquid:rounded-full` (then narrow the negative regex, see constraints) |
| `call-dock.tsx:246` live dot | `live ? "bg-blue motion-safe:animate-pulse" : …` | `live ? "bg-blue liquid:bg-green motion-safe:animate-pulse" : …` |
| `call-hero.tsx:30` level bar | `className="h-full rounded-sm bg-blue"` | + ` liquid:bg-ink/85` |
| `call-hero.tsx:68` ring | `… rounded-full border-[1.5px] border-blue …` | + ` liquid:border-ink-3` |
| `call-captions.tsx:24` | `"flex-none rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5"` | + ` ${LQ_TILE}` |
| `call-captions.tsx:25` | `you ? "text-blue" : "text-ink-2"` | `you ? "text-blue liquid:text-ink" : "text-ink-2"` |
| `call-captions.tsx` score badge (`TONE_CLASS[scoreBadgeTone(…)]`) | Read | + `liquid:rounded-full liquid:bg-wash liquid:text-ink-2` and a `<ScoreDot score={…} />` before the number |
| `call-caption-translation.tsx:84` | `open ? "text-blue" : "text-ink-2",` | unchanged (active toggle) |

---

## Task L6-1: agents chips, notes, buttons, process card

**Files:** the agents rows above except the composer ones; tests: append to `web/src/features/agents/persona-picker.test.tsx`
(or the nearest existing test of the picker; Read) one liquid case:
```tsx
import { setLiquid } from "~/test/glass";
  it("liquid: the chosen persona is a graphite chip (plan 2026-10-15-liquid-glass R-L6-1)", async () => {
    setLiquid(true);
    // render the picker with a chosen persona exactly like the existing selection test, then:
    const chosen = document.querySelector("[aria-pressed='true'], [aria-checked='true']")!;
    expect(chosen.className).toContain("liquid:bg-graphite");
    setLiquid(false);
  });
```
- [ ] **Step 1:** Apply the agents rows (all files except `chat-parts.tsx`, `tutor/tutor-bar.tsx`, `tutor/tutor-bar-panel.tsx`, `persona-chip.tsx`).
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/agents src/architecture.test.ts` — green.
- [ ] **Step 3:** Commit `feat(web): mono agents chips, notes and process card`.

---

## Task L6-2: agents parts inside the chat composer (Rule 4)

**Files:** `chat-parts.tsx`, `tutor/tutor-bar.tsx`, `tutor/tutor-bar-panel.tsx`, `persona-chip.tsx`, `tutor/tutor-bar.test.tsx`.

- [ ] **Step 1 (test):** Append to `tutor/tutor-bar.test.tsx`:
```tsx
import { setLiquid, textOutsidePlates } from "~/test/glass";
  it("liquid: the whole tutor bar sits on a plate (Rule 4, plan 2026-10-15-liquid-glass R-L6-3)", () => {
    setLiquid(true);
    // render the bar exactly like the first existing test, wrapped in a blurred parent:
    // const { container } = render(<div className="mat-chrome-bar"><TutorBar … /></div>);
    expect(textOutsidePlates(document.querySelector(".mat-chrome-bar")!)).toEqual([]);
    setLiquid(false);
  });
```
- [ ] **Step 2:** Apply the composer rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/agents src/features/chat/conversation-page.agent.test.tsx src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): agents composer parts on plates`.

---

## Task L6-3: realtime call screen

**Files:** realtime rows above; `realtime-call-screen.test.tsx` (narrow one regex; add one case).

- [ ] **Step 1 (test):** In `realtime-call-screen.test.tsx` change the PTT negative assertion (around line 207) from
  `not.toMatch(/rounded-full|h-key|w-key/)` to `not.toMatch(/(?<![\w:-])(rounded-full|h-key|w-key)\b/)` and add a case:
```tsx
  it("liquid: dock is an unblurred floating panel, wash hidden, hang-up still red (plan 2026-10-15-liquid-glass R-L6-4)", async () => {
    setLiquid(true);
    // render the call screen exactly like the existing dock test, then:
    const dock = screen.getByTestId(/* the dock's test id used at line ~280 */ "call-dock");
    expect(dock.className).toContain("mat-float");
    expect(dock.className).toContain("liquid:backdrop-filter-none");
    setLiquid(false);
  });
```
  (Use the dock test id that the existing `/\bglass\b/` assertion at line ~280 queries.)
- [ ] **Step 2:** Apply the realtime rows. Check `liquid:backdrop-filter-none` exists in Tailwind 3.4 (`backdrop-filter-none`);
  if the class is not generated, use `liquid:[-webkit-backdrop-filter:none] liquid:[backdrop-filter:none]`.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/realtime src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid realtime call screen`.

---

## Task L6-4: docs

- [ ] `web/src/features/agents/CLAUDE.md` and `web/src/features/realtime/CLAUDE.md` (create a "Liquid glass" bullet in each):
  agents — "selection graphite, notes wells, composer parts on plates (Rule 4)"; realtime — "dock/draft are `mat-float`
  (unblurred, they carry labels); no blue wash; hang-up keeps red".
- [ ] Commit `docs(web): agents and realtime liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] Call screen at 667px height in liquid: dock labels readable, captions end above the dock.
- [ ] Graphite-free call: "you" captions in ink are still distinguishable from the partner (label text 你 / name).
