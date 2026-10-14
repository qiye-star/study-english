# Global long-press lookup + glass lookup popups: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status.** The visual tasks (T14–T17) are **BLOCKED ON MOCKUP APPROVAL**. Owner policy: a UI change needs an approved HTML mockup first. The mockup is `docs/superpowers/design/glass-lookup-v1/mockup.html`. It is self-contained, so open it in a browser. When the owner has picked a transparency variant (A / B / C) and answered "Open decisions" below, the controller records the choice in a `## Addendum (date)` at the end of this file and unblocks T14–T17.
> **Not blocked** (no visual change, so they can start now): T1–T3 (foundation), T4–T6 (global long-press recogniser) and T7–T13 (inventory marks and guards).

**Goal.** These are the owner's requests from 2026-10-15, approved scope.
- **(A)** On 学新词 (the learn page), long-pressing the English definitions does nothing. Long-press lookup must work across the whole app, on every page that shows English learning content: definitions, examples, phrases, the wordbook learn / review / learned / spell pages, chat bubbles, hints, recap, library sentences, vocabulary, rooms, rank, practice reference texts and so on.
- **(B)** The selection action bar that appears after a long press (`lookup-bar.tsx`) and the lookup result drawer (`lookup-layer.tsx`, `dictionary-result.tsx`) become transparent, rounded glass in light and dark mode. They must match the floating glass tab bar, which is already implemented (`.glass-float`, `--tab-bar-space`, `.tab-halo`).

**Architecture.**
- **(A)** has two parts.
  1. **Marks.** Every English learning text gets a `data-lookup-context` mark through a tiny `lib/` helper (`lookupContext`, `lookupContextIf`, `ownLongPress` in `web/src/lib/lookup-context.ts`). There are per-area guard tests plus one central guard. No new cross-feature edges.
  2. **Global recogniser.** A global touch long-press recogniser lives inside the lookup feature (`use-long-press-lookup.ts`, mounted once by `LookupLayer`). It uses document-level capture listeners and a 450 ms / 8 px threshold, reusing the wordbook state machine, which moves to `lib/long-press.ts`. It selects the word under the finger with a new `selectWordAt` (`lib/select-word.ts`). It then asks `useTextSelection` to read the selection at once (`readNow`), so the existing bar appears. It swallows the click that trails a long press.
- **(B)** adds two glass recipes in `web/src/index.css`, with tokens in `web/src/styles/theme.css`:
  - `.glass-pop` for the bar: the same recipe as the tab bar, with its own tint token.
  - `.glass-sheet` for the drawer: a floating rounded card.

  It also adds an opt-in `glass` prop on `BottomSheetContent`, so other sheets are unchanged, and restyles the bar and drawer classes. Every lookup behaviour stays: dictionary first then LLM, the 中文 chip, the add-to-vocabulary and read-aloud slots, 「跟读这段」 opening the shadow sheet, and the Android press/release latch.

**Tech stack.** React 18, Tailwind 3, vitest (jsdom / node) and Testing Library. No server change, no new dependency, no `enjoy/` change.

**Related.**
- `web/src/features/lookup/CLAUDE.md`
- Plan `2026-10-14-chat-longpress-lookup-fix.md` and its results doc: the Android latch, and branch G, whose `selectWordAt` / long-press design this plan finally ships.
- Plan `2026-10-14-review-bilingual-longpress.md`: the wordbook long-press and the 中文 chip.
- Plan `2026-10-14-floating-glass-bottom-bar.md` and `docs/superpowers/design/floating-glass-bar-v1/mockup.html`: the glass tokens.
- `docs/superpowers/design/redesign-v3/design-notes.md`: the glass rules, at most 3 blur layers.

## Global Constraints

- **How this was verified.** While writing this plan, nothing was run except the mockup: it was served with `python -m http.server` on 127.0.0.1:8917 (stopped by PID), opened in the Claude browser pane, and its light / dark / variant toggles were screenshotted. All code and tests below come from reading the real code and reasoning by hand. Correct them against the first real run. Watch in particular:
  - jsdom has **no `PointerEvent`**, as noted in `choice-question-after.test.tsx:9`. The tests below therefore build events as `MouseEvent` with `pointerId` / `pointerType` / `isPrimary` defined.
  - Whether `tailwind-merge` keeps the `bg-[color:var(--…)]` / `border-[color:var(--…)]` arbitrary classes over the `Button` variant classes.
  - Whether Tailwind keeps the new `@layer utilities` classes.

  Real device behaviour (iOS Safari, Android Chrome, installed PWA) is **all unverified**. See the "Device checklist".
- **Blocking.** T14–T17 do not start before the mockup is approved. If the owner picks A or C, change only the values in the "Transparency table" (T14) and the matching test expectations.
- **Layering.** `web/src/architecture.test.ts` is never loosened. `CROSS_FEATURE_BASELINE` stays unchanged: no new `feature->feature` import.
  - New shared code goes in `lib/` (`lookup-context.ts`, `long-press.ts`, `select-word.ts`), `components/` (`bottom-sheet.tsx`) and `test/` (`lookup-marks.ts`).
  - Features and `plugins/` import only `~/lib/lookup-context`.
  - Test files may read other features' sources with `node:fs`.
- **Ownership.**
  - Change only the files listed in the "File structure" table.
  - **Do not touch** `enjoy/`, `server/` (except running the changelog test in T19), `features/library/word-tap.ts`, `features/practice/shadow/word-tap.ts`, `features/library/library.css`, `features/library/library-css.test.ts`, `features/wordbook/use-long-press.ts` or the wordbook snapshot file `__snapshots__/word-card-legacy.test.tsx.snap`. The golden file stays byte-identical; see R-M4.
- **Native selection keeps working.** The recogniser never calls `preventDefault` on `pointerdown`, `touchstart`, `contextmenu` or `selectstart`. It never sets `user-select` or `touch-action`, never clears a selection, and never runs for mouse or pen (R-L3, R-L4). The bar's `press()` / `release()` latch (`use-text-selection.ts`) is not changed.
- **Privacy.** Words and selected text never go into URLs, logs or storage. The recogniser and the helpers contain no `console.*`.
- **The worktree is CRLF.**
  - Edit existing files with the Edit tool, and keep every anchor on **one line**. If an anchor does not match, Read the file and retry.
  - Create new files with Write. "Replace the whole file" means Read, then Write.
  - The worktree needs `node_modules` junctioned from the main checkout (root and `web/`). Do not reinstall.
- **Tests.** After each task, run only that task's files: `cd web && yarn vitest run <files> src/architecture.test.ts`. Then run `yarn web:typecheck` once from the repo root before the commit. **Never** run the full `yarn web:test`, `yarn web:build` or E2E, and never rebuild or restart containers. Those happen only when the user asks.
- **Commits.** Use conventional commits (`feat(web): …` / `refactor(web): …` / `test(web): …` / `docs: …`), one task per commit, with the task's tests green after it. End the message with the implementing session's `Co-Authored-By:` line.
- **Copy.** **No new i18n keys.** The recogniser has no UI, and the glass restyle reuses every existing label.

---

## Current state (code read for this plan)

| Item | Finding |
|---|---|
| Why (A) fails on 学新词 | `readSelection` returns null unless both ends of the selection are inside a `[data-lookup-context]` (`web/src/features/lookup/use-text-selection.ts:37-43`). **No wordbook card text carries the mark**: the headword is at `features/wordbook/word-card.tsx:116`, the example at `:154`, the English definitions at `defs-en.tsx:15` and the phrases at `phrases-section.tsx:41`. The only wordbook mark is the answered review option word (`choice-question.tsx:131`). So when the OS does make a native selection on the learn page, our bar never appears. That is exactly the owner's report. |
| Selection pipeline | `LookupLayer` is mounted once in `web/src/layout/app-shell.tsx:30` and calls `useTextSelection()` (`lookup-layer.tsx:32`). The hook debounces `selectionchange` by 300 ms. The bar renders when `selection && suggested && !open` (`lookup-layer.tsx:157`). The Android latch is `press()` / `release()` with a 600 ms grace (`use-text-selection.ts:66-105`). Its rationale is in the results doc `2026-10-14-chat-longpress-lookup-fix-results.md`. |
| Existing word-selection helpers | `lib/select-word.ts::selectWord(el)` selects a whole element. `selectWordAt(x, y)` (word at point) was designed as branch G of the chat plan but **never shipped**: `select-word.ts` has only `selectWord`. Tap-to-select copies live in `features/library/word-tap.ts:68` and `features/practice/shadow/word-tap.ts:82` and are untouched. |
| Existing long-press | Wordbook pure machine `features/wordbook/long-press.ts` (450 ms, 8 px, 400 ms click swallow) and hook `use-long-press.ts` (element-level pointer handlers, `onContextMenu` preventDefault). Used only on the answered review option rows (`choice-question.tsx:74`, `:134-141`). Rows are `role=button`, `select-none` and `[-webkit-touch-callout:none]`. |
| Marked contexts today (15) | `chat/message-bubble.tsx:107`, `chat/hints-sheet.tsx:47`, `chat/grammar-details.tsx:53`, `chat/recap-sheet.tsx:146,204`, `chat/sentence-practice-sheet.tsx:55`, `chat/turn-detail-sheet.tsx:74`, `library/shadow-panel.tsx:50`, `practice/assessment-page.tsx:83`, `practice/shadow/shadow-result.tsx:93`, `practice/shadow/shadow-sheet.tsx:262` (only when not busy), `realtime/call-captions.tsx:59`, `vocabulary/review-card.tsx:34,43`, `wordbook/choice-question.tsx:131`. |
| Bar | `lookup-bar.tsx:34`: `absolute bottom-[calc(var(--tab-bar-space)+0.5rem)] left-1/2 z-40 … rounded-full border border-border bg-surface p-1 shadow-lg select-none`. `lookup-bar-offset.test.ts` pins the offset string. |
| Drawer | `lookup-layer.tsx:159-160`: `BottomSheetContent` (`components/bottom-sheet.tsx`). It is solid `bg-surface`, `rounded-t-sheet` (20 px), `fixed inset-x-0 bottom-0 z-50`, with overlay `bg-[rgba(17,19,24,0.32)]` / dark `.55`. The bottom-sheet comment explains why it has no blur: at most 3 blur layers per screen. Inner buttons are `Button variant="outline"` at `h-11`. `DictionaryResult` renders `ZhToggle` (`components/zh-toggle.tsx`, unpressed `bg-surface border-hair`). |
| z-index (verified in code) | Tab bar `z-30` (`components/glass-tab-bar.tsx:31`); chat / room composers `z-30`; wordbook `DOCK` `z-30`; shadow sheet scrim `35`, sheet `36` (`features/practice/shadow/shadow-sheet.css:64,73`); lookup bar `z-40`; drawer overlay and content `z-50` (`bottom-sheet.tsx:28,33`). The bar is unmounted while the drawer is open (`!open`). |
| Glass recipe | `index.css:111-147` `.glass-float` (fallback `--glass-solid`; with `@supports`, `--glass-float` (.1) + `blur(28px) saturate(1.8)`; `html.lite` `--glass-float-lite` + `blur(12px)`; reduced transparency: solid `rgb(var(--surface))` + `var(--hair)` border) and `.tab-halo`. Tokens are in `styles/theme.css:42-48` (light) and `:110-116` (dark), guarded by `styles/theme.test.ts` `COLOR_TOKENS` and `styles/floating-tab-bar.test.ts`. |
| Blur budget | `library.css:5-6` + `library-css.test.ts`: on library screens `.lib-glass` / `.lib-gblur` / tab bar = 3. Chat: top `glass-bar` (after scroll) + composer `.glass` + tab bar = 3. Wordbook learn / review: page header `glass-bar` + `DOCK .glass` + tab bar = 3. **So most screens already have 3 resident layers.** |
| Golden DOM | `features/wordbook/word-card-legacy.test.tsx` snapshots `WordCardView` and must never be updated with `-u` (its own header comment). Marking the card adds attributes, so see R-M4. |
| Tests that dispatch pointers in lookup | `lookup-layer.test.tsx:298,301,323` use `fireEvent.pointerDown(trigger, { pointerType: "touch" })`. Without `PointerEvent`, jsdom drops `pointerType`. They target the bar anyway, which is not a context, so the new recogniser ignores them. |
| Doc inconsistency | `features/lookup/CLAUDE.md` says "Lookup is disabled inside realtime call captions", but `realtime/call-captions.tsx:59` carries `data-lookup-context=""`. T18 fixes the sentence. Behaviour is not changed by this plan; see Q6. |

### Inventory: English learning content and its lane

"New" means it gets a mark in this plan. Line numbers were checked on 2026-10-15.

| # | path:line | Element / text | Decision | Lane / task |
|---|---|---|---|---|
| W1 | `features/wordbook/word-card.tsx:116` | headword `<h2>` | new, only when `!covered` (R-M3) | W / T7 |
| W2 | `features/wordbook/word-card.tsx:154` | example `<p lang="en">` | new | W / T7 |
| W3 | `features/wordbook/word-card.tsx:185` | `WordRecap` word `<b>` | new | W / T7 |
| W4 | `features/wordbook/word-card.tsx:189` | `WordRecap` example `<p>` | new | W / T7 |
| W5 | `features/wordbook/defs-en.tsx:15` | each English-definition `<li>` (learn, learned, review, after-answer) | new | W / T7 |
| W6 | `features/wordbook/phrases-section.tsx:41` | phrase `en` `<span>` (both branches) | new | W / T7 |
| W7 | `features/wordbook/after-answer-panel.tsx:49` | answered word `<p>` | new | W / T8 |
| W8 | `features/wordbook/choice-question.tsx:92` | `question-word` | new, only after the answer (R-M3) | W / T8 |
| W9 | `features/wordbook/choice-question.tsx:35` | `ClozeSentence` `<p>` | new, only after the answer | W / T8 |
| W10 | `features/wordbook/choice-question.tsx:135` | answered option row | `ownLongPress` (keeps its own long-press, R-L6) | W / T8 |
| W11 | `features/wordbook/typing-question.tsx:117` | `result.expected` `<b>` | new (shown only after the answer) | W / T8 |
| W12 | `features/wordbook/session-summary.tsx:87` | missed word `<span>` | new | W / T9 |
| W13 | `features/wordbook/spell/spell-results.tsx:77` | result word `<span>` | new | W / T9 |
| W14 | `features/wordbook/spell/spell-results.tsx:33` | expected `<b>` | new | W / T9 |
| W15 | `features/wordbook/spell/explain-sheet.tsx:84` | AI explanation `<p>` | new | W / T9 |
| C1 | `features/chat/grammar-details.tsx:42` | issue `original` `<span>` | new | C / T10 |
| C2 | `features/chat/grammar-details.tsx:44` | issue `corrected` `<span>` | new | C / T10 |
| C3 | `features/chat/recap-sheet.tsx:164` | poor-word chip `<span>` | new | C / T10 |
| C4 | `features/chat/turn-detail-sheet.tsx:80` | weak words `<span>` | new | C / T10 |
| C5 | `features/agents/tutor/tutor-bar.tsx:77` | tutor hint `<p>` | new | C / T10 |
| C6 | `features/agents/tutor/tutor-recap-card.tsx:62` | suggested word `<span>` | new | C / T10 |
| C7 | `features/agents/persona-editor-sheet.tsx:215` | try-reply `<p>` | new | C / T10 |
| S1 | `features/rooms/room-message-list.tsx:39` | `MessageText` plain `<span>` | new | S / T11 |
| S2 | `features/rooms/room-message-list.tsx:41` | `MessageText` @ai `<span>` | new | S / T11 |
| S3 | `features/rooms/room-message-list.tsx:55` | `AiAnswer` English `<p>` | new | S / T11 |
| S4 | `features/rooms/room-message-list.tsx:254` | AI-answer quote `<p>` | new | S / T11 |
| S5 | `features/rooms/voice/voice-bubble.tsx:108` | text fallback `<span>` | new | S / T11 |
| S6 | `features/rooms/voice/voice-bubble.tsx:179` | transcript `<p>` | new | S / T11 |
| S7 | `features/rooms/assist/assist-dock.tsx:217` | glossary chip `<span>` | new | S / T11 |
| S8 | `features/rooms/assist/suggestion-card.tsx:18` | suggestion `en` `<p>` | new | S / T11 |
| S9 | `features/rooms/extras/summary-page.tsx:51` | fix `original` `<p>` | new | S / T11 |
| S10 | `features/rooms/extras/summary-page.tsx:54` | fix `better` `<span>` | new | S / T11 |
| S11 | `features/rooms/extras/summary-page.tsx:69` | new word `<p>` | new | S / T11 |
| S12 | `features/rooms/extras/summary-page.tsx:70` | new-word example `<p>` | new | S / T11 |
| S13 | `features/rank/match-page.tsx:40` | scenario function `<li>` (brief) | new | S / T11 |
| S14 | `features/rank/match-page.tsx:101` | partner turn `<p>` | new | S / T11 |
| S15 | `features/rank/match-page.tsx:104` | user turn `<div>` | new | S / T11 |
| S16 | `features/rank/match-page.tsx:168` | goal `<li>` (briefing) | new | S / T11 |
| S17 | `features/rank/match-result.tsx:98` | goal `<span>` | new | S / T11 |
| S18 | `features/rank/match-result.tsx:120` | drill (passed) `<p>` | new | S / T11 |
| O1 | `features/library/analysis-card.tsx:164` | AI analysis `<div className="select-text">` | new | O / T12 |
| O2 | `features/vocabulary/vocabulary-page.tsx:285` | list word `<p>` | new | O / T12 |
| O3 | `features/progress/progress-page.tsx:136` | poor word `<span>` | new | O / T12 |
| O4 | `plugins/mistakes/mistakes-page.tsx:136` | mistake word `<p>` | new | O / T12 |
| O5 | `plugins/pron-shadow/weak-words-page.tsx:91` | weak word `<b>` | new | O / T12 |

**Count:** 15 contexts are marked today, 45 marks are added here (W 15, C 7, S 18, O 5) plus 1 `ownLongPress`, for **60 marked elements**.

**Deliberately excluded** (recorded so nobody "fixes" them):
- **Quiz integrity (R-M3):**
  - `wordbook/recall-card.tsx:55` (front word before the reveal; the server uses `revealedBefore` / `elapsedMs`)
  - `wordbook/spell/cloze-board.tsx:95` (sentence while spelling)
  - the choice prompts before the answer
  - a covered card's headword
- **Whole text is a button, link or toggle:**
  - wordbook: options before the answer (`choice-question.tsx:167-176`), `ListenButton` phonetics (`word-card.tsx:126`, `recall-card.tsx:62`), phrases `<summary>` (`phrases-section.tsx:31-35`), `learned-page.tsx:68-71`
  - library: `item-card.tsx:189`
  - practice: `practice-list-page.tsx:136`, `history-page.tsx:71`
  - rank: `match-result.tsx:141` (failed drill)
  - rooms: `quote-block.tsx:18`
  - plugins and agents: `pron-shadow/today-words-sheet.tsx:22`, `agents/persona-picker.tsx:103`
  - chat: `conversations-page.tsx:103`
- **Not editable / not ours:** enjoy `PronunciationAssessmentFulltextResult` (`turn-detail-sheet.tsx:84`, `assessment-page.tsx:102`) and `letter-diff.tsx` (`role=img`).
- **Inputs:** `practice-page.tsx:125`, `typing-question.tsx:90`, `segment-editor.tsx:149`, `persona-editor-sheet.tsx:211`, `realtime/call-text-draft.tsx:50`.
- **Low value (titles, reasoning, memory):** `library/catalog-card.tsx:38`, `library/player-page.tsx:172`, `agents/process-card.tsx:91`, `agents/memory/*`, `practice/shadow/shadow-result.tsx:109`, `plugins/word-actions/word-actions-sheet.tsx:19`, `rooms/assist/assist-dock.tsx:197`, `spell/spell-results.tsx:29` (the user's struck typo), `wordbook/learned-page.tsx:53` (sheet title; the card under it is marked).
- **The lookup drawer itself:** the recogniser is off while the drawer is open.

---

## Rulings

> Each ruling ends with what it costs if it turns out wrong.

- **R-L1 Root cause and fix order.** (A) is mostly missing marks. The OS often does make a native selection on the learn page, and `readSelection` throws it away. Marking (T7–T12) fixes the native path on its own. The recogniser (T4–T6) makes it deterministic: the word under the finger is always selected at 450 ms, even where the browser selects nothing, picks an entity, or only shows its own menu. *Cost: if a browser's native selection still loses the bar after marking, only the recogniser can help. That is why both ship.*
- **R-L2 Eligibility = marked contexts only.** The recogniser acts only on a press inside a `[data-lookup-context]`. "Any English text node in the shell" was considered and **rejected** for three reasons:
  - it would make list rows, buttons, titles and nav labels lookup targets;
  - `readSelection` would still drop such selections (no context, so no `context` string for the LLM);
  - it could not express R-M3.

  Inside a context, a press on an interactive descendant (`a[href]`, `button`, `input`, `textarea`, `select`, `summary`, editable, `[role=button|textbox|link]`) is ignored, for example a link inside a chat reply. A context that sits *inside* a clickable row (library segment row, room bubble) stays eligible, and the trailing click is swallowed (R-L5). Contexts are never placed inside a `<button>`, `<Link>` or `<a>`; T13 guards this. *Cost: English text that nobody marked stays without long-press until it is added to the inventory.*
- **R-L3 Recogniser behaviour.**
  - **Gesture:** touch only (`pointerType === "touch"`). Mouse and pen are ignored, because desktop users drag or double-click.
  - **Firing:** primary pointer only. A second finger aborts the press. The press fires after `LONG_PRESS_MS = 450` with movement ≤ `LONG_PRESS_SLOP_PX = 8` (exactly 8 still fires).
  - **Cancelling:**
    - any document `scroll` (capture) aborts the press;
    - lifting before 450 ms aborts it;
    - a `pointercancel` **after** moving more than 8 px aborts it;
    - a `pointercancel` **without** movement keeps the timer, because Android sends it when it takes over a long-press (chat plan R-LP3).
  - **At fire time:**
    - if the document already has a non-collapsed selection, the browser's own selection wins: nothing is changed, and the layer just reads it;
    - otherwise `selectWordAt(x, y, doc, context)` selects the Latin word under the finger, clamped to the pressed context.
  - **Showing the bar:** the hook then calls `readNow()`, so the bar appears at once instead of after the 300 ms debounce.
  - **Drawer:** the recogniser is disabled while the drawer is open.

  *Cost: on iOS our selection may appear about 50 ms before iOS's own selection of the same word, which then replaces it (harmless). A double callout is on the device checklist.*
- **R-L4 No OS menu suppression by default (deviation from the brief).** The brief suggested blocking the OS context menu / callout on eligible text. On Android, preventing `contextmenu` on a long-press also removes the native selection handles, which kills long-press drag-select and Copy. The Global Constraints of the chat plan forbid that. So the global recogniser **never** calls `preventDefault` on `contextmenu` and never sets `-webkit-touch-callout`. The OS menu may show next to our bar, and our bar is always there. A "strict mode" that suppresses the OS menu on marked text is open question Q2. The wordbook option rows keep their own suppression: they are `select-none`, so there is nothing native to lose. *Cost: two menus on screen at once on some devices. This is a cosmetic risk, recorded in the device checklist.*
- **R-L5 Swallow the trailing click.**
  - After a fired press is released (`pointerup`), the **first** `click` within `CLICK_SWALLOW_MS = 400` whose target is inside the fired context gets `preventDefault()` + `stopPropagation()`. This happens in the document capture phase, so React handlers never see it.
  - A click elsewhere, for example on the bar, is never swallowed and does not use up the window.
  - Nothing is swallowed after a cancel or a short tap.
  - This protects the library segment row (tap = seek), the room bubbles (tap = toggle the action row) and the vocabulary cards.

  *Cost: a deliberate second tap inside the same text within 400 ms of release is lost (very unlikely).*
- **R-L6 The review option rows keep their own long-press.** `choice-question.tsx` answered rows select the **whole** option word or phrase (`selectWord(span)`), cover the whole row (≥ 52 px), and have keyboard and screen-reader paths (`detail === 0`, Enter / Space). The global recogniser would select only the single word under the finger. The rows therefore get `data-lookup-press="own"` (`ownLongPress`), and the recogniser skips anything under it. The tap-to-select spans in the library and shadow sheet are untouched: they are taps, not long-presses, and do not conflict. *Cost: two long-press code paths (one hook, one global). Both use the same `lib/long-press.ts` machine.*
- **R-L7 Things that are never targets.** Hold-to-talk buttons (`components/hold-to-talk-bar.tsx`, `select-none`), call-dock keys, inputs and textareas, the bar itself and the drawer are never targets. None of them is inside a context, or they are interactive (R-L2), or the drawer is open. *Cost: none.*
- **R-L8 The Android latch is untouched.** The recogniser only adds a selection, through `addRange`, and reads it. `press()` / `release()`, the 600 ms grace, the bar's `pointerdown` / `mousedown` `preventDefault` and "no `preventDefault` on `touchstart`" all stay as they are. `readNow()` respects the latch: it does nothing while the bar is held or within the grace. *Cost: none.*
- **R-L9 The state machine moves to `lib/`.** `features/wordbook/long-press.ts` (pure, with no feature identity) moves to `web/src/lib/long-press.ts` with `git mv`, and its test moves with it. `features/wordbook/long-press.ts` becomes a one-line re-export, so `use-long-press.ts` and its test stay unchanged. Lookup imports `~/lib/long-press`. This avoids a lookup→wordbook edge, which is forbidden. *Cost: one extra file.*
- **R-M1 Mark helper.** `web/src/lib/lookup-context.ts` exports:
  - `LOOKUP_CONTEXT_SELECTOR`, which becomes the single source; `use-text-selection.ts` re-exports it;
  - `lookupContext` (`{ "data-lookup-context": "" }`);
  - `lookupContextIf(on)`;
  - `ownLongPress` (`{ "data-lookup-press": "own" }`);
  - `lookupPressContext(target)`.

  New marks are written as a spread, `<p {...lookupContext} …>`. The 15 existing raw `data-lookup-context` attributes stay as they are, and both forms satisfy the selector. *Cost: none.*
- **R-M2 Mark the smallest English element.** Mark the `<p>` / `<span>` / `<li>` that holds the English text, never a container that mixes Chinese lines, buttons or icons. The context string sent to the LLM is the context's text: `boundContext` keeps ≤ 300 characters around the selection. Chinese meaning lines, translations and `ZhNoteFold` notes stay unmarked. *Cost: a native drag across two marked siblings (two contexts) is still rejected, as it is today.*
- **R-M3 Quiz integrity.** No lookup may reveal an answer before it is given:
  - choice prompts (`question-word`, `ClozeSentence`) are marked only when `result !== null`;
  - a covered learn card's headword is not marked (`lookupContextIf(!covered)`);
  - the recall-card front and the spelling cloze sentence are never marked.

  T13 guards all of these. *Cost: on the learn page you cannot look up the headword until you reveal the card. That is intended.*
- **R-M4 The golden snapshot stays byte-identical.** `word-card-legacy.test.tsx` compares `normalizeIds(container.innerHTML)`. T7 changes **that test line** to strip the new attribute first (`.replaceAll(' data-lookup-context=""', "")`). The snapshot file is not regenerated, so the golden still proves that nothing else changed. *Cost: the golden no longer sees the mark itself. The wordbook marks test covers it.*
- **R-M5 Guards.** Each marking lane writes its own permanent guard (`web/src/lookup-marks.<lane>.test.ts`, node, source scan, "at least n marks per file") before editing, so lanes touch disjoint files. T13 adds the central guard `web/src/lookup-marks.test.ts` after the lanes merge. It checks:
  - total marks in `features/**` + `plugins/**` ≥ 60;
  - no mark on a `<button`, `<Link` or `<a ` opening tag;
  - the R-M3 negatives;
  - every legacy marked file still marked.

  *Cost: line counts in the guards are "at least", so a deleted mark in a file that has several can slip through. The central total catches large losses.*
- **R-G1 Bar recipe.** New `.glass-pop` with the same shape as `.glass-float`: fallback `--glass-solid`, border `--glass-float-bd`, shadow `--glass-float-hi, --glass-float-sh`, and `blur(28px) saturate(1.8)` under `@supports`. It has its own tint token `--glass-pop` (variant B: light `rgba(255, 255, 255, 0.1)`, dark `rgba(23, 25, 30, 0.1)`). `html.lite` uses `--glass-float-lite` + `blur(12px)`. Reduced transparency gives solid `rgb(var(--surface))` with a `var(--hair)` border. The icon buttons other than the trigger get the tab-bar halo (`.pop-halo :not([data-testid="lookup-trigger"]) > svg`). *Cost: one more class to keep in sync with `.glass-float`.*
- **R-G2 Bar geometry.** `h-[54px] rounded-[27px] p-1` (1 px border + 4 px padding + 44 px buttons, concentric with the 22 px-radius buttons). Position, `z-40`, `max-w`, `select-none` and every handler are unchanged; the `--tab-bar-space` offset stays pinned by `lookup-bar-offset.test.ts`. The bar still covers a `DOCK` while a selection stands, as it does today (open question Q5). *Cost: none in logic.*
- **R-G3 Drawer = floating glass card.** `BottomSheetContent` gets an opt-in `glass` prop. Only the lookup drawer passes it.
  - **Content:** `glass-sheet fixed inset-x-2 bottom-[max(8px,calc(env(safe-area-inset-bottom)-8px))] z-50 mx-auto max-w-screen-sm rounded-dock px-gutter pb-4 pt-2`. That is 8 px from the sides, above the home indicator, radius 28 (`rounded-dock`, the tab bar's radius), with no extra safe-area padding because the card already floats above it.
  - **Overlay:** `bg-[color:var(--lookup-scrim)]` (light `.14`, dark `.34`), so the page shows through the glass.
  - **Glass:** `.glass-sheet` = `--glass-sheet` (B: `.55`) + `blur(36px) saturate(1.8)` + border `--glass-float-bd` + shadow `--glass-float-hi, --glass-sheet-sh`. `html.lite` uses `--glass-sheet-lite` (.86) + `blur(12px)`. Reduced transparency is solid.
  - **Default sheet:** the class string is unchanged: the same tokens in the same order, joined.

  *Cost: the drawer is narrower by 16 px and a little higher on iPhones.*
- **R-G4 One blur layer per lookup surface.** Nothing inside the bar or drawer blurs. Inner controls are translucent "wells" (`bg-[color:var(--glass-well)]` + `border-[color:var(--glass-well-bd)]`, `rounded-full`, `shadow-none`). These are the drawer's outline buttons, the source label (as a chip) and the unpressed `ZhToggle`. A pressed `ZhToggle` keeps `bg-blue-tint`. The bar and drawer are never visible together, because the bar is unmounted while `open`. *Cost: none.*
- **R-G5 Blur budget.**
  - The lookup surface is **transient**. It is counted as one temporary layer above the resident three, which design-notes allows only through the Addendum in T18.
  - **Library screens** keep their hard cap of 3 (`library-css.test.ts`). Inside `@supports selector(:has(*))`, `html:has(.library-root) .glass-pop / .glass-sheet` drops `backdrop-filter` and uses `--glass-solid`. Browsers without `:has` keep the blur.
  - Reduced transparency, `html.lite` and no-`backdrop-filter` keep their fallbacks.

  *Cost: on library screens the bar and drawer look solid, not glassy. Whether a temporary 4th layer is acceptable elsewhere is Q4.*
- **R-G6 z-index unchanged.** Bar `z-40` sits above the tab bar, composer and `DOCK` (`z-30`) and above the shadow sheet (`35` / `36`). The drawer overlay and content are `z-50`. *Cost: none.*
- **R-G7 Motion.** The bar is not animated (design-notes: never animate a blurred element). The drawer keeps the existing Radix slide-in / out on the blurred content. The precedent is `.library-root.lib-sheet` (`library/add-sheet.tsx:26`), which is also a blurred `BottomSheetContent` with the same animation. Device checklist G-E4 watches for flicker. *Cost: if it flickers on a device, the follow-up is to animate an inner wrapper instead.*
- **R-G8 Legibility rule.** Bar tint ≥ 0.06 and drawer tint ≥ 0.38 in every variant. T14's test enforces this. The drawer holds paragraph text, so its tint is higher than the bar's. Real contrast over posters is unverified (device checklist G-E1/G-E2). *Cost: if the owner wants the drawer as clear as the bar, paragraph legibility over bright posters is at risk.*

### Transparency table (the owner picks in the mockup; T14 is written for B)

| Variant | `--glass-pop` light / dark | `--glass-sheet` light / dark | Note |
|---|---|---|---|
| A | `rgba(255, 255, 255, 0.06)` / `rgba(23, 25, 30, 0.06)` | `rgba(255, 255, 255, 0.38)` / `rgba(23, 25, 30, 0.38)` | clearest; definitions start to strain on bright posters |
| **B (recommended)** | `rgba(255, 255, 255, 0.1)` / `rgba(23, 25, 30, 0.1)` | `rgba(255, 255, 255, 0.55)` / `rgba(23, 25, 30, 0.55)` | bar = tab bar tint; drawer readable over posters in the mockup |
| C | `rgba(255, 255, 255, 0.16)` / `rgba(23, 25, 30, 0.16)` | `rgba(255, 255, 255, 0.7)` / `rgba(23, 25, 30, 0.7)` | closer to frosted / solid |

## Deviations from the brief (planner's discretion, all reversible)

1. **No OS-menu suppression** on marked text (R-L4); "strict mode" is Q2.
2. **Eligibility is mark-based**, not "any English text node" (R-L2).
3. **The review option rows keep their own long-press** instead of being folded into the global one (R-L6).
4. **A quiz-integrity rule** was added (R-M3), which the brief did not mention.
5. **The drawer is a floating card** (inset 8 px, all corners 28) rather than a full-width sheet with rounded top corners. The mockup lists the alternative (D5).

## Open decisions for the owner (mockup table D1–D9)

- **Q1 (D6)** Transparency A / B / C (B recommended).
- **Q2 (D3)** Keep the OS long-press menu (recommended), or "strict mode" that suppresses it on marked text, which costs long-press drag-select on Android.
- **Q3 (D5)** Floating glass card drawer (recommended), or full-width with rounded top corners.
- **Q4 (D7)** Accept a temporary 4th blur layer while the bar or drawer is visible on non-library screens. The alternative is a solid-tint bar and drawer everywhere.
- **Q5 (D9)** The bar still covers the wordbook `DOCK` while a selection exists, as today. The alternative is to lift the bar above `DOCK` pages (needs a per-page height variable; not in this round).
- **Q6** Should realtime call captions be excluded from long-press? Today they are marked but sit under the full-screen call (z-50). This plan does not change them.

## File structure, lanes and shared files

```
web/src/lib/lookup-context.ts (+ lookup-context.test.ts)           new (T1)
web/src/test/lookup-marks.ts                                        new (T1, test helper)
web/src/lib/select-word.ts, select-word.test.ts                     [edit] + selectWordAt (T2)
web/src/lib/long-press.ts, long-press.test.ts                       git mv from features/wordbook (T3)
web/src/features/wordbook/long-press.ts                             [whole file] re-export (T3)
web/src/features/lookup/use-text-selection.ts                       [edit] selector from lib, + readNow (T4)
web/src/features/lookup/use-text-selection-readnow.test.ts          new (T4)
web/src/features/lookup/use-long-press-lookup.ts (+ .test.ts)       new (T5)
web/src/features/lookup/lookup-layer.tsx                            [edit] wire recogniser (T6); drawer classes (T17)
web/src/features/lookup/lookup-longpress.test.tsx                   new (T6)
web/src/features/wordbook/{word-card,defs-en,phrases-section}.tsx   [edit] (T7)
web/src/features/wordbook/word-card-legacy.test.tsx                 [edit] 1 line (T7)
web/src/features/wordbook/lookup-marks.test.tsx                     new (T7, extended in T8)
web/src/features/wordbook/{after-answer-panel,choice-question,typing-question}.tsx   [edit] (T8)
web/src/features/wordbook/{session-summary,spell/spell-results,spell/explain-sheet}.tsx   [edit] (T9)
web/src/lookup-marks.wordbook.test.ts                               new (T9)
web/src/features/chat/{grammar-details,recap-sheet,turn-detail-sheet}.tsx, agents/{tutor/tutor-bar,tutor/tutor-recap-card,persona-editor-sheet}.tsx   [edit] (T10)
web/src/lookup-marks.chat.test.ts                                   new (T10)
web/src/features/rooms/{room-message-list,voice/voice-bubble,assist/assist-dock,assist/suggestion-card,extras/summary-page}.tsx, rank/{match-page,match-result}.tsx   [edit] (T11)
web/src/lookup-marks.social.test.ts                                 new (T11)
web/src/features/{library/analysis-card,vocabulary/vocabulary-page,progress/progress-page}.tsx, plugins/{mistakes/mistakes-page,pron-shadow/weak-words-page}.tsx   [edit] (T12)
web/src/lookup-marks.other.test.ts                                  new (T12)
web/src/lookup-marks.test.ts                                        new (T13, central guard)
web/src/styles/theme.css, styles/theme.test.ts, index.css           [edit] (T14)
web/src/styles/glass-lookup.test.ts                                 new (T14)
web/src/features/lookup/lookup-bar.tsx, lookup-bar-offset.test.ts   [edit] (T15)
web/src/components/bottom-sheet.tsx (+ bottom-sheet.test.tsx new)   [edit] (T16)
web/src/features/lookup/glass.ts                                    new (T17)
web/src/features/lookup/dictionary-result.tsx, lookup-glass.test.tsx   [edit] / new (T17)
web/src/features/lookup/CLAUDE.md, wordbook/CLAUDE.md, lib/CLAUDE.md, components/CLAUDE.md, web/README.md,
  docs/superpowers/design/redesign-v3/design-notes.md (Addendum only)   [edit] (T18)
docs/changelog/2026-10.json                                         [edit] (T19, controller only)
```

**Lanes (git worktrees; each lane touches only its own files):**

| Lane | Tasks | Blocked on mockup? | Notes |
|---|---|---|---|
| F foundation | **T1 → T2 → T3** | no | `lib/` + `test/` only. Merge first; every other lane needs T1. |
| R recogniser | **T4 → T5 → T6** | no | `features/lookup` (selection hook, new hook, layer wiring). Needs T1–T3. |
| W wordbook marks | **T7 → T8 → T9** | no | `features/wordbook/**` only. Needs T1. |
| C chat + agents marks | **T10** | no | Needs T1. |
| S rooms + rank marks | **T11** | no | Needs T1. |
| O other marks | **T12** | no | library / vocabulary / progress / plugins. Needs T1. |
| — | **T13** central guard | no | After W, C, S and O merge. |
| G glass | **T14 → (T15 ∥ T16) → T17** | **YES** | T17 edits `lookup-layer.tsx`, so it starts only after lane R is merged. |
| — | **T18** docs | no (but after all) | After everything merges. |
| controller | **T19** changelog | — | After merge, deploy and the owner's device check. |

**Merge order:** F → (R ∥ W ∥ C ∥ S ∥ O) → T13 → *(mockup approved)* T14 → T15 ∥ T16 → T17 → T18 → T19.
**Parallelism:** after F, five lanes can run at once (R, W, C, S, O). G can run as soon as the owner approves and R has merged.

---

## Task T1: mark helper + guard helper (lane F)

**Files:** create `web/src/lib/lookup-context.ts`, `web/src/lib/lookup-context.test.ts`, `web/src/test/lookup-marks.ts`.

**Interfaces:**
```ts
export const LOOKUP_CONTEXT_SELECTOR: "[data-lookup-context]";
export const OWN_LONG_PRESS_SELECTOR: '[data-lookup-press="own"]';
export const lookupContext: { readonly "data-lookup-context": "" };
export function lookupContextIf(on: boolean): { "data-lookup-context"?: "" };
export const ownLongPress: { readonly "data-lookup-press": "own" };
export function lookupPressContext(target: EventTarget | null): Element | null;
// test helper
export function srcOf(rel: string): string;          // source of web/src/<rel>
export function lookupMarks(source: string): number; // count of marked elements in a source
```

- [ ] **Step 1: write the failing test** `web/src/lib/lookup-context.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { lookupContext, lookupContextIf, lookupPressContext, ownLongPress } from "./lookup-context";

const $ = (sel: string) => document.querySelector(sel)!;
afterEach(() => { document.body.innerHTML = ""; });

describe("lookup marks (plan 2026-10-15 R-M1)", () => {
  it("spreads the attributes the selection reader and the recogniser look for", () => {
    expect(lookupContext).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(true)).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(false)).toEqual({});
    expect(ownLongPress).toEqual({ "data-lookup-press": "own" });
  });
});

describe("lookupPressContext (R-L2, R-L6)", () => {
  it("returns the nearest context for an element or a text node inside it", () => {
    document.body.innerHTML = `<div><p data-lookup-context id="c">say <b id="w">hello</b></p></div>`;
    expect(lookupPressContext($("#w"))).toBe($("#c"));
    expect(lookupPressContext($("#w").firstChild)).toBe($("#c"));
  });
  it("ignores text outside any context and a null target", () => {
    document.body.innerHTML = `<p id="p">plain</p>`;
    expect(lookupPressContext($("#p"))).toBeNull();
    expect(lookupPressContext(null)).toBeNull();
  });
  it("ignores links, buttons, inputs and role=button inside a context", () => {
    document.body.innerHTML = `<div data-lookup-context><a id="a" href="#">link</a><button id="b">go</button><span role="button" id="r">x</span><input id="i"></div>`;
    for (const id of ["#a", "#b", "#r", "#i"]) expect(lookupPressContext($(id))).toBeNull();
  });
  it("accepts a context inside a clickable row (its click is swallowed later, R-L5)", () => {
    document.body.innerHTML = `<div role="button" id="row"><p data-lookup-context id="c">word</p></div>`;
    expect(lookupPressContext($("#c"))).toBe($("#c"));
  });
  it("leaves an element that owns its long-press alone", () => {
    document.body.innerHTML = `<div data-lookup-press="own"><span data-lookup-context id="w">talk</span></div>`;
    expect(lookupPressContext($("#w"))).toBeNull();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lib/lookup-context.test.ts`. Expected: it FAILS (module missing).
- [ ] **Step 3: implement** `web/src/lib/lookup-context.ts`:
```ts
/**
 * Marks for select-to-lookup (plan 2026-10-15-global-longpress-glass-lookup R-M1, R-L2, R-L6).
 * A `[data-lookup-context]` element holds English learning text: the global LookupLayer reads selections inside it, and its
 * long-press recogniser selects the pressed word there. `data-lookup-press="own"` marks an element that handles its own
 * long-press (the wordbook review option rows); the global recogniser leaves it alone. Pure DOM helpers, no React.
 */
export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";
export const OWN_LONG_PRESS_SELECTOR = '[data-lookup-press="own"]';
/** Interactive elements inside a context are never long-press targets (a link in a chat reply, a button). */
const INTERACTIVE_SELECTOR =
  "a[href], button, input, textarea, select, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='textbox'], [role='link']";

/** Spread on the smallest element that holds English learning text: `<p {...lookupContext}>` (R-M2). */
export const lookupContext = { "data-lookup-context": "" } as const;

/** `lookupContext` only when `on` (quiz prompts become lookup-able only after the answer, R-M3). */
export const lookupContextIf = (on: boolean): { "data-lookup-context"?: "" } => (on ? lookupContext : {});

/** Spread on an element that owns its long-press, so the global recogniser skips it (R-L6). */
export const ownLongPress = { "data-lookup-press": "own" } as const;

/** The lookup context a press on `target` belongs to, or null when the global long-press must ignore it. */
export function lookupPressContext(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el || el.closest(OWN_LONG_PRESS_SELECTOR)) return null;
  const ctx = el.closest(LOOKUP_CONTEXT_SELECTOR);
  if (!ctx) return null;
  const interactive = el.closest(INTERACTIVE_SELECTOR);
  return interactive && ctx.contains(interactive) ? null : ctx;
}
```
- [ ] **Step 4: test helper** `web/src/test/lookup-marks.ts` (used only by `*.test.ts`):
```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** web/src */
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Source text of a file under web/src (posix path relative to src, e.g. "features/chat/recap-sheet.tsx"). */
export const srcOf = (rel: string): string => readFileSync(path.join(srcRoot, ...rel.split("/")), "utf8");

/** Marked elements in a source: `{...lookupContext}`, `lookupContextIf(` calls and raw `data-lookup-context` attributes. */
export const lookupMarks = (source: string): number =>
  (source.match(/\{\.\.\.lookupContext\}|lookupContextIf\(|data-lookup-context/g) ?? []).length;
```
- [ ] **Step 5:** Run `cd web && yarn vitest run src/lib/lookup-context.test.ts src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 6: commit** `feat(web): add lookup mark helpers for the global long-press`.

## Task T2: `selectWordAt` (lane F)

**Files:** modify `web/src/lib/select-word.ts` and `web/src/lib/select-word.test.ts`.

**Interface:** `export function selectWordAt(x: number, y: number, doc?: Document, within?: Element): boolean`. It selects the Latin word under the point unless a selection already exists, refuses a caret outside `within`, and returns whether it changed the selection.

- [ ] **Step 1: test.** In `select-word.test.ts` change the import line `import { selectWord } from "./select-word";` to `import { selectWord, selectWordAt } from "./select-word";`. If `afterEach` is not imported from `vitest` yet, add it to that import line. Then append:
```ts
type CaretDoc = Document & { caretRangeFromPoint?: unknown; caretPositionFromPoint?: unknown };
const caretAt = (node: Node, offset: number) => {
  (document as CaretDoc).caretRangeFromPoint = () => {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    return r;
  };
};

describe("selectWordAt (plan 2026-10-15 R-L3)", () => {
  afterEach(() => {
    delete (document as CaretDoc).caretRangeFromPoint;
    delete (document as CaretDoc).caretPositionFromPoint;
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("selects the English word under the point", () => {
    document.body.innerHTML = `<p id="p">say hello there</p>`;
    caretAt(document.getElementById("p")!.firstChild!, 6);
    expect(selectWordAt(1, 1)).toBe(true);
    expect(String(document.getSelection())).toBe("hello");
  });

  it("prefers caretPositionFromPoint and trims a trailing apostrophe", () => {
    document.body.innerHTML = `<p id="p">the dogs' bowl</p>`;
    const text = document.getElementById("p")!.firstChild!;
    (document as CaretDoc).caretPositionFromPoint = () => ({ offsetNode: text, offset: 5 });
    (document as CaretDoc).caretRangeFromPoint = () => { throw new Error("must not be used"); };
    expect(selectWordAt(1, 1)).toBe(true);
    expect(String(document.getSelection())).toBe("dogs");
  });

  it("keeps a selection that already exists (the browser's own long-press wins)", () => {
    document.body.innerHTML = `<p id="p">say hello there</p>`;
    const text = document.getElementById("p")!.firstChild!;
    const r = document.createRange();
    r.setStart(text, 10);
    r.setEnd(text, 15);
    document.getSelection()!.addRange(r);
    caretAt(text, 6);
    expect(selectWordAt(1, 1)).toBe(false);
    expect(String(document.getSelection())).toBe("there");
  });

  it("does nothing on Chinese text, outside `within`, or without a caret API", () => {
    document.body.innerHTML = `<p id="zh">你好世界</p><p id="en">hello</p><div id="other"></div>`;
    caretAt(document.getElementById("zh")!.firstChild!, 1);
    expect(selectWordAt(1, 1)).toBe(false);
    caretAt(document.getElementById("en")!.firstChild!, 2);
    expect(selectWordAt(1, 1, document, document.getElementById("other")!)).toBe(false);
    delete (document as CaretDoc).caretRangeFromPoint;
    expect(selectWordAt(1, 1)).toBe(false);
    expect(String(document.getSelection())).toBe("");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lib/select-word.test.ts`. Expected: FAIL (`selectWordAt` is not exported).
- [ ] **Step 3: implement.** Append to `web/src/lib/select-word.ts` and keep `selectWord` unchanged:
```ts
/** Letters (Latin incl. accents), digits, apostrophes and hyphens make up an English word; CJK never does. */
const WORD_CHAR = /[A-Za-zÀ-ɏ0-9'’-]/;
const EDGE_PUNCT = /['’-]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as CaretDoc;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/**
 * Select the English word under (x, y) (global long-press, plan 2026-10-15-global-longpress-glass-lookup R-L3).
 * Does nothing when a selection already exists (the browser's own long-press wins), when the point is not on a Latin word,
 * when the caret lies outside `within`, or when the browser has no caret-from-point API. Returns whether the selection changed.
 */
export function selectWordAt(x: number, y: number, doc: Document = document, within?: Element): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  if (!sel.isCollapsed && sel.toString().trim()) return false;
  const caret = caretAt(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return false;
  if (within && !within.contains(caret.node)) return false;
  const text = caret.node.textContent ?? "";
  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  while (start < end && EDGE_PUNCT.test(text[start])) start += 1;
  while (end > start && EDGE_PUNCT.test(text[end - 1])) end -= 1;
  if (!LATIN.test(text.slice(start, end))) return false;
  const range = doc.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lib/select-word.test.ts src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 5: commit** `feat(web): select the English word at a point`.

## Task T3: move the long-press machine to `lib/` (lane F)

**Files:** `git mv web/src/features/wordbook/long-press.ts web/src/lib/long-press.ts`; `git mv web/src/features/wordbook/long-press.test.ts web/src/lib/long-press.test.ts`; create a new `web/src/features/wordbook/long-press.ts`.

- [ ] **Step 1:** Run the two `git mv` commands. The test's import `from "./long-press"` stays valid.
- [ ] **Step 2:** In `web/src/lib/long-press.ts`, change the first comment line (`* 长按判定(计划 2026-10-14-review-bilingual-longpress R-L2 / R-L3):纯状态机,不碰计时器与 DOM。`) to `* 长按判定(计划 2026-10-14-review-bilingual-longpress R-L2 / R-L3;2026-10-15 移到 lib/,全站长按查词也用它):纯状态机,不碰计时器与 DOM。`. Change nothing else.
- [ ] **Step 3:** Write the new `web/src/features/wordbook/long-press.ts`:
```ts
// 长按状态机已移到 ~/lib/long-press(计划 2026-10-15-global-longpress-glass-lookup R-L9);这里保留原路径给 use-long-press.ts。
export { CLICK_SWALLOW_MS, LONG_PRESS_MS, LONG_PRESS_SLOP_PX, createLongPress, movedTooFar, type Point } from "~/lib/long-press";
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lib/long-press.test.ts src/features/wordbook/use-long-press.test.tsx src/features/wordbook/choice-question-after.test.tsx src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 5: commit** `refactor(web): move the long-press state machine to lib`.

---

## Task T4: `readNow` in `useTextSelection` (lane R; needs T1)

**Files:** modify `web/src/features/lookup/use-text-selection.ts`; create `web/src/features/lookup/use-text-selection-readnow.test.ts`.

**Interface:** `useTextSelection()` additionally returns `readNow: () => void`. It reads the current selection at once (no debounce), and does nothing while the bar is pressed or within the 600 ms grace (R-L8).

- [ ] **Step 1: test** `use-text-selection-readnow.test.ts`:
```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTextSelection } from "./use-text-selection";

function selectWord(word: string) {
  const text = document.getElementById("c")!.firstChild!;
  const start = text.textContent!.indexOf(word);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + word.length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

describe("useTextSelection.readNow (plan 2026-10-15 R-L3, R-L8)", () => {
  it("reads the selection at once, without waiting for the debounce", () => {
    document.body.innerHTML = `<p data-lookup-context id="c">ask not what your country can do</p>`;
    const { result } = renderHook(() => useTextSelection(10_000));
    selectWord("country");
    act(() => result.current.readNow());
    expect(result.current.selection?.text).toBe("country");
  });

  it("does nothing while the bar is pressed (the Android latch wins)", () => {
    document.body.innerHTML = `<p data-lookup-context id="c">ask not what your country can do</p>`;
    const { result } = renderHook(() => useTextSelection(10_000));
    act(() => result.current.press());
    selectWord("country");
    act(() => result.current.readNow());
    expect(result.current.selection).toBeNull();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/use-text-selection-readnow.test.ts`. Expected: FAIL (`readNow` is not a function).
- [ ] **Step 3: implement** (Edit, one-line anchors):
  - Replace `import { normalizeSelection } from "./lookup";` with:
    ```ts
    import { LOOKUP_CONTEXT_SELECTOR } from "~/lib/lookup-context";
    import { normalizeSelection } from "./lookup";
    ```
  - Replace `export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";` with `export { LOOKUP_CONTEXT_SELECTOR }; // 唯一来源在 ~/lib/lookup-context(计划 2026-10-15 R-M1)`
  - Replace `  const clear = useCallback(() => {` with:
    ```ts
      /** 立刻读一次选区(全站长按选中词之后用,不等 300 ms 防抖);按住操作条期间与其后的宽限期内不读(R-L8)。 */
      const readNow = useCallback(() => {
        if (held()) return;
        setSelection(readSelection(doc.getSelection()));
      }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
      const clear = useCallback(() => {
    ```
  - Replace `  return { selection, clear, press, release };` with `  return { selection, clear, press, release, readNow };`
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/lookup/use-text-selection-readnow.test.ts src/features/lookup/use-text-selection.test.ts src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 5: commit** `feat(web): let the lookup layer read a selection at once`.

## Task T5: global long-press recogniser hook (lane R; needs T1–T3)

**Files:** create `web/src/features/lookup/use-long-press-lookup.ts` and `web/src/features/lookup/use-long-press-lookup.test.ts`.

**Interface:**
```ts
export interface LongPressLookupOptions { enabled: boolean; onSelect: () => void; doc?: Document; ms?: number; now?: () => number }
export function useLongPressLookup(options: LongPressLookupOptions): void;
```

- [ ] **Step 1: test** `use-long-press-lookup.test.ts`:
```ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectWordAt } from "~/lib/select-word";
import { useLongPressLookup } from "./use-long-press-lookup";

vi.mock("~/lib/select-word", () => ({ selectWordAt: vi.fn(() => true) }));

// jsdom has no PointerEvent: build a MouseEvent and define the pointer fields (same reason as choice-question-after.test.tsx).
type Init = { x?: number; y?: number; id?: number; kind?: string; primary?: boolean };
function pointer(el: Element, type: string, { x = 20, y = 20, id = 1, kind = "touch", primary = true }: Init = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: kind }, isPrimary: { value: primary } });
  el.dispatchEvent(e);
  return e;
}

let clock = 0;
const now = () => clock;
const onSelect = vi.fn();
const mount = (on = true) =>
  renderHook(({ enabled }) => useLongPressLookup({ enabled, onSelect, now }), { initialProps: { enabled: on } });
const el = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  onSelect.mockClear();
  vi.mocked(selectWordAt).mockClear();
  vi.mocked(selectWordAt).mockReturnValue(true);
  document.body.innerHTML = `
    <p data-lookup-context id="ctx">say <b id="w">hello</b> there <a id="link" href="#">link</a></p>
    <p id="plain">plain text</p>
    <div data-lookup-press="own"><span data-lookup-context id="own">talk</span></div>
    <button id="bar">look up</button>`;
});
afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("useLongPressLookup (plan 2026-10-15 R-L3)", () => {
  it("selects the pressed word after 450 ms without moving and reports it", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 30, y: 40 });
    vi.advanceTimersByTime(449);
    expect(selectWordAt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(selectWordAt).toHaveBeenCalledWith(30, 40, document, el("ctx"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse and pen", () => {
    mount();
    pointer(el("w"), "pointerdown", { kind: "mouse" });
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown", { kind: "pen" });
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("ignores text outside a context, a link inside one and rows that own their long-press (R-L2, R-L6)", () => {
    mount();
    for (const id of ["plain", "link", "own", "bar"]) {
      pointer(el(id), "pointerdown");
      vi.advanceTimersByTime(500);
    }
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("cancels on a move over 8 px, an early lift, a scroll or a second finger", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 20, y: 20 });
    pointer(el("w"), "pointermove", { x: 29, y: 20 });
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(200);
    pointer(el("w"), "pointerup");
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    pointer(el("w"), "pointerdown", { id: 2, primary: false });
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("still fires after a move of exactly 8 px", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 20, y: 20 });
    pointer(el("w"), "pointermove", { x: 28, y: 20 });
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
  });

  it("keeps the timer through an unmoved pointercancel (the browser took over), not a moved one", () => {
    mount();
    pointer(el("w"), "pointerdown");
    pointer(el("w"), "pointercancel");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
    pointer(el("w"), "pointerdown", { x: 20 });
    pointer(el("w"), "pointermove", { x: 40 });
    pointer(el("w"), "pointercancel");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
  });

  it("keeps a selection the browser already made and only reports it", () => {
    mount();
    const range = document.createRange();
    range.selectNodeContents(el("w"));
    window.getSelection()!.addRange(range);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when no word was under the finger", () => {
    vi.mocked(selectWordAt).mockReturnValue(false);
    mount();
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("swallows only the first click inside the pressed text within 400 ms of release (R-L5)", () => {
    mount();
    const clicked = vi.fn();
    el("w").addEventListener("click", clicked);
    const barClicked = vi.fn();
    el("bar").addEventListener("click", barClicked);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    clock += 600;
    pointer(el("w"), "pointerup");
    clock += 100;
    el("bar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(barClicked).toHaveBeenCalledTimes(1); // outside the pressed text: never swallowed
    const first = new MouseEvent("click", { bubbles: true, cancelable: true });
    el("w").dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    el("w").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("lets the click of a short tap through", () => {
    mount();
    const clicked = vi.fn();
    el("w").addEventListener("click", clicked);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(100);
    pointer(el("w"), "pointerup");
    el("w").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled and stops on unmount", () => {
    const { rerender, unmount } = mount(false);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
    rerender({ enabled: true });
    pointer(el("w"), "pointerdown");
    unmount();
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/use-long-press-lookup.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: implement** `web/src/features/lookup/use-long-press-lookup.ts`:
```ts
import { useEffect, useRef } from "react";
import { lookupPressContext } from "~/lib/lookup-context";
import { LONG_PRESS_MS, createLongPress } from "~/lib/long-press";
import { selectWordAt } from "~/lib/select-word";

const perfNow = () => performance.now();

export interface LongPressLookupOptions {
  /** false while the lookup drawer is open */
  enabled: boolean;
  /** called once the pressed word is selected (or the browser's own selection is kept): read the selection now */
  onSelect: () => void;
  doc?: Document;
  ms?: number;
  /** clock for the click-swallow window (tests inject one) */
  now?: () => number;
}

/**
 * 全站长按查词(计划 2026-10-15-global-longpress-glass-lookup R-L2–R-L8):文档级捕获监听,只认触摸主指针。
 * 按在 [data-lookup-context] 里(不在其中的链接 / 按钮上,不在 data-lookup-press="own" 里)450 ms 且移动 ≤ 8 px →
 * 已有原生选区就保留它,否则选中手指下的英文单词(selectWordAt,限定在这个上下文里)→ onSelect()(LookupLayer 立刻读选区)。
 * 滚动、移动 > 8 px、提前松手、第二根手指 → 取消;没移动的 pointercancel 不取消(安卓接管长按时会发)。
 * 触发后松手 400 ms 内、落在被按文字里的第一个 click 在捕获阶段吞掉。从不 preventDefault pointerdown / touchstart / contextmenu,
 * 不改 user-select / touch-action,不清选区(R-L4、R-L8)。不记日志。
 */
export function useLongPressLookup({ enabled, onSelect, doc = document, ms = LONG_PRESS_MS, now = perfNow }: LongPressLookupOptions): void {
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  });
  useEffect(() => {
    if (!enabled) return;
    const lp = createLongPress();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pointerId: number | null = null;
    let at = { x: 0, y: 0 };
    let ctx: Element | null = null;
    let firedCtx: Element | null = null;
    let moved = false;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const abort = () => {
      lp.cancel();
      clear();
      pointerId = null;
      ctx = null;
    };
    const fire = () => {
      timer = null;
      if (lp.fire() === null || !ctx) return;
      firedCtx = ctx;
      const sel = doc.getSelection();
      const native = !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
      if (native || selectWordAt(at.x, at.y, doc, ctx)) latest.current();
    };
    const mine = (e: PointerEvent) => pointerId !== null && e.pointerId === pointerId;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      abort();
      if (!e.isPrimary) return; // 第二根手指:是捏合,不是长按
      const found = lookupPressContext(e.target);
      if (!found) return;
      ctx = found;
      firedCtx = null;
      pointerId = e.pointerId;
      at = { x: e.clientX, y: e.clientY };
      moved = false;
      lp.down(String(e.pointerId), e.clientX, e.clientY);
      timer = setTimeout(fire, ms);
    };
    const onMove = (e: PointerEvent) => {
      if (mine(e) && lp.move(e.clientX, e.clientY)) {
        moved = true;
        clear();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!mine(e)) return;
      lp.up(now());
      clear();
      pointerId = null;
    };
    const onCancel = (e: PointerEvent) => {
      if (!mine(e)) return;
      if (moved || !lp.pressing()) abort(); // 没移动:浏览器接管了长按,计时器照走(R-L3)
    };
    const onScroll = () => {
      if (lp.pressing()) abort();
    };
    const onClick = (e: MouseEvent) => {
      const inside = firedCtx !== null && e.target instanceof Node && firedCtx.contains(e.target);
      if (!inside || !lp.swallowClick(now())) return;
      e.preventDefault();
      e.stopPropagation();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerup", onUp, true);
    doc.addEventListener("pointercancel", onCancel, true);
    doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
    doc.addEventListener("click", onClick, true);
    return () => {
      doc.removeEventListener("pointerdown", onDown, true);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerup", onUp, true);
      doc.removeEventListener("pointercancel", onCancel, true);
      doc.removeEventListener("scroll", onScroll, { capture: true });
      doc.removeEventListener("click", onClick, true);
      abort();
    };
  }, [enabled, doc, ms, now]);
}
```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/lookup/use-long-press-lookup.test.ts src/architecture.test.ts`. Expected: PASS. If the "exactly 8 px" case fails, check `movedTooFar` (`>` slop, not `>=`). Do not change the machine.
- [ ] **Step 5: commit** `feat(web): add a global long-press recogniser for lookup`.

## Task T6: wire the recogniser into `LookupLayer` (lane R; needs T4, T5)

**Files:** modify `web/src/features/lookup/lookup-layer.tsx`; create `web/src/features/lookup/lookup-longpress.test.tsx`.

- [ ] **Step 1: integration test** `lookup-longpress.test.tsx`:
```tsx
import "fake-indexeddb/auto";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

type CaretDoc = Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
function touch(el: Element, type: string, kind = "touch") {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 12 });
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: kind }, isPrimary: { value: true } });
  el.dispatchEvent(e);
}
function Page() {
  return (
    <WithShadowSheet>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <LookupLayer />
    </WithShadowSheet>
  );
}
const mount = () => {
  const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) });
  renderWithProviders(<Page />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const text = screen.getByTestId("ctx").firstChild!;
  (document as CaretDoc).caretRangeFromPoint = () => {
    const r = document.createRange();
    r.setStart(text, text.textContent!.indexOf("country") + 2);
    r.collapse(true);
    return r;
  };
};

describe("global long-press lookup (plan 2026-10-15 R-L1–R-L3)", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });
  afterEach(() => { delete (document as CaretDoc).caretRangeFromPoint; window.getSelection()?.removeAllRanges(); });

  it("long-pressing a word in a lookup context selects it and shows the bar for a word", async () => {
    mount();
    touch(screen.getByTestId("ctx"), "pointerdown");
    expect(await screen.findByTestId("lookup-bar", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(window.getSelection()!.toString()).toBe("country");
    expect(screen.getByTestId("lookup-bar-vocab")).toBeInTheDocument(); // word, not sentence
    touch(screen.getByTestId("ctx"), "pointerup");
  });

  it("a mouse press selects nothing", async () => {
    mount();
    touch(screen.getByTestId("ctx"), "pointerdown", "mouse");
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByTestId("lookup-bar")).toBeNull();
    expect(window.getSelection()!.toString()).toBe("");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/lookup-longpress.test.tsx`. Expected: the first case FAILS (no bar).
- [ ] **Step 3: wire it up** (Edit, one-line anchors in `lookup-layer.tsx`):
  - Replace `import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";` with:
    ```ts
    import { useLongPressLookup } from "./use-long-press-lookup";
    import { useTextSelection, type TextSelectionInfo } from "./use-text-selection";
    ```
  - Replace `  const { selection, clear, press, release } = useTextSelection();` with `  const { selection, clear, press, release, readNow } = useTextSelection();`
  - Replace `  const [ai, setAi] = useState<AiState>({ status: "idle" });` with:
    ```ts
      const [ai, setAi] = useState<AiState>({ status: "idle" });
      // 全站长按查词(计划 2026-10-15 R-L3):抽屉打开时停用;选中后立刻读选区,操作条马上出现
      useLongPressLookup({ enabled: !open, onSelect: readNow });
    ```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/lookup src/architecture.test.ts`. Expected: PASS, including every existing `lookup-layer.test.tsx` / `lookup-bar.test.tsx` case (R-L8: latch, dictionary-first, 中文 chip, slots, practice).
- [ ] **Step 5: commit** `feat(web): long-press any marked English word to look it up`.

---

## Task T7: wordbook card marks (lane W; needs T1)

**Files:** modify `features/wordbook/word-card.tsx`, `defs-en.tsx`, `phrases-section.tsx` and `word-card-legacy.test.tsx` (one line); create `features/wordbook/lookup-marks.test.tsx`.

- [ ] **Step 1: test** `web/src/features/wordbook/lookup-marks.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView, WordRecap } from "./word-card";
import type { Card } from "./wordbook-api";

const TALK = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }], phrases: [{ en: "talk about", zh: "谈论" }] }), defsEn: DEFS_EN } as unknown as Card;
const marked = (el: Element | null) => el !== null && el.closest("[data-lookup-context]") !== null;
const exampleP = () => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "They talk a lot.");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("wordbook card English text is lookup-able (plan 2026-10-15 R-M2)", () => {
  it("marks the headword, each English definition, the example and the phrases on an open card", () => {
    renderWithProviders(<WordCardView card={TALK} defLang="both" phrasesOpen />);
    expect(marked(screen.getByRole("heading", { level: 2 }))).toBe(true);
    for (const li of within(screen.getByTestId("word-defs-en")).getAllByRole("listitem")) expect(li).toHaveAttribute("data-lookup-context");
    expect(marked(exampleP())).toBe(true);
    expect(marked(screen.getByText("talk about"))).toBe(true);
  });

  it("leaves the Chinese lines unmarked", () => {
    renderWithProviders(<WordCardView card={TALK} defLang="both" phrasesOpen />);
    expect(marked(screen.getByText("说话；谈话"))).toBe(false);
    expect(marked(screen.getByText("谈论"))).toBe(false);
    expect(marked(screen.getByText("他们常常talk。"))).toBe(false);
  });

  it("does not mark a covered card's headword (no peeking past the cover, R-M3)", () => {
    renderWithProviders(<WordCardView card={TALK} covered />);
    expect(marked(screen.getByRole("heading", { level: 2 }))).toBe(false);
  });

  it("marks the recap word and example", () => {
    renderWithProviders(<WordRecap card={TALK} />);
    const recap = screen.getByTestId("word-recap");
    expect(marked(within(recap).getByText((_, el) => el?.tagName === "B" && el.textContent === "talk"))).toBe(true);
    expect(marked(within(recap).getByText((_, el) => el?.tagName === "P" && el.textContent === "They talk a lot."))).toBe(true);
  });
});
```
  `render` and `vi` are imported for T8, which extends this file. If lint complains about unused imports in T7, leave them out and add them in T8.
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/lookup-marks.test.tsx`. Expected: FAIL.
- [ ] **Step 3: edits** (one-line anchors):
  - `word-card.tsx`:
    - Replace `import { Slot } from "~/lib/extension-points-react";` with:
      ```ts
      import { Slot } from "~/lib/extension-points-react";
      import { lookupContext, lookupContextIf } from "~/lib/lookup-context";
      ```
    - In the line `      <h2 lang="en" className="mt-1.5 break-words text-hero font-semibold tracking-[-0.02em]" style={{ lineHeight: 1.1 }}>{card.word}</h2>`, replace `<h2 lang="en" className="mt-1.5 break-words text-hero` with `<h2 lang="en" {...lookupContextIf(!covered)} className="mt-1.5 break-words text-hero`.
    - Replace `              <p lang="en" className="text-body leading-dialogue"><HighlightedSentence text={example.en} word={card.key} /></p>` with `              <p lang="en" {...lookupContext} className="text-body leading-dialogue"><HighlightedSentence text={example.en} word={card.key} /></p>`
    - Replace `        <b lang="en" className="text-title font-semibold">{card.word}</b>` with `        <b lang="en" {...lookupContext} className="text-title font-semibold">{card.word}</b>`
    - Replace `      {example ? <p lang="en" className="mt-1 text-sub text-ink-2"><HighlightedSentence text={example.en} word={card.key} /></p> : null}` with `      {example ? <p lang="en" {...lookupContext} className="mt-1 text-sub text-ink-2"><HighlightedSentence text={example.en} word={card.key} /></p> : null}`
  - `defs-en.tsx`:
    - Replace `import type { DefGroup } from "./def-lang";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import type { DefGroup } from "./def-lang";
      ```
    - Replace `        <li key={g.pos} lang="en" className="text-sub leading-dialogue text-ink-2">` with `        <li key={g.pos} lang="en" {...lookupContext} className="text-sub leading-dialogue text-ink-2">`
  - `phrases-section.tsx`:
    - Replace `import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
      ```
    - In the line starting `          <li key={i}>{showZh ?`, replace both occurrences of `<span lang="en" className="font-medium text-ink">{p.en}</span>` with `<span lang="en" {...lookupContext} className="font-medium text-ink">{p.en}</span>` (Edit with `replace_all: true`; that string occurs only on this line).
  - `word-card-legacy.test.tsx` (R-M4; **do not** run `-u`): replace `    expect(normalizeIds(container.innerHTML)).toMatchSnapshot();` with:
    ```ts
        // 计划 2026-10-15 R-M4:查词标记是后加的属性,比对金标准前去掉,金标准文件不重录
        expect(normalizeIds(container.innerHTML).replaceAll(' data-lookup-context=""', "")).toMatchSnapshot();
    ```
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/lookup-marks.test.tsx src/features/wordbook/word-card-legacy.test.tsx src/features/wordbook/word-card-defs.test.tsx src/features/wordbook/word-card-peek.test.tsx src/features/wordbook/word-card-zh-chip.test.tsx src/features/wordbook/phrases-section.test.tsx src/features/wordbook/phrases-section-zh.test.tsx src/architecture.test.ts`. Expected: PASS, and `git status` shows that the `__snapshots__` file is unchanged.
- [ ] **Step 5: commit** `feat(web): make wordbook card definitions, examples and phrases lookup-able`.

## Task T8: wordbook quiz marks (lane W; after T7)

**Files:** modify `after-answer-panel.tsx`, `choice-question.tsx`, `typing-question.tsx` and `lookup-marks.test.tsx`.

- [ ] **Step 1: test.** Append to `lookup-marks.test.tsx` (add `import { ChoiceQuestion } from "./choice-question";` and `import type { OptionInfo, Question } from "./wordbook-api";`, replacing the `import type { Card }` line with `import type { Card, OptionInfo, Question } from "./wordbook-api";`):
```tsx
const meaningQ: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk", us: "tɔk" }, options: ["v. 说话", "n. 事故"], length: null };
const clozeQ: Question = { key: "carry", qtype: "cloze", prompt: { sentence: "He _____ it.", zh: "他搬它。" }, options: ["stop", "carry"], length: null };
const INFO: OptionInfo[] = [
  { option: "v. 说话", word: "talk", defsZh: [{ pos: "v", text: "说话" }], defsEn: [] },
  { option: "n. 事故", word: "accident", defsZh: [{ pos: "n", text: "事故" }], defsEn: [] },
];

describe("wordbook quiz prompts become lookup-able only after the answer (R-M3)", () => {
  it("the meaning question's word", () => {
    const { rerender } = render(<ChoiceQuestion question={meaningQ} result={null} onAnswer={vi.fn()} />);
    expect(marked(screen.getByTestId("question-word"))).toBe(false);
    rerender(<ChoiceQuestion question={meaningQ} result={{ choice: "n. 事故", correct: false, correctOption: "v. 说话" }} onAnswer={vi.fn()} />);
    expect(marked(screen.getByTestId("question-word"))).toBe(true);
  });

  it("the cloze sentence", () => {
    const { rerender, container } = render(<ChoiceQuestion question={clozeQ} result={null} onAnswer={vi.fn()} />);
    const sentence = () => container.querySelector('p[lang="en"]')!;
    expect(marked(sentence())).toBe(false);
    rerender(<ChoiceQuestion question={clozeQ} result={{ choice: "stop", correct: false, correctOption: "carry" }} onAnswer={vi.fn()} />);
    expect(marked(sentence())).toBe(true);
  });

  it("answered option rows own their long-press, so the global recogniser skips them (R-L6)", () => {
    render(<ChoiceQuestion question={meaningQ} result={{ choice: "n. 事故", correct: false, correctOption: "v. 说话" }} onAnswer={vi.fn()} after={{ info: INFO }} />);
    for (const row of screen.getAllByTestId("choice-option")) expect(row).toHaveAttribute("data-lookup-press", "own");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/wordbook/lookup-marks.test.tsx`. Expected: the new cases FAIL.
- [ ] **Step 3: edits** (one-line anchors):
  - `choice-question.tsx`:
    - Replace `import { selectWord } from "~/lib/select-word";` with:
      ```ts
      import { lookupContextIf, ownLongPress } from "~/lib/lookup-context";
      import { selectWord } from "~/lib/select-word";
      ```
    - Replace `function ClozeSentence({ sentence }: { sentence: string }) {` with `function ClozeSentence({ sentence, marked = false }: { sentence: string; marked?: boolean }) {`
    - Replace `    <p lang="en" className="mt-2 text-title font-medium leading-dialogue">` with `    <p lang="en" {...lookupContextIf(marked)} className="mt-2 text-title font-medium leading-dialogue">`
    - Replace `            <span data-testid="question-word" lang="en"` with `            <span data-testid="question-word" lang="en" {...lookupContextIf(result !== null)}`
    - Replace `          <ClozeSentence sentence={prompt.sentence ?? ""} />` with `          <ClozeSentence sentence={prompt.sentence ?? ""} marked={result !== null} />`
    - Replace `              role: "button" as const, tabIndex: 0, ...press(String(i)), onClick: onRowClick, onKeyDown: onRowKeyDown,` with `              role: "button" as const, tabIndex: 0, ...ownLongPress, ...press(String(i)), onClick: onRowClick, onKeyDown: onRowKeyDown,`
  - `after-answer-panel.tsx`:
    - Replace `import { ListenButton, WordCardView, posLabel, type ListenProps } from "./word-card";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import { ListenButton, WordCardView, posLabel, type ListenProps } from "./word-card";
      ```
    - Replace `      <p lang="en" className="mt-1 break-words text-title font-semibold">{shown.word}</p>` with `      <p lang="en" {...lookupContext} className="mt-1 break-words text-title font-semibold">{shown.word}</p>`
  - `typing-question.tsx`:
    - Replace `import { PRIMARY } from "./ui";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import { PRIMARY } from "./ui";
      ```
    - Replace `<b lang="en" className="text-body font-semibold text-ink">{result.expected}</b>` with `<b lang="en" {...lookupContext} className="text-body font-semibold text-ink">{result.expected}</b>`
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/wordbook/lookup-marks.test.tsx src/features/wordbook/choice-question-after.test.tsx src/features/wordbook/choice-question.test.ts src/features/wordbook/after-answer-panel.test.tsx src/features/wordbook/typing-question.test.tsx src/features/wordbook/learn-page.test.tsx src/features/wordbook/review-page.test.tsx src/architecture.test.ts`. Expected: PASS. The learn page's disabled `button[data-state="correct"]` options are unchanged.
- [ ] **Step 5: commit** `feat(web): make answered wordbook quiz text lookup-able`.

## Task T9: wordbook summary / spell marks + wordbook guard (lane W; after T8)

**Files:** modify `session-summary.tsx`, `spell/spell-results.tsx` and `spell/explain-sheet.tsx`; create `web/src/lookup-marks.wordbook.test.ts`.

- [ ] **Step 1: guard** `web/src/lookup-marks.wordbook.test.ts`:
```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/** 计划 2026-10-15-global-longpress-glass-lookup 清单 W1–W15(R-M5):背单词里的英文学习内容带查词标记;答题前的题面不带(R-M3)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/wordbook/word-card.tsx", 4],
  ["features/wordbook/defs-en.tsx", 1],
  ["features/wordbook/phrases-section.tsx", 2],
  ["features/wordbook/after-answer-panel.tsx", 1],
  ["features/wordbook/choice-question.tsx", 3],
  ["features/wordbook/typing-question.tsx", 1],
  ["features/wordbook/session-summary.tsx", 1],
  ["features/wordbook/spell/spell-results.tsx", 2],
  ["features/wordbook/spell/explain-sheet.tsx", 1],
];

describe("lookup marks: wordbook", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
  it("never marks text before an answer or a reveal", () => {
    expect(lookupMarks(srcOf("features/wordbook/recall-card.tsx"))).toBe(0);
    expect(lookupMarks(srcOf("features/wordbook/spell/cloze-board.tsx"))).toBe(0);
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lookup-marks.wordbook.test.ts`. Expected: the last three rows FAIL.
- [ ] **Step 3: edits:**
  - `session-summary.tsx`:
    - Replace `import { DOCK, GHOST, PRIMARY } from "./ui";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import { DOCK, GHOST, PRIMARY } from "./ui";
      ```
    - Replace `                  <span lang="en" className="block text-body font-medium">{m.word}</span>` with `                  <span lang="en" {...lookupContext} className="block text-body font-medium">{m.word}</span>`
  - `spell/spell-results.tsx`:
    - Replace `import { OutcomeBadge } from "./outcome-badge";` with:
      ```ts
      import { lookupContext } from "~/lib/lookup-context";
      import { OutcomeBadge } from "./outcome-badge";
      ```
      If `spell-results.tsx` already imports another `~/lib/*` module, keep both lines.
    - Replace `                  <span className="text-title font-semibold text-ink">{w.card.word || w.key}</span>` with `                  <span lang="en" {...lookupContext} className="text-title font-semibold text-ink">{w.card.word || w.key}</span>`
    - Replace `      <b className="font-mono text-[17px] font-semibold tracking-[0.02em] text-ink" aria-label={t("web.wordbook.diff.label", { word: blank.expected })}>` with `      <b {...lookupContext} className="font-mono text-[17px] font-semibold tracking-[0.02em] text-ink" aria-label={t("web.wordbook.diff.label", { word: blank.expected })}>`
  - `spell/explain-sheet.tsx`:
    - Replace `import { cn } from "~/lib/cn";` with:
      ```ts
      import { cn } from "~/lib/cn";
      import { lookupContext } from "~/lib/lookup-context";
      ```
    - Replace `            <p className="mt-2.5 whitespace-pre-wrap break-words text-body leading-[1.6] text-ink">{ai.text}</p>` with `            <p {...lookupContext} className="mt-2.5 whitespace-pre-wrap break-words text-body leading-[1.6] text-ink">{ai.text}</p>`
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lookup-marks.wordbook.test.ts src/features/wordbook/session-summary.test.tsx src/features/wordbook/spell src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 5: commit** `feat(web): make wordbook summary and spelling results lookup-able`.

## Task T10: chat + agents marks (lane C; needs T1)

**Files:** modify `features/chat/grammar-details.tsx`, `features/chat/recap-sheet.tsx`, `features/chat/turn-detail-sheet.tsx`, `features/agents/tutor/tutor-bar.tsx`, `features/agents/tutor/tutor-recap-card.tsx` and `features/agents/persona-editor-sheet.tsx`; create `web/src/lookup-marks.chat.test.ts`.

- [ ] **Step 1: guard** `web/src/lookup-marks.chat.test.ts`. Use the same template as T9, with:
```ts
/** 计划 2026-10-15 清单 C1–C7(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/chat/grammar-details.tsx", 3],
  ["features/chat/recap-sheet.tsx", 3],
  ["features/chat/turn-detail-sheet.tsx", 2],
  ["features/agents/tutor/tutor-bar.tsx", 1],
  ["features/agents/tutor/tutor-recap-card.tsx", 1],
  ["features/agents/persona-editor-sheet.tsx", 1],
];
describe("lookup marks: chat and agents", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
```
  It needs the same three import lines as T9.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: edits.** In each file, add `import { lookupContext } from "~/lib/lookup-context";` directly after the anchor import line given, then add the mark:
  - `chat/grammar-details.tsx`:
    - Import after `import { savePracticeItem, useShadowSheet } from "~/features/practice";`.
    - Replace `                  <span className="text-ink-2 line-through">{e.original}</span>` with `                  <span {...lookupContext} className="text-ink-2 line-through">{e.original}</span>`.
    - Replace `                  <span className="font-semibold text-ink">{e.corrected || "∅"}</span>` with `                  <span {...lookupContext} className="font-semibold text-ink">{e.corrected || "∅"}</span>`.
  - `chat/recap-sheet.tsx`:
    - Import after `import type { TtsState } from "./use-tts-player";`.
    - Replace `                        <span className="mr-1 rounded-[4px] bg-amber-tint px-[3px] text-body font-medium text-amber">{w}</span>` with the same line with `{...lookupContext} ` inserted after `<span `.
  - `chat/turn-detail-sheet.tsx`:
    - Import after `import { poorWords } from "./voice-words";`.
    - In the line containing `<span className="font-medium text-amber">{weak.join(", ")}</span>`, replace that substring with `<span {...lookupContext} className="font-medium text-amber">{weak.join(", ")}</span>`.
  - `agents/tutor/tutor-bar.tsx`:
    - Import after `import { levelLabel } from "~/lib/levels";`.
    - Replace `<p data-testid="tutor-hint" role="status"` with `<p data-testid="tutor-hint" {...lookupContext} role="status"`.
  - `agents/tutor/tutor-recap-card.tsx`:
    - Import after `import { WordActions } from "~/lib/extension-points-react";`.
    - Replace `                <span className="min-w-0 truncate text-body text-teal">{w}</span>` with `                <span {...lookupContext} className="min-w-0 truncate text-body text-teal">{w}</span>`.
  - `agents/persona-editor-sheet.tsx`:
    - Import after `import { useAgentsConfig } from "./use-agents-data";`.
    - Replace `<p data-testid="agent-editor-try-reply" className=` with `<p data-testid="agent-editor-try-reply" {...lookupContext} className=`.
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lookup-marks.chat.test.ts src/features/chat/grammar-details.test.tsx src/features/chat/recap-sheet.test.tsx src/features/chat/turn-detail-sheet.test.tsx src/features/agents/tutor src/architecture.test.ts`. Expected: PASS. If one of these test files does not exist, drop it from the command.
- [ ] **Step 5: commit** `feat(web): make chat and tutor English text lookup-able`.

## Task T11: rooms + rank marks (lane S; needs T1)

**Files:** modify `features/rooms/room-message-list.tsx`, `rooms/voice/voice-bubble.tsx`, `rooms/assist/assist-dock.tsx`, `rooms/assist/suggestion-card.tsx`, `rooms/extras/summary-page.tsx`, `features/rank/match-page.tsx` and `rank/match-result.tsx`; create `web/src/lookup-marks.social.test.ts`.

- [ ] **Step 1: guard** `web/src/lookup-marks.social.test.ts`. Use the T9 template with:
```ts
/** 计划 2026-10-15 清单 S1–S18(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/rooms/room-message-list.tsx", 4],
  ["features/rooms/voice/voice-bubble.tsx", 2],
  ["features/rooms/assist/assist-dock.tsx", 1],
  ["features/rooms/assist/suggestion-card.tsx", 1],
  ["features/rooms/extras/summary-page.tsx", 4],
  ["features/rank/match-page.tsx", 4],
  ["features/rank/match-result.tsx", 2],
];
describe("lookup marks: rooms and rank", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
```
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: edits.** Add the import `import { lookupContext } from "~/lib/lookup-context";` after the given anchor. Each mark inserts `{...lookupContext} ` right after the tag name in the quoted line:
  - `rooms/room-message-list.tsx`:
    - Import after `import { isMostlyNative, speakable, spokenText } from "./extras/text-tools";`.
    - Lines:
      - `  if (!m) return <span className="whitespace-pre-wrap break-words">{text}</span>;`
      - `    <span className="whitespace-pre-wrap break-words">` (the 4-space-indented one inside `MessageText`'s `return (`; the line-39 anchor is different because it starts with `  if (!m)`)
      - `      {en && <p className="mt-1.5 whitespace-pre-wrap break-words text-body leading-dialogue">{en}</p>}`
      - `              <p className="mt-1.5 line-clamp-2 border-l-2 border-hair pl-2 text-meta text-ink-2">{question.sender.name}: {question.text}</p>`
  - `rooms/voice/voice-bubble.tsx`:
    - Import after `import { useVoicePlayer } from "./use-voice-player";`.
    - Lines:
      - `  if (!voice) return <span className="whitespace-pre-wrap break-words">{message.text}</span>;`
      - `        <p className="mt-1.5 whitespace-pre-wrap break-words border-t-[0.5px] border-hair-2 pt-[7px] text-body leading-dialogue">{voice.transcript}</p>`
  - `rooms/assist/assist-dock.tsx`:
    - Import after `import { SuggestionCard } from "./suggestion-card";`.
    - Line: `                          <span key={`${g.src}-${g.en}`} className="rounded-inline bg-surface-2 px-2 py-[3px] text-meta text-ink">{`${g.src} → ${g.en}`}</span>` (insert after `<span key={`${g.src}-${g.en}`} `).
  - `rooms/assist/suggestion-card.tsx`:
    - Import after `import { useTranslation } from "react-i18next";`.
    - Line: `      <p className="pr-1 text-body font-medium leading-[1.4] text-ink">{en}</p>`.
  - `rooms/extras/summary-page.tsx`:
    - Import after `import { useRoomSummary } from "./use-room-summary";`.
    - Lines:
      - `                <p className="text-sub leading-[1.45] text-ink-2">{f.original}</p>`
      - `                  <span className="min-w-0">{f.better}</span>`
      - `                  <p className="text-body font-semibold text-ink">{w.en}<small className="ml-1.5 text-sub font-medium text-ink-2">{w.zh}</small></p>`
      - `                  {w.example && <p className="mt-0.5 text-meta text-ink-2">{w.example}</p>}`
  - `rank/match-page.tsx`:
    - Import after `import { MAX_HOLD_MS, useMatch } from "./use-match";`.
    - Lines:
      - `          <li key={f} className="flex items-center gap-1.5"><CircleIcon aria-hidden className="size-3.5 flex-none" />{f}</li>`
      - `                    <li key={f} className="flex items-center gap-2"><CircleIcon aria-hidden className="size-3.5 flex-none text-ink-3" />{f}</li>`
      - in `            {showText || i < lastIndex ? <p>{item.text}</p> : …`, replace `<p>{item.text}</p>` with `<p {...lookupContext}>{item.text}</p>`
      - `          <div key={i} data-testid="match-user-line"` becomes `          <div key={i} data-testid="match-user-line" {...lookupContext}`
  - `rank/match-result.tsx`:
    - Import after `import { CARD, GHOST_BUTTON } from "./ui";`.
    - Lines:
      - `                <span className={met ? "text-ink" : "text-ink-2"}>{f}</span>`
      - `              <p className="text-title font-medium leading-[1.45]">{verdict.drillEn}</p>`
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lookup-marks.social.test.ts src/features/rooms src/features/rank src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 5: commit** `feat(web): make room and rank English text lookup-able`.

## Task T12: library / vocabulary / progress / plugins marks (lane O; needs T1)

**Files:** modify `features/library/analysis-card.tsx`, `features/vocabulary/vocabulary-page.tsx`, `features/progress/progress-page.tsx`, `plugins/mistakes/mistakes-page.tsx` and `plugins/pron-shadow/weak-words-page.tsx`; create `web/src/lookup-marks.other.test.ts`.

- [ ] **Step 1: guard** `web/src/lookup-marks.other.test.ts`. Use the T9 template with:
```ts
/** 计划 2026-10-15 清单 O1–O5(R-M5)。 */
const MARKS: Array<[file: string, atLeast: number]> = [
  ["features/library/analysis-card.tsx", 1],
  ["features/vocabulary/vocabulary-page.tsx", 1],
  ["features/progress/progress-page.tsx", 1],
  ["plugins/mistakes/mistakes-page.tsx", 1],
  ["plugins/pron-shadow/weak-words-page.tsx", 1],
];
describe("lookup marks: library, vocabulary, progress and plugins", () => {
  it.each(MARKS)("%s has at least %i marked elements", (file, n) => {
    expect(lookupMarks(srcOf(file))).toBeGreaterThanOrEqual(n);
  });
});
```
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: edits.** Add the import after the given anchor, then insert `{...lookupContext} ` after the tag name:
  - `library/analysis-card.tsx`:
    - Import after `import { analyzeSegment } from "./library-api";`.
    - Line: `            <div className="select-text">`. If it is not unique, Read the file and use the occurrence at line 164, inside `state.status === "done"`.
  - `vocabulary/vocabulary-page.tsx`:
    - Import after `import { Slot } from "~/lib/extension-points-react";`.
    - Line: `                        <p className="truncate text-body font-medium tracking-[-0.005em] text-ink">{i.word}</p>`.
  - `progress/progress-page.tsx`:
    - Import after `import { PageHeader } from "~/layout/page-header";`.
    - Line: `                        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">`.
  - `plugins/mistakes/mistakes-page.tsx`:
    - Import after `import { WordActions } from "~/lib/extension-points-react";`.
    - Line: `                  <p lang="en" className="truncate text-body font-semibold tracking-[-0.005em] text-ink">{item.word}</p>`.
  - `plugins/pron-shadow/weak-words-page.tsx`:
    - Import after `import { PageHeader } from "~/layout/page-header";`.
    - Line: `                    <b lang="en" className="block truncate text-body font-semibold text-ink">{item.word}</b>`.
- [ ] **Step 4:** Run `cd web && yarn vitest run src/lookup-marks.other.test.ts src/features/library/analysis-card.test.tsx src/features/vocabulary src/features/progress src/plugins/mistakes src/plugins/pron-shadow src/architecture.test.ts`. Expected: PASS. Drop any path that does not exist.
- [ ] **Step 5: commit** `feat(web): make library analysis, word lists and progress words lookup-able`.

## Task T13: central guard (after lanes W, C, S and O merge)

**Files:** create `web/src/lookup-marks.test.ts`.

- [ ] **Step 1: write the guard.** It must pass on the merged tree:
```ts
// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lookupMarks, srcOf } from "~/test/lookup-marks";

/**
 * 全站长按查词的总清单守卫(计划 2026-10-15-global-longpress-glass-lookup R-M5):分区清单在 lookup-marks.<lane>.test.ts;
 * 这里守总数、不标在按钮 / 链接上、答题前不可查(R-M3)、原有的 15 处仍在。
 */
const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const posix = (p: string) => p.split(path.sep).join("/");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [posix(path.relative(srcRoot, full))] : [];
  });
}
const FILES = [...walk(path.join(srcRoot, "features")), ...walk(path.join(srcRoot, "plugins"))].filter((f) => !f.startsWith("features/lookup/"));

const LEGACY = [
  "features/chat/message-bubble.tsx", "features/chat/hints-sheet.tsx", "features/chat/grammar-details.tsx", "features/chat/recap-sheet.tsx",
  "features/chat/sentence-practice-sheet.tsx", "features/chat/turn-detail-sheet.tsx", "features/library/shadow-panel.tsx",
  "features/practice/assessment-page.tsx", "features/practice/shadow/shadow-result.tsx", "features/practice/shadow/shadow-sheet.tsx",
  "features/realtime/call-captions.tsx", "features/vocabulary/review-card.tsx", "features/wordbook/choice-question.tsx",
];

describe("global lookup marks", () => {
  it("covers at least 60 English-content elements across features and plugins", () => {
    const total = FILES.reduce((sum, f) => sum + lookupMarks(srcOf(f)), 0);
    expect(total).toBeGreaterThanOrEqual(60);
  });
  it("keeps every context that existed before this plan", () => {
    for (const f of LEGACY) expect(lookupMarks(srcOf(f)), f).toBeGreaterThan(0);
  });
  it("never puts a mark on a button, link or anchor opening tag (R-L2)", () => {
    for (const f of FILES) {
      for (const line of srcOf(f).split("\n")) {
        expect(/<(button|Link|a)\s[^>]*(\{\.\.\.lookupContext\}|lookupContextIf\(|data-lookup-context)/.test(line), `${f}: ${line.trim()}`).toBe(false);
      }
    }
  });
  it("never makes an unanswered prompt lookup-able (R-M3)", () => {
    expect(lookupMarks(srcOf("features/wordbook/recall-card.tsx"))).toBe(0);
    expect(lookupMarks(srcOf("features/wordbook/spell/cloze-board.tsx"))).toBe(0);
    const choice = srcOf("features/wordbook/choice-question.tsx");
    expect(choice).toContain("lookupContextIf(result !== null)");
    expect(choice).toContain("marked={result !== null}");
    expect(srcOf("features/wordbook/word-card.tsx")).toContain("lookupContextIf(!covered)");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/lookup-marks.test.ts src/lookup-marks.wordbook.test.ts src/lookup-marks.chat.test.ts src/lookup-marks.social.test.ts src/lookup-marks.other.test.ts src/architecture.test.ts`. Expected: PASS. If the total is below 60, a lane is missing a mark: fix that lane's file, not the threshold.
- [ ] **Step 3: commit** `test(web): guard the global lookup inventory`.

---

## Task T14: glass tokens and recipes (lane G; BLOCKED ON MOCKUP APPROVAL)

**Files:** modify `web/src/styles/theme.css`, `web/src/styles/theme.test.ts` and `web/src/index.css`; create `web/src/styles/glass-lookup.test.ts`.

- [ ] **Step 1: test** `web/src/styles/glass-lookup.test.ts`:
```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* 计划 2026-10-15-global-longpress-glass-lookup R-G1–R-G8:查词玻璃的令牌与配方。只断言源码;真实合成与可读性见真机清单(未验证)。 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const indexCss = read("../index.css");
const themeCss = read("./theme.css");
function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const root = tokens(themeCss, ":root");
const dark = tokens(themeCss, ".dark");
const alpha = (v: string) => Number(/,\s*([\d.]+)\)$/.exec(v)?.[1]);
const START = "查词玻璃(计划 2026-10-15-global-longpress-glass-lookup";
const section = indexCss.slice(indexCss.indexOf(START), indexCss.indexOf("查词玻璃结束"));

describe("glass lookup tokens (R-G1, R-G3, R-G8)", () => {
  it("ships the approved variant (B) in light and dark", () => {
    expect(root["--glass-pop"]).toBe("rgba(255, 255, 255, 0.1)");
    expect(dark["--glass-pop"]).toBe("rgba(23, 25, 30, 0.1)");
    expect(root["--glass-sheet"]).toBe("rgba(255, 255, 255, 0.55)");
    expect(dark["--glass-sheet"]).toBe("rgba(23, 25, 30, 0.55)");
  });
  it("never goes below the legibility floor: bar ≥ 6%, drawer ≥ 38%", () => {
    for (const set of [root, dark]) {
      expect(alpha(set["--glass-pop"])).toBeGreaterThanOrEqual(0.06);
      expect(alpha(set["--glass-sheet"])).toBeGreaterThanOrEqual(0.38);
      expect(alpha(set["--glass-sheet-lite"])).toBe(0.86);
    }
  });
  it("defines the well, scrim and sheet shadow in both themes", () => {
    for (const name of ["--glass-well", "--glass-well-bd", "--lookup-scrim", "--glass-sheet-sh"]) {
      expect(root, name).toHaveProperty(name);
      expect(dark, name).toHaveProperty(name);
    }
  });
});

describe("glass lookup recipes (R-G1, R-G3, R-G5)", () => {
  it("has a solid fallback first, then blur only under @supports", () => {
    expect(section.indexOf(".glass-pop {")).toBeLessThan(section.indexOf("@supports ((-webkit-backdrop-filter"));
    expect(section).toContain("background: var(--glass-pop);");
    expect(section).toContain("background: var(--glass-sheet);");
    expect(section).toContain("-webkit-backdrop-filter: blur(28px) saturate(1.8);");
    expect(section).toContain("-webkit-backdrop-filter: blur(36px) saturate(1.8);");
  });
  it("uses the light blur on low-end devices and goes solid for reduced transparency", () => {
    expect(section).toContain("html.lite .glass-pop {");
    expect(section).toContain("html.lite .glass-sheet {");
    expect(section).toContain("@media (prefers-reduced-transparency: reduce)");
    expect(section).toContain("background: rgb(var(--surface));");
  });
  it("adds no 4th blur layer on library screens", () => {
    expect(section).toContain("@supports selector(:has(*))");
    expect(section).toContain("html:has(.library-root) .glass-pop");
    expect(section).toContain("html:has(.library-root) .glass-sheet");
  });
  it("gives the bar's icons the tab bar halo, but not the primary trigger", () => {
    expect(section).toContain('.pop-halo :not([data-testid="lookup-trigger"]) > svg');
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/styles/glass-lookup.test.ts`. Expected: FAIL.
- [ ] **Step 3: tokens** (`theme.css`):
  - Replace `  --tab-halo: rgba(255, 255, 255, 0.9);` with:
    ```css
      --tab-halo: rgba(255, 255, 255, 0.9);
      /* 查词玻璃(计划 2026-10-15-global-longpress-glass-lookup R-G1–R-G4;透明度方案 B) */
      --glass-pop: rgba(255, 255, 255, 0.1);
      --glass-sheet: rgba(255, 255, 255, 0.55);
      --glass-sheet-lite: rgba(255, 255, 255, 0.86);
      --glass-sheet-sh: 0 24px 48px -16px rgba(17, 19, 24, 0.45), 0 1px 2px rgba(17, 19, 24, 0.08);
      --glass-well: rgba(255, 255, 255, 0.45);
      --glass-well-bd: rgba(255, 255, 255, 0.7);
      --lookup-scrim: rgba(17, 19, 24, 0.14);
    ```
  - Replace `  --tab-halo: rgba(0, 0, 0, 0.6);` with:
    ```css
      --tab-halo: rgba(0, 0, 0, 0.6);
      --glass-pop: rgba(23, 25, 30, 0.1);
      --glass-sheet: rgba(23, 25, 30, 0.55);
      --glass-sheet-lite: rgba(23, 25, 30, 0.86);
      --glass-sheet-sh: 0 24px 48px -16px rgba(0, 0, 0, 0.7), 0 1px 2px rgba(0, 0, 0, 0.3);
      --glass-well: rgba(255, 255, 255, 0.06);
      --glass-well-bd: rgba(255, 255, 255, 0.12);
      --lookup-scrim: rgba(0, 0, 0, 0.34);
    ```
  - In `theme.test.ts`, replace `  "--glass-float", "--glass-float-lite", "--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on", "--tab-halo",` with:
    ```ts
      "--glass-float", "--glass-float-lite", "--glass-float-bd", "--glass-float-hi", "--glass-float-sh", "--tab-on", "--tab-halo",
      "--glass-pop", "--glass-sheet", "--glass-sheet-lite", "--glass-sheet-sh", "--glass-well", "--glass-well-bd", "--lookup-scrim",
    ```
  If the owner picked A or C, use that row of the "Transparency table" for `--glass-pop` / `--glass-sheet` and change the first `it` of the test to match.
- [ ] **Step 4: recipes** (`index.css`). Replace `  /* ----- 悬浮玻璃底栏结束 ----- */` with:
```css
  /* ----- 悬浮玻璃底栏结束 ----- */

  /* ----- 查词玻璃(计划 2026-10-15-global-longpress-glass-lookup R-G1–R-G7):选词操作条 .glass-pop、查词抽屉 .glass-sheet ----- */
  .glass-pop {
    background: var(--glass-solid);
    border: 1px solid var(--glass-float-bd);
    box-shadow: var(--glass-float-hi), var(--glass-float-sh);
  }
  .glass-sheet {
    background: var(--glass-solid);
    border: 1px solid var(--glass-float-bd);
    box-shadow: var(--glass-float-hi), var(--glass-sheet-sh);
  }
  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .glass-pop {
      background: var(--glass-pop);
      -webkit-backdrop-filter: blur(28px) saturate(1.8);
      backdrop-filter: blur(28px) saturate(1.8);
    }
    .glass-sheet {
      background: var(--glass-sheet);
      -webkit-backdrop-filter: blur(36px) saturate(1.8);
      backdrop-filter: blur(36px) saturate(1.8);
    }
    html.lite .glass-pop {
      background: var(--glass-float-lite);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
    html.lite .glass-sheet {
      background: var(--glass-sheet-lite);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
    }
  }
  /* 跟读库每屏已有 3 层模糊(library.css):那里不叠第 4 层,改用实底玻璃色(R-G5);不支持 :has 的浏览器保留模糊 */
  @supports selector(:has(*)) {
    html:has(.library-root) .glass-pop,
    html:has(.library-root) .glass-sheet {
      background: var(--glass-solid);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
  }
  .pop-halo :not([data-testid="lookup-trigger"]) > svg {
    filter: drop-shadow(0 0 3px var(--tab-halo));
  }
  @media (prefers-reduced-transparency: reduce) {
    .glass-pop,
    .glass-sheet,
    html.lite .glass-pop,
    html.lite .glass-sheet {
      background: rgb(var(--surface));
      border-color: var(--hair);
      -webkit-backdrop-filter: none;
      backdrop-filter: none;
    }
    .pop-halo :not([data-testid="lookup-trigger"]) > svg {
      filter: none;
    }
  }
  @supports selector(:has(*)) {
    @media (prefers-reduced-transparency: reduce) {
      html:has(.library-root) .glass-pop,
      html:has(.library-root) .glass-sheet {
        background: rgb(var(--surface));
        border-color: var(--hair);
      }
    }
  }
  /* ----- 查词玻璃结束 ----- */
```
  Also in the header comment, replace the line ` *   .glass-float    悬浮圆角玻璃,只给全站底部 Tab 栏(近乎透明 + blur 28px + 高光描边;回退同上);.tab-halo 给标签与图标加光晕` with:
  ```css
   *   .glass-float    悬浮圆角玻璃,只给全站底部 Tab 栏(近乎透明 + blur 28px + 高光描边;回退同上);.tab-halo 给标签与图标加光晕
   *   .glass-pop      选词操作条(同 .glass-float 形状,底色 --glass-pop);.glass-sheet 查词抽屉悬浮卡片(blur 36px,底色 --glass-sheet);
   *                   二者不同时出现,算一层临时模糊;跟读库里不模糊(:has,见 2026-10-15 计划 R-G5)
  ```
  The `:has` selectors sit inside `selector()` `@supports` blocks on purpose. A selector list that contains an unsupported `:has` is dropped as a whole, so it must never share a rule with `.glass-pop` alone.
- [ ] **Step 5:** Run `cd web && yarn vitest run src/styles/glass-lookup.test.ts src/styles/theme.test.ts src/styles/floating-tab-bar.test.ts src/architecture.test.ts`. Expected: PASS.
- [ ] **Step 6: commit** `feat(web): add glass recipes for the lookup bar and drawer`.

## Task T15: glass selection bar (lane G; after T14; BLOCKED ON MOCKUP APPROVAL)

**Files:** modify `web/src/features/lookup/lookup-bar.tsx` and `web/src/features/lookup/lookup-bar-offset.test.ts`.

- [ ] **Step 1: test.** Append inside the `describe` of `lookup-bar-offset.test.ts`:
```ts
  it("is a floating rounded glass pill above the tab bar (plan 2026-10-15 R-G1, R-G2)", () => {
    for (const cls of ["glass-pop", "pop-halo", "h-[54px]", "rounded-[27px]", "p-1", "z-40", "select-none"]) expect(src).toContain(cls);
    for (const cls of ["bg-surface", "shadow-lg", "border-border", "rounded-full border"]) expect(src).not.toContain(cls);
  });
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/lookup-bar-offset.test.ts`. Expected: FAIL.
- [ ] **Step 3: edit.** Replace the line
  `      className="absolute bottom-[calc(var(--tab-bar-space)+0.5rem)] left-1/2 z-40 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg select-none"`
  with
  `      className="glass-pop pop-halo absolute bottom-[calc(var(--tab-bar-space)+0.5rem)] left-1/2 z-40 flex h-[54px] max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-[27px] p-1 select-none"`.
  The trigger keeps `className="h-11 rounded-full px-4"`. Leave every handler untouched (R-L8).
- [ ] **Step 4:** Run `cd web && yarn vitest run src/features/lookup/lookup-bar-offset.test.ts src/features/lookup/lookup-bar.test.tsx src/features/lookup/lookup-layer.test.tsx`. Expected: PASS.
- [ ] **Step 5: commit** `feat(web): turn the selection bar into a floating glass pill`.

## Task T16: opt-in glass `BottomSheetContent` (lane G; after T14; BLOCKED ON MOCKUP APPROVAL)

**Files:** modify `web/src/components/bottom-sheet.tsx`; create `web/src/components/bottom-sheet.test.tsx`.

**Interface:** `BottomSheetContent` accepts `glass?: boolean` (default `false`). The default output is unchanged.

- [ ] **Step 1: test** `bottom-sheet.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "./bottom-sheet";

const sheet = (glass?: boolean) =>
  render(
    <BottomSheet open>
      <BottomSheetContent glass={glass} data-testid="c" aria-describedby={undefined}>
        <BottomSheetHeader title="t" />
      </BottomSheetContent>
    </BottomSheet>,
  );
const classes = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe("BottomSheetContent (plan 2026-10-15 R-G3)", () => {
  it("keeps the solid sheet by default", () => {
    sheet();
    expect(classes("c")).toEqual(expect.arrayContaining(["inset-x-0", "bottom-0", "rounded-t-sheet", "bg-surface"]));
    expect(classes("c")).not.toContain("glass-sheet");
    expect(classes("sheet-overlay")).toContain("bg-[rgba(17,19,24,0.32)]");
  });
  it("floats a rounded glass card over a light scrim when `glass`", () => {
    sheet(true);
    expect(classes("c")).toEqual(expect.arrayContaining(["glass-sheet", "inset-x-2", "rounded-dock", "pb-4", "z-50", "max-w-screen-sm"]));
    for (const cls of ["bg-surface", "rounded-t-sheet", "inset-x-0", "w-full"]) expect(classes("c")).not.toContain(cls);
    expect(classes("sheet-overlay")).toContain("bg-[color:var(--lookup-scrim)]");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/components/bottom-sheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: implement.** Read `bottom-sheet.tsx`, then Write it with these changes; everything else stays byte-identical:
  - Above `export const BottomSheet = DialogPrimitive.Root;` add:
    ```ts
    /** 默认实底抽屉(与改动前逐字相同) */
    const SOLID = "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-screen-sm rounded-t-sheet bg-surface px-gutter pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 text-ink shadow-[0_-0.5px_0_var(--hair),0_-12px_32px_-16px_rgba(17,19,24,0.28)] focus:outline-none";
    /** 悬浮玻璃卡片(查词抽屉,计划 2026-10-15 R-G3):离左右 8px、让开 Home 横条、四角 28、.glass-sheet(index.css,含回退) */
    const GLASS = "glass-sheet fixed inset-x-2 bottom-[max(8px,calc(env(safe-area-inset-bottom)-8px))] z-50 mx-auto max-w-screen-sm rounded-dock px-gutter pb-4 pt-2 text-ink focus:outline-none";
    const SCRIM = "fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";
    ```
  - Change the `forwardRef` type to `ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { glass?: boolean }` and the parameters to `({ className, children, glass = false, ...props }, ref)`.
  - Change the overlay className to `className={cn(SCRIM, glass ? "bg-[color:var(--lookup-scrim)]" : "bg-[rgba(17,19,24,0.32)] dark:bg-[rgba(0,0,0,0.55)]")}`.
  - Change the content `className={cn(` arguments to `glass ? GLASS : SOLID,` followed by the unchanged transition line and `className,`.
  - Update the component comment: add one line, `glass:查词抽屉用的悬浮玻璃卡片 + 淡遮罩(其余抽屉不传,保持实底)。`
- [ ] **Step 4:** Run `cd web && yarn vitest run src/components/bottom-sheet.test.tsx src/features/lookup/lookup-layer.test.tsx src/features/library/add-sheet.test.tsx src/architecture.test.ts`. Expected: PASS. Drop `add-sheet.test.tsx` if it does not exist.
- [ ] **Step 5: commit** `feat(web): add an opt-in floating glass bottom sheet`.

## Task T17: glass lookup drawer (lane G; after T15, T16 and lane R; BLOCKED ON MOCKUP APPROVAL)

**Files:** create `web/src/features/lookup/glass.ts` and `web/src/features/lookup/lookup-glass.test.tsx`; modify `web/src/features/lookup/lookup-layer.tsx` and `web/src/features/lookup/dictionary-result.tsx`.

- [ ] **Step 1: test** `lookup-glass.test.tsx`:
```tsx
import "fake-indexeddb/auto";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "./lookup-layer";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const DICT = {
  hit: true, word: "country", phonetic: "ˈkʌntri", source: "dict", def_lang: "en",
  defs_zh: [{ pos: "n", text: "国家" }], defs_en: [{ pos: "n", text: "a nation with its own government" }],
  phrases: [{ en: "country club", zh: "乡村俱乐部" }],
};

async function openDrawer() {
  const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json(DICT) });
  renderWithProviders(
    <WithShadowSheet><p data-testid="ctx" data-lookup-context>ask not what your country can do</p><LookupLayer /></WithShadowSheet>,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
  );
  const node = screen.getByTestId("ctx").firstChild!;
  const start = node.textContent!.indexOf("country");
  await act(async () => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, start + 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await userEvent.click(await screen.findByTestId("lookup-trigger"));
  await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
}
const cls = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe("glass lookup drawer (plan 2026-10-15 R-G3, R-G4)", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });

  it("is a floating glass card over a light scrim, with well-style controls", async () => {
    await openDrawer();
    expect(cls("lookup-drawer")).toEqual(expect.arrayContaining(["glass-sheet", "rounded-dock"]));
    expect(cls("lookup-drawer")).not.toContain("rounded-t-xl");
    expect(cls("sheet-overlay")).toContain("bg-[color:var(--lookup-scrim)]");
    expect(cls("lookup-source")).toEqual(expect.arrayContaining(["rounded-full", "bg-[color:var(--glass-well)]"]));
    expect(cls("lookup-switch-mode")).toEqual(expect.arrayContaining(["rounded-full", "bg-[color:var(--glass-well)]"]));
    expect(cls("lookup-ai-explain")).toContain("bg-[color:var(--glass-well)]");
  });

  it("keeps the 中文 chip: a well when off, blue tint when on (behaviour unchanged)", async () => {
    await openDrawer();
    expect(cls("lookup-zh")).toContain("bg-[color:var(--glass-well)]");
    await userEvent.click(screen.getByTestId("lookup-zh"));
    expect(cls("lookup-zh")).toContain("bg-blue-tint");
    expect(screen.getByTestId("lookup-dict-zh")).toHaveTextContent("国家");
  });
});
```
- [ ] **Step 2:** Run `cd web && yarn vitest run src/features/lookup/lookup-glass.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Write `web/src/features/lookup/glass.ts`:
```ts
/** 查词抽屉里的「小井」控件:半透明、发丝描边、圆胶囊,自身不模糊(计划 2026-10-15 R-G4;令牌在 styles/theme.css)。 */
export const LOOKUP_WELL = "rounded-full border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)] shadow-none";
/** 来源小标签(词典 / AI) */
export const LOOKUP_SOURCE_CHIP =
  "inline-flex h-[22px] items-center rounded-full border-[0.5px] border-[color:var(--glass-well-bd)] bg-[color:var(--glass-well)] px-2.5 text-xs font-semibold text-muted-foreground";
```
- [ ] **Step 4: edits in `lookup-layer.tsx`** (one-line anchors):
  - Replace `import { DictionaryResult } from "./dictionary-result";` with:
    ```ts
    import { DictionaryResult } from "./dictionary-result";
    import { LOOKUP_SOURCE_CHIP, LOOKUP_WELL } from "./glass";
    ```
  - Replace `        <BottomSheetContent data-testid="lookup-drawer"` with `        <BottomSheetContent data-testid="lookup-drawer" glass`.
  - Replace `          className="max-h-[70dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">` with `          className="max-h-[70dvh] overflow-y-auto">`.
  - Replace `            <SheetTitle className="line-clamp-3 text-left">{target?.text}</SheetTitle>` with `            <SheetTitle className="line-clamp-3 pr-10 text-left text-[22px] font-semibold tracking-[-0.015em]">{target?.text}</SheetTitle>`.
  - Replace `              <p data-testid="lookup-source" data-source={done.source} className="text-xs text-muted-foreground">` with `              <p data-testid="lookup-source" data-source={done.source} className={LOOKUP_SOURCE_CHIP}>`.
  - Replace `                <Button variant="outline" data-testid="lookup-ai-explain" className="h-11 w-full" onClick={() => void explain()}>` with `                <Button variant="outline" data-testid="lookup-ai-explain" className={`h-11 w-full ${LOOKUP_WELL}`} onClick={() => void explain()}>`.
  - Replace `                  <Button variant="outline" data-testid="lookup-ai-retry" className="h-11 w-full" onClick={() => void explain()}>{t("web.common.retry")}</Button>` with the same line where `className="h-11 w-full"` becomes ``className={`h-11 w-full ${LOOKUP_WELL}`}``.
  - Replace `            <Button variant="outline" data-testid="lookup-switch-mode" className="h-11 flex-1"` with ``            <Button variant="outline" data-testid="lookup-switch-mode" className={`h-11 flex-1 ${LOOKUP_WELL}`}``.
  - Replace `              <Button data-testid="lookup-retry" className="h-11 flex-1" onClick={() => void run(target, mode)}>{t("web.common.retry")}</Button>` with the same line where `className="h-11 flex-1"` becomes `className="h-11 flex-1 rounded-full"`.
  - Replace `                <Button variant="outline" data-testid="lookup-practice" className="h-11 min-w-11 flex-1" disabled={tooLong}` with ``                <Button variant="outline" data-testid="lookup-practice" className={`h-11 min-w-11 flex-1 ${LOOKUP_WELL}`} disabled={tooLong}``.
  - Replace `                <Button variant="outline" data-testid="lookup-save" className="h-11 min-w-11 flex-1" disabled={tooLong || saving}` with ``                <Button variant="outline" data-testid="lookup-save" className={`h-11 min-w-11 flex-1 ${LOOKUP_WELL}`} disabled={tooLong || saving}``.
- [ ] **Step 5: edit in `dictionary-result.tsx`:**
  - Replace `import { drawerDefs, enPosLabel, type DictEntry } from "./dictionary";` with:
    ```ts
    import { drawerDefs, enPosLabel, type DictEntry } from "./dictionary";
    import { LOOKUP_WELL } from "./glass";
    ```
  - Replace `        <ZhToggle pressed={peek} onToggle={() => setPeekOf(peek ? null : entry)} label={t("web.lookup.zh")} testId="lookup-zh" />` with `        <ZhToggle pressed={peek} onToggle={() => setPeekOf(peek ? null : entry)} label={t("web.lookup.zh")} testId="lookup-zh" className={peek ? undefined : LOOKUP_WELL} />`.
- [ ] **Step 6:** Run `cd web && yarn vitest run src/features/lookup src/components/zh-toggle.test.tsx src/architecture.test.ts`. Expected: PASS. Every existing drawer behaviour test must stay green: dictionary first, LLM fallback, AI explain, translate switch, 中文 chip, `lookup-vocab` slot, `lookup-practice` opening the shadow sheet, swipe-to-close, and closing on PUSH navigation. If `tailwind-merge` drops a `bg-[color:…]` class against `bg-background` / `bg-surface`, write it as `!bg-[color:var(--glass-well)]` in `glass.ts`. Record that in the results table; do not change the tests.
- [ ] **Step 7: commit** `feat(web): turn the lookup drawer into a floating glass card`.

---

## Task T18: docs (after everything merges)

**Files:** `web/src/features/lookup/CLAUDE.md`, `web/src/features/wordbook/CLAUDE.md`, `web/src/lib/CLAUDE.md`, `web/src/components/CLAUDE.md`, `web/README.md` and `docs/superpowers/design/redesign-v3/design-notes.md` (Addendum only).

- [ ] **lookup/CLAUDE.md:**
  - "What lives here": add `use-long-press-lookup.ts` (global touch long-press: marked contexts only, 450 ms / 8 px, native selection wins, `selectWordAt`, `readNow`, trailing click swallowed, off while the drawer is open; plan `2026-10-15-global-longpress-glass-lookup`) and `glass.ts` (well / source-chip classes).
  - Pitfalls, add:
    - "Never `preventDefault` `contextmenu` in the recogniser (Android loses drag-select, R-L4)."
    - "Mark new English learning text with `{...lookupContext}` from `~/lib/lookup-context`, and list it in a `src/lookup-marks.<lane>.test.ts`."
    - "Elements with their own long-press spread `ownLongPress`."
    - "The bar is `.glass-pop`, and the drawer is `BottomSheetContent glass` (`.glass-sheet`); on library screens both are solid (`:has`, R-G5)."
  - Replace the sentence "Lookup is disabled inside realtime call captions." with "Realtime call captions carry `data-lookup-context` (`realtime/call-captions.tsx`); the full-screen call (z-50) sits above the bar (z-40), see plan 2026-10-15 Q6."
- [ ] **wordbook/CLAUDE.md:**
  - In the review after-answer bullet, change `long-press.ts` (pure state machine) to "`long-press.ts` (re-export of `~/lib/long-press`)".
  - Add to Pitfalls: "Card, recap, defs, phrases, after-answer, summary and spell-result English text is marked with `lookupContext`. Quiz prompts only after the answer (`lookupContextIf(result !== null)`); never the recall front, the covered headword or the spelling cloze (plan 2026-10-15 R-M3, guarded by `src/lookup-marks.test.ts`). Answered option rows spread `ownLongPress`. `word-card-legacy.test.tsx` strips `data-lookup-context` before comparing (R-M4)."
- [ ] **lib/CLAUDE.md:** add the bullets `lookup-context.ts` (marks + `lookupPressContext`) and `long-press.ts` (pure long-press machine, moved from wordbook). Extend the `select-word.ts` bullet with `selectWordAt(x, y, doc, within)` (Latin word at point; a native selection wins).
- [ ] **components/CLAUDE.md:** in the `bottom-sheet.tsx` mention, add "`glass` prop = floating glass card + light scrim (lookup drawer only)".
- [ ] **web/README.md:** in the lookup paragraph's "**未在真机验证:**" list, append: "全站长按查词(450 ms 选中手指下的英文单词)与玻璃操作条 / 抽屉未在真机验证,清单见 `docs/superpowers/plans/2026-10-15-global-longpress-glass-lookup.md`。"
- [ ] **design-notes.md:** append `## Addendum (2026-10-15): lookup glass`. It says that `.glass-pop` / `.glass-sheet` are a single *transient* blur layer (bar and drawer never together), allowed above the 3 resident layers except on library screens, where `:has(.library-root)` makes them solid (R-G5). Inner controls are wells without blur.
- [ ] Run `cd web && yarn vitest run src/architecture.test.ts` and `yarn web:typecheck`. Commit `docs(web): document global long-press lookup and lookup glass`.

## Task T19 (controller only, after merge, deploy and the owner's device check): changelog draft

- [ ] Only after the owner has checked on a phone, append an entry to `docs/changelog/2026-10.json` (see `docs/CLAUDE.md`).
  - `entry_date` = the deploy date and `version: null`.
  - Each item is one sentence of at most 200 characters, in zh and en, with no internal terms.
  - Drop the items that did not ship. For example, if only the marks and recogniser shipped, keep the first and last items.

  Template:
```json
  {
    "entry_date": "2026-10-DD",
    "version": null,
    "title_zh": "长按查词全站可用,查词弹层换成玻璃样式",
    "title_en": "Press-and-hold lookup everywhere, glass lookup popups",
    "items": [
      { "tag": "new", "zh": "学新词、复习、拼写、对话、联机、排位、跟读库等页面里的英文释义、例句和短语,按住一个英文单词约半秒就会选中它并出现查词条。", "en": "Press and hold an English word for about half a second in definitions, examples and phrases across learning, review, spelling, chat, rooms, rank and the library to look it up." },
      { "tag": "improve", "zh": "选词后出现的查词条改成悬浮的圆角透明玻璃,和底部导航栏风格一致。", "en": "The bar that appears after selecting a word is now a floating, rounded, transparent glass pill that matches the bottom tab bar." },
      { "tag": "improve", "zh": "查词结果改成悬浮的圆角玻璃卡片,背后的页面隐约可见。", "en": "Lookup results now open in a floating, rounded glass card with the page faintly visible behind it." },
      { "tag": "fix", "zh": "学新词页长按英文释义和例句没有反应的问题已修复。", "en": "Fixed press-and-hold on English definitions and examples doing nothing on the learn-new-words page." }
    ]
  }
```
- [ ] Run `cd server && uv run pytest -q tests/test_changelog_import.py`. Remind the user to run `docker compose exec server python -m app.admin.changelog_import` after the next rebuild (rebuild only when the user asks), and to publish it in 更新日志.

---

## Self-check (implementers, before handing over)

1. `src/architecture.test.ts` passes untouched, and `CROSS_FEATURE_BASELINE` is unchanged. `lookup` imports only `~/lib/*` for the new code. Features and plugins import only `~/lib/lookup-context`.
2. The `__snapshots__/word-card-legacy.test.tsx.snap` file is unchanged (`git diff --stat` shows nothing for it).
3. No `preventDefault` on `pointerdown`, `touchstart` or `contextmenu` in `use-long-press-lookup.ts`. No `console.*` in new code. No i18n keys were added.
4. Every existing test in `src/features/lookup` is green: the Android latch, dictionary first, the 中文 chip, slots and practice.
5. The learn page's disabled option buttons and their `data-state` are unchanged, which the E2E selectors rely on.
6. The default `BottomSheetContent` class string is unchanged, so only the lookup drawer passes `glass`.
7. On library screens, `library-css.test.ts` and the library blur count are untouched.

## Device checklist (owner; all UNVERIFIED until ticked)

> jsdom can only prove the following: the event sequence leads to `selectWordAt` / `readNow`, cancellation works, the trailing click is swallowed, marks sit where expected, and the class names and CSS source are right. It **cannot** prove anything below. For each test run, note the build, device model, OS and browser version first. Never paste word lists or tokens.

**G-A Android Chrome tab (the owner's phone)**
- [ ] G-A1 On 学新词, press and hold a word in an English definition for about half a second. The word turns highlighted, and the glass bar appears above the tab bar within about 1 s. 查词 opens the glass drawer with that word.
- [ ] G-A2 Same for the example sentence, a phrase, the headword (after revealing the card) and the recap after a wrong answer.
- [ ] G-A3 Chat (AI reply, own message, voice transcript), library sentence, vocabulary card, room message and rank turn all work the same way. Tapping a library sentence still seeks, but after a long-press it does **not** seek (swallowed click).
- [ ] G-A4 The native handles still appear. Dragging them to a whole sentence switches the bar to 翻译, and the native Copy / Share copy the right text (R-L4).
- [ ] G-A5 Scrolling with a finger never selects a word, and a quick tap selects nothing.
- [ ] G-A6 Review option rows after answering: press and hold still selects the whole option word, with no double selection.
- [ ] G-A7 Hold-to-talk in chat still records. Inputs still show their own long-press menu (paste).
- [ ] G-A8 The bar's 查词 / 朗读 / ☆ still work on the first tap (the latch fix, R-L8).

**G-B Android installed PWA:** repeat G-A1, G-A4 and G-A8.

**G-C iOS Safari tab and home-screen PWA**
- [ ] G-C1 Repeat G-A1. Watch whether iOS's own 「拷贝 / 查询 / 翻译」 callout also shows, and whether it hides our bar or changes the selected range (R-L3 cost).
- [ ] G-C2 Drag-select a sentence and use Copy from the iOS callout.
- [ ] G-C3 No page zoom, link preview or loupe glitch on a long-press.

**G-D Desktop:** a mouse drag-select shows the bar, and pressing the mouse does nothing new (touch only).

**G-E Visuals (both themes, each variant if the owner wants)**
- [ ] G-E1 Glass bar over bright and dark posters (library), chat images and the wordbook DOCK: icons and labels are readable.
- [ ] G-E2 Glass drawer over the same backgrounds: definitions, phrases, the 中文 chip and buttons are readable, and the scrim is light enough to see the page.
- [ ] G-E3 Library screens: the bar and drawer are solid (no 4th blur layer). Scrolling stays smooth on a low-end Android (`html.lite`).
- [ ] G-E4 The drawer slide-in / out has no flicker or blank frame on the blurred card (R-G7).
- [ ] G-E5 iOS Settings → Accessibility → Reduce Transparency: the bar and drawer are solid with hairline borders. Drawer position on an iPhone with a home indicator: above the indicator, 8 px from the sides.

## UNVERIFIED (keep verbatim in the hand-over)

- Everything in the device checklist above, on iOS Safari (tab / PWA) and Android Chrome (tab / PWA).
- Whether jsdom 26 accepts the `MouseEvent` + `defineProperties` pointer stand-in in every runner, and whether `tailwind-merge` keeps the `bg-[color:var(--…)]` classes over the `Button` variants. Go by the first run.
- Main bundle size (`yarn web:build` not run; new code is about 150 lines in the eager lookup chunk) and E2E (not run).
- The mockup was checked only in the desktop Chromium browser pane (light / dark, variant B), not on a phone.

## Results table (fill after execution)

| Item | Result |
|---|---|
| T1–T3 foundation | (pending) |
| T4–T6 recogniser | (pending) |
| T7–T13 marks + guards | (pending) |
| Mockup approval / chosen variant | (pending, owner) |
| T14–T17 glass | (pending) |
| typecheck | (pending) |
| Device checklist G-A–G-E | **UNVERIFIED** (owner) |
