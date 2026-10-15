# Liquid glass · L5 chat (list, conversation, sheets, grammar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3 (R-LG1/2/5/6), §5.4, §6, §7; v2 mockup frames "对话列表"
> (`chatlist()`, `.fabp`) and "对话页" (`convo()`: `.b.ai.m1`, `.b.me` graphite, `.composer.m2.capbar`, `.hint2.plate`,
> `.hold.plate`, `.sheet.m3` with `.plate`). Starts after **L2**; parallel with L3, L4, L6–L11.

**Goal:** chat list new layout — large title 对话 + count subtitle, a 继续 hero for the most recent conversation (the one
accent pill 继续对话), one grouped 全部对话 panel, and 新对话 as an **unblurred** floating pill (`mat-float`) above the tab
bar. Conversation restyle — AI bubbles E1 (`.m1`, tail 8), own bubbles graphite, capsule title only, scenario/level line on
E0 at the top of the list, floating composer (`mat-chrome-bar`, inset 8, radius 26) whose hint row, notices, text field and
hold bar sit on plates (Rule 4), mono result badges with score dots, word marks instead of amber fills, sheets via L2,
dialogs via `LQ_DIALOG`. Grammar: its one dialog.

**Architecture:** additive classes everywhere (R-LG1). Structure branches (R-LG2): the conversation list body
(`ConversationListLiquid`, new file, rendered when `useLiquid()`), and in `conversation-page.tsx` the subtitle moves out of
the capsule into an E0 line (liquid only). The composer stays one element; `mat-chrome-bar` overrides `.glass` (higher
specificity) so it stays one blur layer.

## Global Constraints

- Owned files: `web/src/features/chat/**`, `web/src/features/grammar/**` (INDEX §9). Agents parts rendered inside the
  composer (`TutorEntry`, `TutorBarSlot`, `ChatPersonaControl`, process capsule, source chips) belong to **L6**.
- Keep every test id (`conversation-new`, `conversation-item`, `conversation-delete`, `conversations-empty`, `chat-composer`,
  `chat-hints`, `chat-input`, `conversation-scenario`, `conversation-level`, …) exactly once in the DOM in both skins.
- Blur budget (INDEX §7): list 1 → 2 (FAB = 0); conversation 3 (capsule + composer + tab bar) + 1 sheet/popover.
  `conversation-header-actions.tsx` is added to `BLUR_OWNERS` (popover = transient T3).
- Watch negative assertions (INDEX R-LG12): `conversation-page.agent.test.tsx:410` (`not /(^|\s)h-8(\s|$)/`) — the classes
  added here never contain a bare `h-8`.
- Worktree `.claude/worktrees/lg-l5`, branch `feat/lg-l5`, junctioned `node_modules`. CRLF: single-line anchors; `conversation-page.tsx`
  is 1417 lines — always Read the anchor's neighbourhood first.
- Tests per task: listed files + `src/architecture.test.ts`; lane end: `cd web && yarn vitest run src/features/chat src/features/grammar` and `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L5

- **R-L5-1** List hero = `items[0]` (the API returns newest first; verify in `chat-api.ts`, otherwise sort by `updatedAt`
  desc for the hero only). It shows avatar, name, relative time and 继续对话; no last-message preview (INDEX D-6).
- **R-L5-2** 新对话 FAB: `mat-float`, `fixed right-3 bottom-[var(--tab-bar-space)] z-30`, pill 48 high, `+` icon + label;
  it is the only `conversation-new` under liquid (the header action is not rendered). The list gets `liquid:pb-20`.
- **R-L5-3** Own bubble: `bg-graphite text-on-graphite`, secondary text inside it `on-graphite/75`, links/voice glyphs
  `on-graphite`; tail top-right 8. AI bubble: `mat-surface`, tail top-left 8.
- **R-L5-4** Composer: one `mat-chrome-bar` element; every text node inside is on a `plate` (hint row button, notices,
  textarea, hold bar from L2) — asserted with `textOutsidePlates()`.
- **R-L5-5** Pronunciation badge: mono pill + `ScoreDot`; grammar badge mono pill. Mixed-voices hint `ink-2`.

## Per-file edits

Import in each touched file what it uses from `~/components/liquid` (and `ScoreDot` / `useLiquid` where noted).

| File:line | Current fragment | Append / change |
|---|---|---|
| `conversation-page.tsx` (component body, after `const navigate = …` / first hooks) | — | `const liquid = useLiquid();` (import from `~/lib/glass-flag`) |
| `conversation-page.tsx:~1203` | `        subtitle={subtitle}` (inside `<GlassTopBar …>`) | `        subtitle={liquid ? undefined : subtitle}` |
| `conversation-page.tsx:~1227` | `        <div aria-hidden className="mt-auto" />` | that line + `        {liquid && subtitle ? <p data-testid="conversation-subtitle-line" className="text-center text-meta text-ink-2">{subtitle}</p> : null}` (E0 caption; moves the scenario/level test ids out of the capsule under liquid only) |
| `conversation-page.tsx:~1225` | `style={{ paddingTop: "calc(52px + env(safe-area-inset-top) + 12px)", paddingBottom: composerHeight + 14 }}>` | `style={{ paddingTop: "calc(52px + env(safe-area-inset-top) + 12px)", paddingBottom: composerHeight + 14 + (liquid ? 8 : 0) }}>` |
| `conversation-page.tsx:~1226` list div | `className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-gutter"` | same + ` ${LQ_PAGE}` (template) |
| `conversation-page.tsx:~1279` composer | `className="glass glass-edge-t absolute inset-x-0 bottom-0 z-30 px-2 pb-2"` | same + ` mat-chrome-bar liquid:inset-x-2 liquid:bottom-2 liquid:rounded-float liquid:pt-0.5` |
| `conversation-page.tsx:~1281` hold-hint | `className="mx-1 mt-2 rounded-[10px] bg-surface-2 px-3 py-2 text-center text-sub font-medium text-ink"` | + ` plate liquid:rounded-[18px]` |
| `conversation-page.tsx:~1284` autospeak-blocked | `className="mx-1 mt-2 flex items-center gap-1 rounded-[10px] bg-surface-2 pl-3 text-sub text-ink"` | + ` plate liquid:rounded-[18px]` |
| `conversation-page.tsx:~1296` agent-off-notice | same class string as above (second occurrence) | + ` plate liquid:rounded-[18px]` (Edit with enough context to make it unique) |
| `conversation-page.tsx:~1320` chat-hints button | `className="hit-expand flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-inline text-sub font-semibold text-amber focus-visible:outline-none …"` | insert after `text-amber`: ` plate liquid:h-9 liquid:rounded-full liquid:px-3 liquid:text-ink` |
| `conversation-page.tsx:~1370` Textarea | `className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-button border-[0.5px] border-hair bg-surface px-3.5 …"` | + ` plate liquid:rounded-field liquid:border-0` |
| `message-bubble.tsx:~27` BubbleAction | `on ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surface-2",` | `on ? "bg-blue-tint text-blue liquid:bg-wash" : "text-ink-2 hover:bg-surface-2 liquid:hover:bg-wash",` and base string `"inline-flex h-tap min-w-tap … rounded-[9px] px-2 …"` + ` liquid:rounded-full` |
| `message-bubble.tsx:66` | `isUser ? "rounded-tr-[6px] bg-blue-tint" : "rounded-tl-[6px] border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none",` | `isUser ? "rounded-tr-[6px] bg-blue-tint liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite liquid:[&_.text-ink-2]:text-on-graphite/75 liquid:[&_.text-blue]:text-on-graphite" : "rounded-tl-[6px] border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none mat-surface liquid:rounded-tile liquid:rounded-tl-tail",` |
| `message-bubble.tsx:123` | `… rounded-button px-2 text-sub font-medium text-blue …` | + ` liquid:rounded-full` |
| `conversation-header-actions.tsx:13` SwitchVisual | `on ? "bg-blue" : "bg-surface-2 shadow-hair")}>` | `on ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2")}>` |
| `conversation-header-actions.tsx` `rowClass` | `"flex min-h-row w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors duration-fast",` | + ` liquid:rounded-tile liquid:hover:bg-wash` |
| `conversation-header-actions.tsx` | the `PopoverPrimitive.Content` `className="…"` (Read it) | append ` mat-sheet liquid:rounded-tile liquid:p-1` |
| `conversations-page.tsx` | see Task L5-1 (liquid branch) | — |
| `conversations-page.tsx:133-137` AlertDialog | `<AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">`; Cancel `className="h-11 rounded-button"`; Action `className="h-11 rounded-button bg-red-solid text-white hover:bg-red-solid/90"` | Content + ` ${LQ_DIALOG}`; Cancel + ` ${LQ_SECONDARY}`; Action + ` ${LQ_DANGER_TEXT} liquid:hover:bg-wash-2` |
| `hints-sheet.tsx:33`, `recap-sheet.tsx:181`, `scenario-sheet.tsx:125` | error box `… rounded-card bg-surface-2 py-1 pl-3.5 pr-1 text-sub text-red">` | + ` well liquid:rounded-inset` |
| `hints-sheet.tsx:50` | `<BubbleAction data-testid="hint-fill" className="text-blue" …` | unchanged (accent action) |
| `recap-sheet.tsx:165` | `className="mr-1 rounded-[4px] bg-amber-tint px-[3px] text-body font-medium text-amber">` | + ` ${LQ_MARK}` (template) |
| `recap-sheet.tsx:194` | `className="flex items-center gap-2 rounded-card bg-amber-tint py-1 pl-3.5 pr-1 text-sub …` | + ` ${LQ_NOTE}` |
| `recap-sheet.tsx` score (`scoreToneClass`) | the element using `scoreToneClass(…)` (Read) | + ` ${LQ_INK}` and a `<ScoreDot score={…} />` next to the number |
| `turn-detail-sheet.tsx:75` | `className="select-text break-words rounded-card bg-blue-tint px-3.5 py-3 text-title …` | + ` ${LQ_WELL} liquid:text-ink` |
| `turn-detail-sheet.tsx:81` | `<span {...lookupContext} className="font-medium text-amber">` | + ` ${LQ_MARK}` |
| `voice-transcript.tsx:11` | `className="rounded-[4px] bg-amber-tint px-[3px] text-amber"` | + ` ${LQ_MARK}` |
| `voice-picker.tsx:89` | `active ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surfa…"` | `active ? "bg-blue-tint text-blue liquid:bg-wash" : …` (selected text stays accent) |
| `sheet-form.tsx:19` Group container | `<div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">` | + ` well liquid:rounded-inset liquid:border-0` (inside a sheet's plate: a well, not an E1) |
| `sheet-form.tsx:13`, `:40` | field `… focus-visible:ring-blue/30 …"`; switch `data-[state=unchecked]:bg-surface-2` | field + ` ${LQ_FIELD}`; switch + ` liquid:data-[state=unchecked]:bg-wash-2` |
| `result-badges.tsx` `Badge` | `cn("inline-flex h-[22px] … rounded-[7px] px-2 text-meta font-semibold tracking-[0.01em] num", TONE_CLASS[tone])` | `cn(…, TONE_CLASS[tone], "liquid:rounded-full liquid:bg-wash liquid:font-medium liquid:text-ink-2")`; `badgeButton` string + ` liquid:rounded-full` |
| `result-badges.tsx` PronunciationBadge | `{label}` inside `<Badge …>` | `{score !== null ? <ScoreDot score={score} /> : null}{label}` |
| `result-badges.tsx:44` | `className="basis-full text-meta text-amber"` | + ` liquid:text-ink-2` |
| `grammar/grammar-prompt-editor.tsx:110-117` | `<AlertDialogContent>`; Cancel `className="h-11"`; Action `className="h-11"` | `<AlertDialogContent className={LQ_DIALOG}>`; Cancel ``className={`h-11 ${LQ_SECONDARY}`}``; Action ``className={`h-11 ${LQ_DANGER_TEXT}`}`` |

---

## Task L5-1: chat list liquid body + FAB

**Files:** Create `web/src/features/chat/conversation-list-liquid.tsx`; Modify `web/src/features/chat/conversations-page.tsx`,
`web/src/features/chat/conversations-page.test.tsx`, `web/src/features/chat/i18n/{zh-CN,en}.json`.

- [ ] **Step 1:** i18n: in both chat `i18n` files, inside `web.chat`, add (zh) `"listCount": "{{count}} 个对话", "continue": "继续", "continueAction": "继续对话", "all": "全部对话"`;
  (en) `"listCount": "{{count}} conversations", "continue": "Continue", "continueAction": "Continue", "all": "All conversations"`.
  Put them next to the existing `"new"` key (Read the file; single-line anchor on the `"new":` line).
- [ ] **Step 2 (test):** Append to `conversations-page.test.tsx` (reuse its fetch setup; Read it):
```tsx
import { blurLayers, setLiquid } from "~/test/glass";

describe("chat list in the liquid skin (plan 2026-10-15-liquid-glass L5-1)", () => {
  afterEach(() => setLiquid(false));

  it("hero continues the latest conversation; one grouped panel; unblurred new-chat pill", async () => {
    setLiquid(true);
    // render the page with two conversations exactly like the existing list test, then:
    const cont = await screen.findByTestId("conversation-continue");
    expect(cont).toHaveAttribute("href", expect.stringMatching(/^\/chat\//));
    expect(cont.className).toContain("liquid:shadow-accent");
    expect(screen.getAllByTestId("conversation-item").length).toBeGreaterThanOrEqual(2);
    const fab = screen.getByTestId("conversation-new");
    expect(fab.className).toContain("mat-float");
    expect(screen.getAllByTestId("conversation-new")).toHaveLength(1);
    expect(blurLayers(document.body).filter((el) => el.contains(fab))).toHaveLength(0);
  });

  it("empty state uses the shared EmptyState panel", async () => {
    setLiquid(true);
    // render with an empty list exactly like the existing empty test, then:
    expect(await screen.findByTestId("conversations-empty")).toHaveTextContent(/./);
    expect(screen.getByTestId("conversations-empty").className).toContain("mat-surface");
  });
});
```
  (Copy the existing tests' `renderWithProviders` + fetch-mock routes for the two cases.)
- [ ] **Step 3:** Write `web/src/features/chat/conversation-list-liquid.tsx`:
```tsx
import { ChevronRightIcon, MessagesSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatDateTime } from "@renderer/lib/utils";
import { Avatar } from "~/components/avatar";
import { EmptyState } from "~/components/empty-state";
import { IconButton } from "~/components/icon-button";
import { LQ_PANEL, LQ_PANEL_STRONG, LQ_PRIMARY } from "~/components/liquid";
import { cn } from "~/lib/cn";
import type { Conversation } from "./chat-api";
import { displayName } from "./chat-request";

/**
 * 对话列表的液态布局(设计稿 chatlist();计划 2026-10-15-liquid-glass L5-1):「继续」英雄面板(唯一强调色按钮)、
 * 一个「全部对话」分组面板、不模糊的「新对话」悬浮胶囊(mat-float,底栏上方 8px)。数据与动作全部来自 ConversationsPage。
 */
export function ConversationListLiquid({ items, loaded, error, next, loadingMore, onLoadMore, onDelete, onNew, errorBox }: {
  items: Conversation[];
  loaded: boolean;
  error: string | null;
  next: number | null;
  loadingMore: boolean;
  onLoadMore(): void;
  onDelete(c: Conversation): void;
  onNew(): void;
  errorBox: ReactNode;
}) {
  const { t } = useTranslation();
  const latest = items[0];
  return (
    <div className="px-frame pb-20">
      {!loaded && <p className="py-10 text-center text-sub text-ink-2">{t("web.common.loading")}</p>}
      {errorBox}
      {loaded && !items.length && !error && (
        <EmptyState testId="conversations-empty" icon={MessagesSquareIcon} title={t("web.chat.empty")} className="mt-2" />
      )}
      {latest && (
        <section aria-labelledby="chat-continue" className={cn("mt-2 p-4", LQ_PANEL_STRONG)}>
          <h2 id="chat-continue" className="mb-3 flex items-center justify-between text-sub font-semibold text-ink-2">
            {t("web.chat.continue")}
            <span className="num font-normal">{formatDateTime(latest.updatedAt)}</span>
          </h2>
          <div className="flex items-center gap-3">
            <span aria-hidden><Avatar name={displayName(latest, t("web.chat.untitled"))} size="sm" className="size-11 text-body" /></span>
            <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink">{displayName(latest, t("web.chat.untitled"))}</p>
          </div>
          <div className="mt-3 flex justify-end">
            <Link to={`/chat/${latest.id}`} data-testid="conversation-continue"
              className={cn("inline-flex h-[38px] items-center gap-1 rounded-button bg-blue px-[15px] text-sub font-semibold text-on-blue", LQ_PRIMARY)}>
              {t("web.chat.continueAction")}<ChevronRightIcon aria-hidden className="size-4" />
            </Link>
          </div>
        </section>
      )}
      {items.length > 0 && (
        <section aria-labelledby="chat-all" className={cn("mt-4 overflow-hidden py-1.5", LQ_PANEL)}>
          <h2 id="chat-all" className="px-4 pb-1 pt-2 text-sub font-semibold text-ink-2">{t("web.chat.all")}</h2>
          <ul className="divide-y-[0.5px] divide-hair-2">
            {items.map((c) => {
              const name = displayName(c, t("web.chat.untitled"));
              return (
                <li key={c.id} className="flex items-center pr-1">
                  <Link to={`/chat/${c.id}`} data-testid="conversation-item"
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 transition-colors duration-fast active:bg-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span aria-hidden><Avatar name={name} size="sm" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{name}</span>
                      <span className="num mt-0.5 block text-meta text-ink-2">{formatDateTime(c.updatedAt)}</span>
                    </span>
                    <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
                  </Link>
                  <IconButton data-testid="conversation-delete" className="text-ink-2" label={t("web.common.delete")} onClick={() => onDelete(c)}>
                    <Trash2Icon />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {next && (
        <button type="button" disabled={loadingMore} onClick={onLoadMore}
          className="mx-auto mt-2 flex min-h-tap items-center rounded-full px-4 text-sub font-medium text-blue disabled:opacity-50">
          {t("web.common.loadMore")}
        </button>
      )}
      <button type="button" data-testid="conversation-new" onClick={onNew}
        className="mat-float fixed bottom-[var(--tab-bar-space)] right-3 z-30 inline-flex h-12 items-center gap-1.5 rounded-full px-[18px] text-body font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PlusIcon aria-hidden className="size-5" />{t("web.chat.new")}
      </button>
    </div>
  );
}
```
- [ ] **Step 4:** Edit `conversations-page.tsx`:
  1. Imports: + `import { useLiquid } from "~/lib/glass-flag";`, `import { LQ_DANGER_TEXT, LQ_DIALOG, LQ_SECONDARY } from "~/components/liquid";`,
     `import { ConversationListLiquid } from "./conversation-list-liquid";`.
  2. After `const [pickerOpen, setPickerOpen] = useState(false);` add `  const liquid = useLiquid();`.
  3. Single line `      <PageHeader title={t("web.chat.title")} actions={` → replace the whole `<PageHeader … } />` element (lines 72–77)
     with:
```tsx
      {liquid ? (
        <PageHeader large title={t("web.chat.title")} subtitle={items.length ? t("web.chat.listCount", { count: items.length }) : undefined} />
      ) : (
        <PageHeader title={t("web.chat.title")} actions={
          <button type="button" data-testid="conversation-new" onClick={() => setPickerOpen(true)}
            className="hit-expand mr-1 inline-flex h-8 items-center gap-1 rounded-full bg-blue pl-2.5 pr-3 text-sub font-semibold text-on-blue transition-opacity duration-fast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <PlusIcon aria-hidden className="h-4 w-4" />{t("web.chat.new")}
          </button>
        } />
      )}
```
     (The classic element is byte-identical to lines 72–77.)
  4. Extract the error box (lines 80–90) into `const errorBox = error ? (…) : null;` placed before `return` (same JSX),
     render `{errorBox}` where it was. Then wrap the classic body: single line `      <div className="px-gutter pb-6 pt-1">` →
     `      {liquid ? <ConversationListLiquid items={items} loaded={loaded} error={error} next={next} loadingMore={loadingMore} onLoadMore={() => next && void load(next)} onDelete={setPendingDelete} onNew={() => setPickerOpen(true)} errorBox={errorBox} /> : (`
     + the original line; and after the body's closing `      </div>` (line 125) add `      )}`.
  5. AlertDialog rows of the table.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/features/chat/conversations-page.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts` — green.
- [ ] **Step 6:** Commit `feat(web): liquid chat list with continue hero and floating new-chat pill`.

---

## Task L5-2: conversation page — composer, bubbles, E0 subtitle

**Files:** Modify `conversation-page.tsx`, `message-bubble.tsx`, `conversation-header-actions.tsx`,
`web/src/styles/glass-budget.test.ts` (append `"features/chat/conversation-header-actions.tsx": "header menu popover (T3, transient)"`),
`conversation-page.test.tsx`.

- [ ] **Step 1 (test):** Append to `conversation-page.test.tsx` (reuse the file's loaded-conversation setup; Read it):
```tsx
import { blurLayers, setLiquid, textOutsidePlates } from "~/test/glass";

describe("conversation in the liquid skin (plan 2026-10-15-liquid-glass L5-2)", () => {
  afterEach(() => setLiquid(false));

  it("composer is one blurred layer and every text on it is on a plate (Rule 4)", async () => {
    setLiquid(true);
    // render a loaded conversation with one user and one assistant message, as the existing tests do
    const composer = await screen.findByTestId("chat-composer");
    expect(composer.className).toContain("mat-chrome-bar");
    expect(textOutsidePlates(composer)).toEqual([]);
    expect(blurLayers(document.body).length).toBeLessThanOrEqual(2); // capsule (scrolled) + composer; tab bar +1 outside
  });

  it("own bubbles are graphite, AI bubbles are E1; the level line sits on the page, not in the capsule", async () => {
    setLiquid(true);
    // render a conversation whose options.level is "B1" (copy the existing level test's setup)
    expect(await screen.findByTestId("conversation-level")).toBeInTheDocument();
    expect(screen.getAllByTestId("conversation-level")).toHaveLength(1);
    expect(screen.getByTestId("conversation-subtitle-line")).toContainElement(screen.getByTestId("conversation-level"));
    const user = document.querySelector(".liquid\\:bg-graphite");
    expect(user).not.toBeNull();
    expect(document.querySelector(".mat-surface.liquid\\:rounded-tl-tail")).not.toBeNull();
  });
});
```
- [ ] **Step 2:** Apply the `conversation-page.tsx`, `message-bubble.tsx`, `conversation-header-actions.tsx` rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/features/chat/conversation-page.test.tsx src/features/chat/conversation-page.agent.test.tsx src/features/chat/bubble-actions.test.tsx src/features/chat/voice-ui.test.tsx src/features/chat/hold-to-talk-button.test.tsx src/styles/glass-budget.test.ts src/architecture.test.ts` — green.
  If `textOutsidePlates` reports text from agents parts (`TutorEntry` chip, persona control), that is L6's work: assert
  with those strings filtered out and leave a `// L6 plates these` comment, and tell the controller.
- [ ] **Step 4:** Commit `feat(web): liquid conversation composer and bubbles`.

---

## Task L5-3: chat sheets, badges, word marks, grammar dialog

**Files:** Modify `hints-sheet.tsx`, `recap-sheet.tsx`, `scenario-sheet.tsx`, `turn-detail-sheet.tsx`, `voice-transcript.tsx`,
`voice-picker.tsx`, `sheet-form.tsx`, `result-badges.tsx`, `grammar/grammar-prompt-editor.tsx`; add one test case to
`result-badges` coverage (if no `result-badges.test.tsx` exists, create it):
```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLiquid } from "~/test/glass";
import { PronunciationBadge } from "./result-badges";

describe("result badges (plan 2026-10-15-liquid-glass R-L5-5)", () => {
  afterEach(() => setLiquid(false));
  it("mono pill with a score dot", () => {
    setLiquid(true);
    render(<PronunciationBadge view={{ status: "done", scores: { pronunciationScore: 91 } } as never} onOpen={vi.fn()} />);
    const badge = screen.getByTestId("badge-pronunciation");
    expect(badge.querySelector("span")!.className).toContain("liquid:bg-wash");
    expect(badge.querySelector("[data-score-dot]")!.className).toContain("bg-green");
  });
});
```
- [ ] **Step 1:** Apply the table rows for these files.
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/chat src/features/grammar src/architecture.test.ts` — green.
- [ ] **Step 3:** Commit `feat(web): liquid chat sheets, badges and word marks`.

---

## Task L5-4: docs

- [ ] `web/src/features/chat/CLAUDE.md`: add `- Liquid glass (plan 2026-10-15-liquid-glass L5): list body = ConversationListLiquid (liquid only; FAB is mat-float, never blurred); composer = one mat-chrome-bar, all text on plates (Rule 4); own bubbles graphite. Keep test ids single in both skins.`
- [ ] Commit `docs(web): chat liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] iOS keyboard open: the floating composer (inset 8, bottom 8) still sits above the keyboard (the `--app-height` fix is itself unverified).
- [ ] Long-press lookup on a graphite bubble: selection/active-word highlight is readable on graphite.
- [ ] Low-end Android: scrolling a long conversation with capsule + composer + tab bar blurring.
