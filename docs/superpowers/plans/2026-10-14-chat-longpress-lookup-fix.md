# Chat long-press lookup on Android: diagnose-then-fix plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the chat conversation page (`/chat/:id`), long-pressing a word in a message on an Android browser (Chrome family, tab or installed PWA, exact browser unknown) must bring up the select-to-lookup bar (`data-testid="lookup-bar"`), and tapping 查词 must open the drawer. Today the owner reports "nothing happens". The same flow is reported to work on the review page, shadow sheet and library.

**Approach:** The root cause is **unknown**. This plan reproduces first (Task 1), writes down what the harness and the device showed (Task 2), and only then applies **one branch** of a decision tree (Task 3). If no hypothesis is confirmed, the implementer **stops and reports**. Do not guess.

**Architecture:** The fixes stay inside `web/src/features/lookup/` (bar, selection reader), `web/src/features/chat/` (bubble, conversation page), `web/src/components/markdown.tsx` and `web/src/lib/` (word selection helper, optional platform helper). No new import edges between features (the existing `chat->lookup` edge is not needed for any branch). No changes to `enjoy/` or `server/`.

**Tech Stack:** React 18, vitest + jsdom + Testing Library (unit and characterization tests), `@playwright/test` 1.51.0 with the already installed Chromium build (`chromium-1161`) for a local harness against mocked `/api` routes (no backend, no upstream, no cost), and desktop Chrome `chrome://inspect` remote debugging for the real Android device.

**Related:** `web/src/features/lookup/CLAUDE.md`, `web/src/features/chat/CLAUDE.md`, plan `2026-10-13-ios-keyboard-scroll.md` (it added the `html`/`body` lock in `web/src/index.css`), plan `2026-10-13-review-after-answer.md` (`~/lib/select-word`). Results go in `docs/superpowers/plans/2026-10-14-chat-longpress-lookup-fix-results.md` (skeleton shipped with this plan).

## Global Constraints

- **Diagnose before fixing.** Task 3 starts only after the results doc has a filled "Findings" section that names the confirmed hypothesis and the evidence (harness output and/or device log). With no confirmed hypothesis, **STOP and report** to the controller. Do not ship the fallback (branch G) "just in case" without a Ruling from the controller/owner.
- **No real stack, no money.** Do not use `web/e2e` or `yarn web:e2e` (real upstreams, costs money). The harness in Task 1b runs the Vite dev server on port 5179 and intercepts every `/api/**` request with `page.route`. Anything not mocked returns 404 and is listed as `unmocked`. The harness must never reach `:8000`.
- **Do not rebuild or restart containers. Do not deploy.** Device testing on the owner's phone uses whatever the owner already has deployed, plus the console probe (Task 1c). If a branch needs a device re-test after the fix, the controller asks the owner to deploy (`scripts/deploy.sh` runs only when the user asks).
- **Targeted tests only.** After each task run `cd web && yarn vitest run <that task's tests> src/architecture.test.ts`. Full `yarn web:typecheck && yarn web:test && yarn web:build` only when the user asks. `yarn web:typecheck` is fine to run once before the final commit.
- **`src/architecture.test.ts` stays as is.** `lib/` imports no feature. `lookup` does not import `chat`. `chat` gets new code from `~/lib/*` only. If a test needs a cross-feature import, move the test, not the rule.
- **Never edit `enjoy/`.**
- **Privacy:** the probe and harness log lengths, node names and flags only, never the selected text, message text, tokens or user ids. The harness uses a fake local token string (`"harness-token"`) for a fully mocked app. That is not a credential, and it must not be a real one.
- **Native selection must keep working.** Users must still be able to drag-select sentences, use the handles, and Copy/Share from the native toolbar. No branch may add `preventDefault` on `touchstart`, `pointerdown`, `contextmenu` or `selectstart` to message text, or `user-select: none` / `touch-action: none` on `[data-lookup-context]`.
- **Commits:** conventional style, one logical change per commit, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Task 1 (harness and characterization tests) is its own commit(s), so it can stay in the repo as a regression net.
- **Honest verification:** jsdom has no layout and no native selection UI. Desktop Chromium **cannot** produce Android long-press selection (measured, see "Investigation already done"). Anything about Chrome's native toolbar, Touch to Search, the IME or handles is **unverified** until the owner checks it on the phone. Write "UNVERIFIED on device" in the results doc and the PR description until the owner confirms.

---

## Current state (code read for this plan)

- **Selection pipeline:** `LookupLayer` (mounted once in `web/src/layout/app-shell.tsx:29`, a sibling of `<main>` inside the `relative` shell div at `:19`) calls `useTextSelection()` (`web/src/features/lookup/lookup-layer.tsx:108`). The hook listens to `document` `selectionchange` and re-reads the selection after it has been stable for 300 ms (`web/src/features/lookup/use-text-selection.ts:56-63`). `readSelection` returns null when the selection is collapsed or `rangeCount === 0` (`:38`), when the anchor or focus is outside `[data-lookup-context]`, or when they are in two different contexts (`:41-43`). The bar renders when `selection && suggested && !open` (`lookup-layer.tsx:233`).
- **The bar:** `web/src/features/lookup/lookup-bar.tsx:29-31`. It is `absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40`, positioned against the shell div, so about 72 px above the bottom of the app. `onPointerDown`/`onMouseDown` call `preventDefault` so a tap does not collapse the selection (`:11`, `:31`). 查词 opens on `onClick` (`:32`).
- **Chat bubble:** `web/src/features/chat/message-bubble.tsx:107` wraps only the message text in `<div data-lookup-context className="select-text">`. Inside it is one of: `VoiceTranscript` (`:109`, a `<p>` of `<span>`/`<mark>` pieces, `voice-transcript.tsx`), the user `<p>` (`:111`), or `MarkdownText` (`:113`, `react-markdown` output inside `div.prose`). The footer badges, `note`, `translation` and the action row (`BubbleActions`, buttons with visible text 朗读/翻译/跟读) are siblings **outside** the context (`:117-120`, `:37`). They are selectable text with no `select-none`. The bubble `div` (`:64-68`) has `px-3 pt-2.5` padding outside the context too.
- **Markdown:** `web/src/components/markdown.tsx:16` passes `components={{ a: ... }}` as a new object with a new arrow component **on every render**. React therefore unmounts and remounts every `<a>` in every assistant bubble whenever `ConversationPage` re-renders. `MessageBubble` is not memoized, and `ConversationPage` (1416 lines) re-renders on many state changes (TTS states, voice timer, translations, hints, input typing).
- **Chat page layout:** the message list is its own scroller (`conversation-page.tsx:1225-1227`, `overflow-y-auto overscroll-contain`, no pointer or touch handlers). The composer is `absolute inset-x-0 bottom-0 z-30` with `.glass` (backdrop-filter) (`:1279`). Neither `<main>` (`app-shell.tsx:21-24`) nor the page root (`relative`, no z-index) creates a stacking context, so by code the bar (`z-40`) sits above the composer (`z-30`). The composer defaults to **text mode** (`composer-mode.ts:9`) with a `Textarea` (`conversation-page.tsx:1367`). An effect focuses it programmatically on some flows (`:1054-1061`).
- **Viewport:** `index.html:5` has `interactive-widget=resizes-content` (Android Chrome resizes the layout viewport when the keyboard opens or closes). `web/src/index.css:15-22` locks `html, body { position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none }`. `useAppHeight` writes `--app-height` on every `visualViewport` resize and schedules `scrollTo(0,0)` on resize/scroll/focusin/focusout (`web/src/layout/use-app-height.ts:26-29`, `:35`, `:44`). The lock applies to every page, so on its own it cannot explain a chat-only failure.
- **No global blockers found:** `contextmenu` is prevented, and `select-none`/`touch-action: none` are set, only on the hold-to-talk and call-dock buttons themselves (`web/src/components/hold-to-talk-bar.tsx:128-135`, `web/src/features/realtime/call-dock.tsx:174-175`). These are not ancestors of the message list. There are no `aria-hidden`, transform/animation or virtualization wrappers around the bubbles (the `aria-hidden` spacer at `:1228` is a sibling).
- **Where it "works":** every surface the owner named has a **tap-to-select** path that calls `selectWord` (programmatic selection):
  - library: `features/library/shadow-panel.tsx:60`
  - shadow sheet result words: `features/practice/shadow/shadow-result.tsx:99`
  - wordbook review options (double-tap): `features/wordbook/choice-question.tsx:78`, via `~/lib/select-word`

  Chat bubbles have **only** the native long-press path. Native-only surfaces that exist elsewhere include the shadow sheet reference sentence (`shadow-sheet.tsx:262`), the vocabulary review card (`features/vocabulary/review-card.tsx:34,43`), the assessment reference, the hints sheet and the recap sheet. Nobody has reported testing these on Android.
- **Tests:** `lookup-layer.test.tsx:28-40` and `use-text-selection.test.ts:97-121` only install selections programmatically and dispatch `selectionchange` by hand. No test covers the chat page with `LookupLayer` mounted, a re-render while a selection stands, a selection that spills out of the context, or the bar's position on the chat page. `web/e2e/lookup.spec.ts` also selects programmatically.

## Investigation already done (while writing this plan)

- Installed: `@playwright/test` **1.51.0** (`web/package.json`), browsers in `%LOCALAPPDATA%\ms-playwright`: `chromium-1161`, `chromium_headless_shell-1161`, `chromium-1234`, `webkit-2140`, `ffmpeg`. Not installed: `adb` / Android SDK platform-tools, an Android emulator, any real-device farm. Desktop Chrome's `chrome://inspect` can still talk to a USB phone without a separate adb install.
- Throwaway probe (scratchpad, not committed): Pixel 7 emulation, `chromium-1161`, a page with `html,body{position:fixed}` and a `[data-lookup-context]` paragraph.
  - `Input.synthesizeTapGesture` with `duration: 800` produced only `pointerdown`/`touchstart`, **no `contextmenu`, no selection**.
  - A raw `Input.dispatchTouchEvent` hold of 800 ms produced one collapsed `selectionchange`, and no word selection.
  - A mouse double-click selected the word.
  - The new headless (`channel: "chromium"`) gave the same result. Headed mode crashed in this environment.
  - **Conclusion:** no Playwright/CDP path reproduces Android's native long-press selection, its floating toolbar, Touch to Search or IME behaviour. The harness can only (a) verify our code path with an injected selection that mimics Android's event sequence, and (b) measure the layout (is the bar on top, inside the viewport). The native half needs the phone (Task 1c).

## Root-cause hypotheses (ranked; none reproduced yet)

1. **H1: The problem is not chat-specific. The Android native long-press path never yields a usable bar, and the surfaces that "work" use tap-to-select.**
   - **Evidence:** the three working surfaces all call `selectWord` on tap (file:line above). Chat is native-only (`message-bubble.tsx:107`). Every test uses programmatic selection.
   - **Sub-mechanisms** (the device log decides):
     - **H1a: the bar renders but is covered by browser UI at the bottom of the screen.** Candidates are Chrome's "Touch to Search"/long-press search panel, which docks at the bottom of a tab and does not appear in an installed PWA, or the native selection toolbar when the selection is low. The bar sits 72 px from the bottom (`lookup-bar.tsx:30`). Programmatic selection never opens these panels, which fits "tap works, long-press doesn't".
     - **H1b: the bar renders and is visible, but the first tap on it does not reach `onClick`** while the native selection UI is up (Chrome may use the tap to dismiss its toolbar, or send `pointercancel`). The selection then collapses, and the bar goes away 300 ms later: "nothing happens".
     - **H1c: no non-collapsed selection inside a context ever reaches the hook** (see H6).
   - **Confirm:** the owner long-presses a word on a native-only surface outside chat (shadow sheet reference sentence, vocabulary review card) and it fails the same way. The device log (Task 1c) shows `bar` with `onTop: true` and the screenshot shows it covered (H1a), or shows `pointerdown` on `lookup-trigger` without a `click` (H1b).
   - **Refute:** native-only surfaces outside chat work on the same phone.
2. **H2: Keyboard and focus interplay specific to chat.**
   - **Mechanism:** the composer defaults to text mode (`composer-mode.ts:9`). With the textarea focused, the long-press moves focus away, the soft keyboard closes, and `resizes-content` (`index.html:5`) resizes the layout viewport. `useAppHeight` rewrites `--app-height` and schedules `scrollTo(0,0)` (`use-app-height.ts:26-49`), and the whole shell re-lays out. Chrome Android may drop the selection or its handles during that resize. The bar may also render and then be re-placed. Chat is the only reported surface with a persistent text input next to the selectable text.
   - **Confirm:** it fails with the keyboard open but works with the keyboard closed or in voice mode. The device log shows `focusout` → `vv resize` → `selectionchange` collapsed.
   - **Refute:** it fails the same way with the keyboard closed.
3. **H4: `readSelection` rejects the selection shape Android produces in a bubble.**
   - **Mechanism:** the anchor or focus lands outside `[data-lookup-context]`: in the action row (selectable labels 朗读/翻译/跟读, `message-bubble.tsx:117-120`), in the bubble padding (`:64`), or across two bubbles or paragraphs when Smart Text Selection expands to an entity. `use-text-selection.ts:41-43` then returns null, and nothing renders.
   - **Confirm:** the device log shows `collapsed: false, len > 0` with `sameCtx: false` or `anchorCtx: false` after the long-press. The harness "spill" scenario shows no bar.
   - **Refute:** the log shows `sameCtx: true` and the bar mounts.
4. **H3: A re-render replaces the selected DOM nodes and the selection collapses.**
   - **Mechanism:** `markdown.tsx:16` remounts every `<a>` on each `ConversationPage` render. A selection inside link text is dropped on the next render (voice timer, TTS state, streaming of another bubble). A streaming bubble re-renders its text continuously.
   - **Confirm:** the characterization test shows the selected text node `isConnected === false` after a re-render. The device log shows `selectionchange` collapsed with no touch input in between.
   - **Refute:** the owner's word was not in a link and no reply was streaming.
   - **Why ranked low:** it only explains failures on link text or a streaming reply.
5. **H5: The bar is hidden by page elements or placed off-screen on the chat page.**
   - **Mechanism:** a stacking-context or overflow quirk puts the bar under the `.glass` composer or outside the visible area after an `--app-height` change.
   - **Why ranked lowest:** code says `z-40` beats `z-30` in the same root stacking context.
   - **Confirm:** harness `elementFromPoint(bar centre)` is not the bar, or the bar's rect lies outside `visualViewport`. The device log shows `onTop: false`.
   - **Refute:** the harness reports `onTop: true` and in-viewport for every scenario.
- **H6 (no code evidence, listed for completeness):** Android does not create any document selection on long-press in the message list (long-press consumed as a scroll or context-menu gesture). Only the device log can show it: no non-collapsed `selectionchange` at all after the long-press. This is the case branch G exists for.

## Rulings

> Each ruling ends with its cost if it turns out wrong.

- **R-LP1: Reproduction first, and a hypothesis counts as confirmed only with evidence.** A branch may be applied only when the results doc quotes harness output or a device log line that matches the branch's "confirm" condition. Owner answers from Task 0 alone can confirm H2 (keyboard-only) or refute H1 (other native surfaces work). They cannot confirm H1a or H1b without the log or a screenshot. Cost: one extra round trip with the owner.
- **R-LP2: Several branches can be confirmed together, and the implementer applies all of them, smallest first.** Order is D → E → C → F → A → B → G. A later branch is skipped if the device re-test after an earlier one already passes. Cost: more commits, each small and revertible.
- **R-LP3: Branch G (deliberate long-press) is a fill-in, never an override.** The hook acts only for `pointerType === "touch"`, only after 450 ms without moving more than 8 px, and only when the document selection is **still collapsed** at that moment. If the browser produced its own selection, the hook does nothing. It never calls `preventDefault`, never changes `touch-action` or `user-select`, and never touches a selection the user is dragging. Mouse and pen are ignored (desktop users drag or double-click). A `pointercancel` with no prior move of more than 8 px does **not** cancel the timer, because Android sends `pointercancel` when it takes over a long-press. A change in the list's `scrollTop` at fire time does cancel it (that was a scroll). Native drag-select, handles and Copy/Share keep working because the hook only fills an empty selection, and the bar reads whatever the final selection is after the 300 ms debounce. Cost: on iOS the programmatic word selection may appear about 50 ms before iOS's own long-press selection of the same word, which then replaces it. If the iOS regression check shows a double callout or a loupe glitch, gate the hook to Android with `isAndroid()` (branch A's helper) in a follow-up commit.
- **R-LP4: Android-only layout changes use a user-agent check (`/Android/i`).** This is pragmatic and documented, and iOS stays exactly as today. Cost: Android browsers that hide "Android" in their UA keep the old placement.
- **R-LP5: The harness and characterization tests stay in the repo.** They are cheap, offline, and pin the chat → lookup wiring that had no test. The harness is not part of `yarn web:test` (`*.harness.ts` under `web/scripts/lookup-harness/`, its own config). Cost: one more Playwright config to keep CommonJS (`.cts`, like `web/playwright.config.cts`).

---

## File structure

```
web/src/features/chat/chat-lookup.test.tsx                       T1a: new (characterization: chat page + LookupLayer)
web/scripts/lookup-harness/playwright.config.cts                  T1b: new (Pixel 7, dev server :5179, mocked /api)
web/scripts/lookup-harness/chat-longpress.harness.ts              T1b: new
docs/superpowers/plans/2026-10-14-chat-longpress-lookup-fix-results.md   T1/T2: fill (skeleton exists)
-- Task 3: only the confirmed branch(es) --
web/src/components/markdown.tsx (+ markdown.test.tsx)             D
web/src/features/lookup/use-text-selection.ts (+ test), web/src/features/chat/message-bubble.tsx   E
web/src/features/chat/conversation-page.tsx (+ chat-lookup.test.tsx)          C
web/src/features/lookup/lookup-bar.tsx (+ lookup-bar.test.tsx)              F, A, B
web/src/lib/platform.ts (+ platform.test.ts)                                  A
web/src/lib/select-word.ts (+ select-word.test.ts), web/src/lib/use-long-press-word.ts (+ test)   G
web/src/features/lookup/CLAUDE.md, web/src/features/chat/CLAUDE.md, web/README.md   T4
docs/changelog/2026-10.json                                                  T5 (controller only)
```

**Order:** T0 (owner, async, in parallel with T1) → T1 → T2 (gate) → T3 (branches) → T4 → T5.

---

## Task T0: Owner triage (no code; the controller asks, in parallel with T1)

The controller sends the owner these questions and records the answers in the results doc, section "Owner triage". All of them can be answered by trying things on the phone:

1. Which browser and which mode: Chrome tab, another Chromium browser (Edge, Samsung Internet, a WeChat in-app browser...), or the installed app from the home screen?
2. After long-pressing a word in chat:
   - (a) Is the word highlighted with blue handles?
   - (b) Does the native menu (Copy / Share / Select all) appear?
   - (c) Does **our** bar (查词 · 朗读 · ☆) appear anywhere, even partly?
   - (d) Does a Google search panel slide up from the bottom?
3. If our bar appears, what happens when you tap 查词?
4. Does it make a difference if the keyboard is open (text box focused) or closed? What about voice mode (the 按住说话 bar)?
5. Which message kind did you try: the AI's reply, your own typed message, your voice message's transcript? Was the word inside a link?
6. **Control:** long-press a word in the shadow sheet's **sentence at the top** (not the coloured result words), or on a vocabulary review card's example sentence. Does the bar appear and does 查词 work?

- [ ] Answers recorded (verbatim, no screenshots containing personal data).

---

## Task T1: Reproduction harness

### T1a: Characterization tests in vitest + jsdom

**Files:** Create `web/src/features/chat/chat-lookup.test.tsx`.

These tests document current behaviour. Some assertions are **expected to describe the bug condition**; they are marked `// characterization`. Do not "fix" the assertions. Record their outcome in the results doc. The setup mirrors `conversation-page.test.tsx` (`routes`, `setup`, `WithShadowSheet`, `renderWithProviders`). Copy those helpers rather than exporting them from the existing test file.

- [ ] **Step 1: Write the test file.**

```tsx
import "fake-indexeddb/auto";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { LookupLayer } from "~/features/lookup";
import { ConversationPage } from "./conversation-page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };
const ASSISTANT = "First paragraph about travel.\n\nSecond paragraph with a [helpful link](https://example.com) inside.";

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: CONFIG }),
    "GET /api/conversations/c1/messages": () => json({ messages: [
      { id: "m0", conversation_id: "c1", role: "assistant", content: ASSISTANT },
      { id: "m1", conversation_id: "c1", role: "user", content: "I like coffee" },
      { id: "m2", conversation_id: "c1", role: "user", content: "Nice to meet you", assessment_id: "a1",
        assessment: { scores: { pronunciationScore: 80, accuracyScore: 80, fluencyScore: 80, completenessScore: 90 }, words: [{ word: "meet", accuracyScore: 40, errorType: "Mispronunciation" }] } },
    ] }),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    "POST /api/dictionary/lookup": () => json({ found: false }),
    ...extra,
  };
}

function setup() {
  const mock = createFetchMock(routes());
  renderWithProviders(
    <WithShadowSheet><ConversationPage /><LookupLayer /></WithShadowSheet>,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "/chat/:id" },
  );
  return mock;
}

/** Select `needle` inside the first text node under `root` that contains it (the way Android's long-press would). */
function selectWordIn(root: Element, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = n.textContent!.indexOf(needle);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(n, at);
    range.setEnd(n, at + needle.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return n as Text;
  }
  throw new Error(`"${needle}" not found`);
}

const bubbles = (id: "message-assistant" | "message-user") => screen.getAllByTestId(id);

describe("chat → select-to-lookup wiring (characterization, plan 2026-10-14-chat-longpress-lookup-fix)", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); resetServerAiConfigCache(); localStorage.clear(); });
  afterEach(() => { window.getSelection()?.removeAllRanges(); });

  it.each([
    ["assistant markdown reply", () => bubbles("message-assistant")[0], "travel"],
    ["own typed message", () => bubbles("message-user")[0], "coffee"],
    ["voice transcript (word spans)", () => bubbles("message-user")[1], "Nice"],
  ])("shows the bar for a word selected in the %s", async (_name, bubble, word) => {
    setup();
    await screen.findByText(/First paragraph/);
    await act(async () => { selectWordIn(bubble(), word); });
    expect(await screen.findByTestId("lookup-bar", {}, { timeout: 2000 })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("lookup-trigger"));
    expect(await screen.findByTestId("lookup-drawer")).toBeInTheDocument();
  });

  it("H4: a selection that spills from the text into the action row yields no bar (characterization)", async () => {
    setup();
    await screen.findByText(/First paragraph/);
    const bubble = bubbles("message-assistant")[0];
    const start = [...bubble.querySelectorAll("[data-lookup-context] p")][0].firstChild!;
    const action = bubble.querySelector('[data-testid="message-tts"]')!;
    const end = document.createTreeWalker(action, NodeFilter.SHOW_TEXT).nextNode()!;
    await act(async () => {
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, 1);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(screen.queryByTestId("lookup-bar")).toBeNull(); // characterization: today this is rejected
  });

  it("H3: a page re-render keeps the selected text node of plain text, and the link text node (characterization)", async () => {
    setup();
    await screen.findByText(/First paragraph/);
    const bubble = bubbles("message-assistant")[0];
    const plain = selectWordIn(bubble, "travel");
    const link = bubble.querySelector("a")!.firstChild!;
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "x" } }); // re-renders ConversationPage without moving focus
    await waitFor(() => expect(screen.getByTestId("chat-input")).toHaveValue("x"));
    expect(plain.isConnected).toBe(true);
    // characterization: record the actual value in the results doc (expected false today: markdown.tsx:16 remounts <a>)
    console.info("[H3] link text node still connected after re-render:", link.isConnected);
  });
});
```

- [ ] **Step 2: Run.** `cd web && yarn vitest run src/features/chat/chat-lookup.test.tsx src/architecture.test.ts`. If the routes miss a request the page makes, `createFetchMock` reports it: add the route, never loosen the mock. Copy the three `it.each` results, the H4 outcome and the `[H3]` line into the results doc ("Harness → vitest").
  - Expected: the three wiring cases **pass**. jsdom has no native UI, so a pass here shows the chat → lookup code path is wired, which points the investigation at the native and layout side (H1/H2).
  - If a wiring case fails in jsdom, that is a direct reproduction. Record it, and the matching branch (E for the context, C for focus) is confirmed by this alone.
- [ ] **Step 3: Commit.** `test(web): characterize select-to-lookup on the chat page`.

### T1b: Playwright device-emulation harness (Chromium 1161, Pixel 7, mocked API)

**Files:** Create `web/scripts/lookup-harness/playwright.config.cts` and `web/scripts/lookup-harness/chat-longpress.harness.ts`.

**What it can and cannot show.** Chromium cannot perform Android's native long-press selection (see "Investigation already done"). The harness therefore sends the **Android event sequence** (`touchstart` via CDP, a 600 ms hold, a `contextmenu` at the point, then the word selection Android would make, then three `selectionchange` "handle settle" events 100 ms apart, then `touchend`). It records:
- whether our code shows the bar (H4, H3)
- whether the bar is on top and inside the visual viewport (H5)
- whether a viewport shrink/restore (keyboard emulation under `resizes-content`) with the textarea focused loses the selection or the bar in **our** code (the app-side half of H2)
- whether a CDP touch tap on the bar opens the drawer (the app-side half of H1b)

It cannot show Chrome's own toolbar, Touch to Search or IME behaviour.

- [ ] **Step 1: Config** (CommonJS like `web/playwright.config.cts`):

```ts
import { defineConfig, devices } from "@playwright/test";

/** Offline harness (plan 2026-10-14-chat-longpress-lookup-fix): dev server on :5179, every /api request mocked in the test. */
export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.harness\.ts$/,
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../test-results/lookup-harness",
  use: { ...devices["Pixel 7"], baseURL: "http://localhost:5179", serviceWorkers: "block", trace: "retain-on-failure" },
  webServer: {
    command: "yarn dev --port 5179 --strictPort",
    cwd: `${__dirname}/../..`,
    url: "http://localhost:5179",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Harness spec.** Register a catch-all `**/api/**` route first (404 JSON, push the path to `unmocked`), then the specific routes. Playwright gives later routes precedence. The specific routes are the same messages and config as T1a, plus whatever app-boot calls show up in `unmocked` on the first run (announcements, feature flags, settings). Add them until `unmocked` is empty, and assert it is empty at the end.

```ts
import { expect, test, type Page } from "@playwright/test";

const AUTH_KEY = "enjoy-web.auth"; // web/src/api/auth-storage.ts
type Row = Record<string, unknown>;
const rows: Row[] = [];

async function mockApi(page: Page, unmocked: string[]) {
  await page.route("**/api/**", (route) => { unmocked.push(new URL(route.request().url()).pathname); return route.fulfill({ status: 404, json: { detail: "harness: not mocked" } }); });
  const j = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };
  const MESSAGES = { messages: [
    { id: "m0", conversation_id: "c1", role: "assistant", content: "First paragraph about travel.\n\nSecond paragraph with a [helpful link](https://example.com) inside." },
    { id: "m1", conversation_id: "c1", role: "user", content: "I like coffee" },
    { id: "m2", conversation_id: "c1", role: "user", content: "Nice to meet you", assessment_id: "a1",
      assessment: { scores: { pronunciationScore: 80, accuracyScore: 80, fluencyScore: 80, completenessScore: 90 }, words: [{ word: "meet", accuracyScore: 40, errorType: "Mispronunciation" }] } },
  ] };
  const fixed: Record<string, unknown> = {
    "GET /api/config/gpt_providers": { enjoyai: { models: ["gpt-4o"] } },
    "GET /api/config/default_gpt_preset": { configuration: { model: "gpt-4o" } },
    "GET /api/config/tts_providers_v2": { enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } },
    "GET /api/config/default_tts_preset": { configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } },
    "GET /api/conversations/c1": { id: "c1", name: "Trip", config: CONFIG },
    "GET /api/conversations/c1/messages": MESSAGES,
    "GET /api/realtime/config": { enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 },
    "POST /api/dictionary/lookup": { found: false },
    // + app-boot routes discovered from `unmocked` on the first run
  };
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    return key in fixed ? route.fulfill(j(fixed[key])) : route.fallback();
  });
}

/** Probe: counts and flags only, never text (Global Constraints, privacy). */
async function installProbe(page: Page) {
  await page.addInitScript(([key]) => {
    localStorage.setItem(key, JSON.stringify({ token: "harness-token", user: { id: "u1", name: "harness" } }));
    const w = window as unknown as { __lk: unknown[] };
    w.__lk = [];
    const ctx = (n: Node | null) => (n && (n.nodeType === 1 ? (n as Element) : n.parentElement))?.closest("[data-lookup-context]") ?? null;
    document.addEventListener("selectionchange", () => {
      const s = getSelection()!;
      w.__lk.push({ ev: "selectionchange", t: Math.round(performance.now()), collapsed: s.isCollapsed, ranges: s.rangeCount, len: String(s).length, anchorCtx: !!ctx(s.anchorNode), sameCtx: ctx(s.anchorNode) === ctx(s.focusNode) });
    });
    for (const type of ["pointerdown", "pointerup", "pointercancel", "contextmenu", "click", "focusin", "focusout"]) {
      document.addEventListener(type, (e) => w.__lk.push({ ev: type, t: Math.round(performance.now()), target: (e.target as HTMLElement)?.dataset?.testid ?? (e.target as Element)?.nodeName }), true);
    }
  }, [AUTH_KEY]);
}

/** Android-like long-press on `word` inside `bubble`: touch hold, contextmenu, word selection, handle-settle bursts, release. */
async function androidLongPress(page: Page, bubbleSelector: string, word: string) {
  const point = await page.evaluate(([sel, w]) => {
    const root = document.querySelector(sel)!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(w);
      if (at < 0) continue;
      const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + w.length);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    throw new Error("word not found");
  }, [bubbleSelector, word] as const);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(600);
  await page.evaluate(([p, w, sel]) => {
    const target = document.elementFromPoint(p.x, p.y)!;
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
    const root = document.querySelector(sel)!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(w);
      if (at < 0) continue;
      const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + w.length);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      break;
    }
  }, [point, word, bubbleSelector] as const);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => document.dispatchEvent(new Event("selectionchange"))); await page.waitForTimeout(100); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

async function barState(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('[data-testid="lookup-bar"]');
    if (!bar) return { bar: false };
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const vv = window.visualViewport!;
    return { bar: true, onTop: !!hit?.closest('[data-testid="lookup-bar"]'), inViewport: r.top >= 0 && r.bottom <= vv.height, top: Math.round(r.top), bottom: Math.round(r.bottom), vvh: Math.round(vv.height), selCollapsed: getSelection()!.isCollapsed };
  });
}

async function tapBar(page: Page) {
  const box = await page.getByTestId("lookup-trigger").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const p = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  return page.getByTestId("lookup-drawer").isVisible({ timeout: 2000 }).catch(() => false);
}

const CASES = [
  { name: "assistant", sel: '[data-testid="message-assistant"]', word: "travel" },
  { name: "assistant-link", sel: '[data-testid="message-assistant"]', word: "helpful" },
  { name: "user-text", sel: '[data-testid="message-user"]:nth-of-type(1)', word: "coffee" },
  { name: "voice-transcript", sel: '[data-testid="message-user"][data-voice]', word: "Nice" },
];

for (const keyboard of [false, true]) {
  for (const c of CASES) {
    test(`${c.name} keyboard=${keyboard}`, async ({ page }) => {
      const unmocked: string[] = [];
      await installProbe(page);
      await mockApi(page, unmocked);
      await page.goto("/chat/c1");
      await expect(page.getByText(/First paragraph/)).toBeVisible();
      const size = page.viewportSize()!;
      if (keyboard) {
        await page.getByTestId("chat-input").focus();
        await page.setViewportSize({ width: size.width, height: size.height - 300 }); // keyboard opens (resizes-content)
      }
      await androidLongPress(page, c.sel, c.word);
      if (keyboard) {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // Android moves focus off the textarea
        await page.setViewportSize(size); // keyboard closes
      }
      await page.waitForTimeout(500);
      const state = await barState(page);
      const opened = state.bar ? await tapBar(page) : false;
      const log = await page.evaluate(() => (window as unknown as { __lk: unknown[] }).__lk);
      rows.push({ case: c.name, keyboard, ...state, drawerOpened: opened, unmocked: [...new Set(unmocked)], events: log.length });
      console.log(JSON.stringify(rows.at(-1)));
      expect(unmocked, "every /api call must be mocked").toEqual([]);
    });
  }
}
```

  **Spill scenario (H4):** add one more test. It performs the long-press on `travel`, then extends the selection's focus into `[data-testid="message-tts"]` before the settle bursts: `s.extend(actionTextNode, 1)`. Record `bar`.

- [ ] **Step 3: Run.** `cd web && yarn playwright test -c scripts/lookup-harness/playwright.config.cts`. On the first run, fix the route list until `unmocked` is empty. Selectors such as `:nth-of-type` may need adjusting to the real DOM: use `page.getByTestId(...).nth(i)` if needed. Record the JSON lines in the results doc ("Harness → Playwright").
  - Reading:
    - `bar:false` for a normal word means our code rejects it (H4/H3 by case).
    - `onTop:false` or `inViewport:false` means H5.
    - A bar that is lost only when `keyboard=true` means the app-side half of H2.
    - `drawerOpened:false` while the bar is on top means the app-side half of H1b. Check whether the probe log has `pointerdown` on `lookup-trigger` and a `click`.
- [ ] **Step 4: Commit.** `test(web): offline long-press lookup harness for the chat page`.

### T1c: Real Android device probe (owner + controller; read-only)

The only way to see the native half (H1a/H1b/H2-native/H6).

- [ ] **Step 1:** The owner enables USB debugging on the phone, connects it to the desktop and opens `chrome://inspect/#devices` in desktop Chrome. Desktop Chrome talks to the phone without a separate adb install. The owner opens the deployed app in **Chrome on the phone** (for the installed PWA, the WebAPK also appears under chrome://inspect), navigates to a conversation and clicks **inspect**.
- [ ] **Step 2:** Paste this probe into the DevTools console. It logs flags and lengths only, never text:

```js
(() => {
  const t0 = performance.now();
  const log = (...a) => console.log(`[lk +${Math.round(performance.now() - t0)}ms]`, ...a);
  const ctx = (n) => (n && (n.nodeType === 1 ? n : n.parentElement))?.closest("[data-lookup-context]") ?? null;
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    log("selectionchange", { collapsed: s.isCollapsed, ranges: s.rangeCount, len: String(s).length, anchorCtx: !!ctx(s.anchorNode), sameCtx: ctx(s.anchorNode) === ctx(s.focusNode), anchor: s.anchorNode?.nodeName, focus: s.focusNode?.nodeName });
  });
  for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "touchcancel", "contextmenu", "click", "focusin", "focusout"]) {
    document.addEventListener(type, (e) => log(type, e.target?.dataset?.testid ?? e.target?.nodeName, e.pointerType ?? "", e.defaultPrevented), true);
  }
  visualViewport?.addEventListener("resize", () => log("vv resize", Math.round(visualViewport.height)));
  let had = false;
  new MutationObserver(() => {
    const bar = document.querySelector('[data-testid="lookup-bar"]');
    if (!!bar === had) return;
    had = !!bar;
    if (!bar) return log("bar gone");
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    log("bar shown", { top: Math.round(r.top), bottom: Math.round(r.bottom), vvh: Math.round(visualViewport?.height ?? innerHeight), onTop: !!hit?.closest('[data-testid="lookup-bar"]') });
  }).observe(document.body, { childList: true, subtree: true });
  log("probe installed");
})();
```

- [ ] **Step 3:** For each row, the owner long-presses one word, waits 1 s, takes a phone screenshot (crop out personal content), taps 查词 if the bar is visible, then copies the console lines:
  - assistant reply, keyboard closed
  - assistant reply, keyboard open
  - own text message, keyboard closed
  - voice transcript, keyboard closed
  - control: shadow sheet reference sentence
  - control: vocabulary review card example
  - optionally the same assistant row in the installed PWA
- [ ] **Step 4:** Paste the lines (they contain no text) and the observations into the results doc ("Device log").

If USB debugging is impossible for the owner, record that, rely on T0 answers plus screenshots, and say in T2 which hypotheses stay unconfirmable.

---

## Task T2: Findings and branch choice (gate)

- [ ] **Step 1:** Fill the "Findings" table in the results doc: one row per hypothesis H1a, H1b, H2, H3, H4, H5, H6, each with **confirmed / refuted / unknown** and the quoted evidence line(s). The decision rules:
  - **H1a confirmed:** device log `bar shown {onTop: true}`, and the screenshot shows browser UI over the bar's position, or no bar is visible although `bar shown` was logged.
  - **H1b confirmed:** `bar shown`, then on tapping `pointerdown lookup-trigger` with no `click`, or no event at all on the bar, and the drawer does not open (harness `drawerOpened: true` rules out our code).
  - **H2 confirmed:** fails only with the keyboard open, and the log shows `focusout` / `vv resize` followed by `selectionchange {collapsed: true}` before or right after `bar shown`. Also confirmed if the harness shows the bar lost only for `keyboard=true`.
  - **H3 confirmed:** `[H3] ... false` in T1a **and** the owner's failing word was in a link or a streaming reply, or the device log shows a collapse with no input event in between.
  - **H4 confirmed:** device `selectionchange {collapsed: false, len > 0}` with `sameCtx: false` or `anchorCtx: false` after the long-press, or a T1a/T1b wiring case failing.
  - **H5 confirmed:** harness or device `onTop: false` / outside `vvh`.
  - **H6 confirmed:** after the long-press the log has **no** `selectionchange` with `collapsed: false`.
- [ ] **Step 2: Gate.** If no row is confirmed: **STOP**. Report to the controller with the table and what is missing (usually the device log). Do not apply any branch, branch G included.
- [ ] **Step 3:** Name the branch(es) to apply in the results doc ("Decision"), in R-LP2 order. Commit the results doc: `docs: findings for the chat long-press lookup bug`.

---

## Task T3: Fix, as a decision tree (apply only confirmed branches)

Each branch: failing test first, the minimal change, run `cd web && yarn vitest run <tests> src/architecture.test.ts`, commit. After all chosen branches: `yarn web:typecheck`.

### Branch D (H3 confirmed): stable markdown components

**Files:** `web/src/components/markdown.tsx`, `web/src/components/markdown.test.tsx`.

- [ ] **Test** (append to `markdown.test.tsx`):

```tsx
it("keeps link DOM nodes across re-renders (a selection inside a link survives)", () => {
  const { container, rerender } = render(<MarkdownText content="see [the link](https://example.com) here" />);
  const text = container.querySelector("a")!.firstChild!;
  rerender(<MarkdownText content="see [the link](https://example.com) here" />);
  expect(text.isConnected).toBe(true);
});
```

- [ ] **Fix:** hoist the components object to module scope:

```tsx
import type { Components } from "react-markdown";

const COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};
// ...
<Markdown remarkPlugins={REMARK} disallowedElements={DISALLOWED} components={COMPONENTS}>{content}</Markdown>
```

  Hoist `const REMARK = [remarkGfm]` and `const DISALLOWED = ["img"]` the same way. Keep the existing assertions in `markdown.test.tsx` passing (no images, safe links).
- [ ] **If the device showed collapses in a *streaming* bubble:** that is expected behaviour while text is appended. Record it, do not fix it here, and note it in `features/lookup/CLAUDE.md` Pitfalls ("selection inside a reply that is still streaming is lost on the next delta").
- [ ] **Commit:** `fix(web): keep markdown link nodes stable so a selection inside a link survives re-renders`.

### Branch E (H4 confirmed): accept Android-shaped selections in a bubble

**Files:** `web/src/features/lookup/use-text-selection.ts` (+ `.test.ts`), `web/src/features/chat/message-bubble.tsx`.

- [ ] **Test** (append to `readSelection` describe):

```ts
it("clamps a selection with one end outside any context to the context of the other end", () => {
  document.body.innerHTML = `<div id="bubble"><div data-lookup-context id="ctx"><p>Hello wonderful world</p></div><div id="actions"><button>Listen</button></div></div>`;
  const text = document.querySelector("#ctx p")!.firstChild!;
  const label = document.querySelector("#actions button")!.firstChild!;
  expect(readSelection(select(text, 6, label, 3))).toEqual({ text: "wonderful world", context: "Hello wonderful world" });
});
it("still rejects selections spanning two different contexts", () => {
  setup();
  const a = document.getElementById("a")!.firstChild!;
  const b = document.getElementById("b")!.firstChild!;
  expect(readSelection(select(a, 0, b, 3))).toBeNull();
});
```

- [ ] **Fix `readSelection`:**

```ts
export function readSelection(selection: Selection | null): TextSelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const anchor = elementOf(selection.anchorNode)?.closest(LOOKUP_CONTEXT_SELECTOR) ?? null;
  const focus = elementOf(selection.focusNode)?.closest(LOOKUP_CONTEXT_SELECTOR) ?? null;
  const ctx = anchor ?? focus;
  if (!ctx || (anchor && focus && anchor !== focus)) return null;
  if (elementOf(selection.anchorNode)?.closest(EDITABLE_SELECTOR) || elementOf(selection.focusNode)?.closest(EDITABLE_SELECTOR)) return null;
  // Android may let one end land just outside the text (action row, bubble padding): clamp to the context.
  const range = selection.getRangeAt(0).cloneRange();
  if (!ctx.contains(range.startContainer)) range.setStart(ctx, 0);
  if (!ctx.contains(range.endContainer)) range.setEnd(ctx, ctx.childNodes.length);
  const text = normalizeSelection(range.toString());
  if (!text) return null;
  const raw = ctx.textContent ?? "";
  const before = document.createRange();
  before.selectNodeContents(ctx);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { text: text.slice(0, MAX_TEXT), context: boundContext(raw, start, start + text.length) };
}
```

  Check: the existing "outside" case (`#c`, no context at either end) still returns null, and so does the cross-context case. Keep `boundContext` unchanged.
- [ ] **Bubble:** add `select-none` to the `BubbleActions` container (`message-bubble.tsx:37`) and to the retry button. Do **not** add it to the footer badges, `note` or `translation`; the translation is text users may want to copy. Test in `chat-lookup.test.tsx`: `expect(bubble.querySelector('[data-testid="message-tts"]')!.parentElement!.className).toMatch(/\bselect-none\b/)`. Flip the H4 characterization test to expect a bar.
- [ ] **Commit:** `fix(web): look up a word even when the Android selection spills past the message text`.

### Branch C (H2 confirmed): close the keyboard before a long-press in the message list

**Files:** `web/src/features/chat/conversation-page.tsx`, `web/src/features/chat/chat-lookup.test.tsx`.

- [ ] **Test:**

```tsx
import "~/test/hold"; // PointerEvent polyfill for jsdom

it("H2 fix: a touch on the message list blurs the focused composer before the long-press", async () => {
  setup();
  const input = await screen.findByTestId("chat-input");
  input.focus();
  fireEvent.pointerDown(screen.getByTestId("message-list"), { pointerType: "touch" });
  expect(document.activeElement).not.toBe(input);
  input.focus();
  fireEvent.pointerDown(screen.getByTestId("message-list"), { pointerType: "mouse" });
  expect(document.activeElement).toBe(input); // desktop: clicking the list does not steal focus
});
```

- [ ] **Fix:** on the list `div` (`conversation-page.tsx:1225`):

```tsx
const blurComposerOnTouch = (e: ReactPointerEvent<HTMLDivElement>) => {
  if (e.pointerType !== "touch") return;
  const el = inputRef.current;
  if (el && document.activeElement === el) el.blur(); // keyboard closes now, before Android selects the word (plan 2026-10-14 H2)
};
// <div ref={listRef} data-testid="message-list" onScroll={onListScroll} onPointerDown={blurComposerOnTouch} ...>
```

  This matches WeChat (touching the history closes the keyboard). It does not interfere with the bubble action buttons, which do not need the keyboard.
- [ ] **Commit:** `fix(web): close the chat keyboard when the message list is touched so a long-press selection survives`.

### Branch F (H5 confirmed): bar always on top of the page

**Files:** `web/src/features/lookup/lookup-bar.tsx`, `lookup-bar.test.tsx`.

- [ ] **Test:** the bar's class has `fixed` and `z-50`, not `absolute` (same style as the existing "positions the overlay ... (both fixed)" test in `lookup-layer.test.tsx:113`).
- [ ] **Fix:** `absolute` → `fixed`, `z-40` → `z-50` (the shadow sheet is `z-36` and the lookup drawer is a Radix portal, so the bar stays above the sheet and below the drawer, which only opens when the bar is gone). Keep `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`. If the device log showed the bar outside `vvh` (keyboard), use `bottom` relative to `--app-height` instead: `top-[calc(var(--app-height,100dvh)-4.5rem-env(safe-area-inset-bottom)-3.25rem)]`. Choose by the evidence and write the choice in the results doc.
- [ ] **Commit:** `fix(web): keep the selection bar above the chat composer`.

### Branch A (H1a confirmed): move the bar out of the browser's bottom UI on Android

**Files:** create `web/src/lib/platform.ts` and `platform.test.ts`; modify `web/src/features/lookup/lookup-bar.tsx` and `lookup-bar.test.tsx`.

- [ ] **Test:**

```ts
// platform.test.ts
import { isAndroid } from "./platform";
it("detects Android from the user agent", () => {
  expect(isAndroid({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36" })).toBe(true);
  expect(isAndroid({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" })).toBe(false);
});
```

  In `lookup-bar.test.tsx`, use `vi.spyOn(navigator, "userAgent", "get")` to return an Android UA, and assert that the bar has the `top-[...]` class and no `bottom-[...]` class. With the default jsdom UA, assert the old `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` (iOS and desktop unchanged).
- [ ] **Fix:**

```ts
// web/src/lib/platform.ts
/** Android browsers (R-LP4: UA check; iOS and desktop keep their layout). */
export function isAndroid(nav: Pick<Navigator, "userAgent"> = navigator): boolean {
  return /Android/i.test(nav.userAgent);
}
```

```tsx
// lookup-bar.tsx: below the page's glass top bar (52 px + safe area), clear of Chrome's bottom search panel and the IME.
const POSITION = isAndroid() ? "top-[calc(env(safe-area-inset-top)+3.75rem)]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]";
```

  Compute it once at module scope (the UA does not change), and compose it with `cn(...)` into the existing class list.
- [ ] **Device note** for the results doc: Android's native toolbar floats above the selection. With a selection near the top of the list it may now overlap our bar. Check this on the device. If it overlaps, the follow-up (not in this plan, needs an Addendum) is to place the bar below the selection rect.
- [ ] **Commit:** `fix(web): show the selection bar at the top on Android so the browser's bottom panel cannot cover it`.

### Branch B (H1b confirmed): the bar's tap must survive Android's native selection dismissal

**Files:** `web/src/features/lookup/lookup-bar.tsx`, `lookup-bar.test.tsx`.

- **B1: the device log shows `pointerdown`/`pointerup` on `lookup-trigger` but no `click`.** Open on `pointerup` for touch, and ignore the click that may follow.

```tsx
const firedByPointer = useRef(false);
<Button data-testid="lookup-trigger" className="h-11 rounded-full px-4"
  onPointerDown={() => { firedByPointer.current = false; }}
  onPointerUp={(e) => { if (e.pointerType === "touch") { firedByPointer.current = true; onOpen(selection); } }}
  onClick={() => { if (firedByPointer.current) { firedByPointer.current = false; return; } onOpen(selection); }}>
```

  Test (import `~/test/hold` for the polyfill): `pointerDown` + `pointerUp` with `pointerType: "touch"` calls `onOpen` once, and a following `click` does not call it again. A keyboard or mouse `click` alone calls it once.
  The `selectionActions` slot (read aloud) and `<WordActions>` have the same exposure. If the log shows the same pattern for `lookup-read`, record it and **STOP** for a ruling: changing extension-point buttons is out of scope.
- **B2: no event reaches the bar at all.** The browser consumed the tap. A handler cannot fix that. **STOP** and report, and propose branch G or a "sticky bar" design (keep the last selection info after a native dismissal) for a ruling.
- [ ] **Commit (B1):** `fix(web): open the lookup from the bar on touch release when Android swallows the click`.

### Branch G (H6 confirmed, or the controller/owner rules for it): deliberate long-press selects the pressed word

Applies R-LP3. **Files:**
- `web/src/lib/select-word.ts` and `select-word.test.ts` (add `selectWordAt`)
- create `web/src/lib/use-long-press-word.ts` and `use-long-press-word.test.tsx`
- modify `web/src/features/chat/conversation-page.tsx` and `chat-lookup.test.tsx`

- [ ] **Helper test** (`select-word.test.ts`). jsdom has neither `caretPositionFromPoint` nor `caretRangeFromPoint`, so stub one:

```ts
it("selectWordAt selects the word under the point and leaves an existing selection alone", () => {
  document.body.innerHTML = `<p data-lookup-context id="p">say hello there</p>`;
  const text = document.getElementById("p")!.firstChild!;
  (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
    const r = document.createRange(); r.setStart(text, 6); r.collapse(true); return r; // inside "hello"
  };
  expect(selectWordAt(10, 10)).toBe(true);
  expect(String(window.getSelection())).toBe("hello");
  // a native selection is already there: do nothing
  expect(selectWordAt(10, 10)).toBe(false);
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  window.getSelection()!.removeAllRanges();
  expect(selectWordAt(10, 10)).toBe(false); // no caret API: no-op
});
```

- [ ] **Helper** (append to `web/src/lib/select-word.ts`; keep `selectWord` unchanged):

```ts
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
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
 * Select the word under (x, y) only if nothing is selected yet (a native selection always wins; plan 2026-10-14 R-LP3).
 * Returns whether the selection changed. The global LookupLayer shows the bar after its 300 ms debounce.
 */
export function selectWordAt(x: number, y: number, doc: Document = document): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  if (!sel.isCollapsed && sel.toString().trim()) return false;
  const caret = caretAt(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return false;
  const text = caret.node.textContent ?? "";
  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  if (start === end) return false;
  const range = doc.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
```

- [ ] **Hook test** (`use-long-press-word.test.tsx`, fake timers, `~/test/hold` polyfill). Spy on `selectWordAt` via `vi.mock("./select-word", ...)` and render a `<div data-lookup-context>` with the handlers:
  - touch down, then 450 ms: called once with the down point
  - mouse down, then 450 ms: not called
  - touch down, move 9 px, then 450 ms: not called
  - touch down, up at 200 ms, then 450 ms: not called
  - touch down, `pointercancel` without movement, then 450 ms: **called** (R-LP3)
  - touch down, move 9 px, `pointercancel`: not called
  - touch down, the scroller's `scrollTop` changes, then 450 ms: not called
  - touch down on an element outside `[data-lookup-context]` (a bubble action button), then 450 ms: not called
  - unmount clears the timer
- [ ] **Hook:**

```ts
import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { selectWordAt } from "./select-word";

export const LONG_PRESS_MS = 450;
export const MOVE_TOLERANCE_PX = 8;

/**
 * Deliberate long-press on message text: after LONG_PRESS_MS without moving, select the pressed word unless the browser
 * already made a selection (plan 2026-10-14-chat-longpress-lookup-fix, R-LP3). Never prevents default; touch only.
 */
export function useLongPressWord(scroller: () => HTMLElement | null, doc: Document = document) {
  const press = useRef<{ x: number; y: number; moved: boolean; scrollTop: number; timer: number } | null>(null);
  const cancel = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "touch" || !e.isPrimary) return;
    cancel();
    if (!(e.target as Element).closest?.("[data-lookup-context]")) return;
    const { clientX: x, clientY: y } = e;
    const p = { x, y, moved: false, scrollTop: scroller()?.scrollTop ?? 0, timer: 0 };
    p.timer = window.setTimeout(() => {
      press.current = null;
      if ((scroller()?.scrollTop ?? 0) !== p.scrollTop) return; // it was a scroll
      selectWordAt(x, y, doc);
    }, LONG_PRESS_MS);
    press.current = p;
  }, [cancel, doc, scroller]);

  const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) { p.moved = true; cancel(); }
  }, [cancel]);
  const onPointerCancel = useCallback(() => { if (press.current?.moved) cancel(); }, [cancel]); // no move = Android took the long-press: keep the timer
  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel };
}
```

- [ ] **Wire:** in `conversation-page.tsx` add `const longPress = useLongPressWord(useCallback(() => listRef.current, []));` and spread `{...longPress}` on the message-list `div`. If branch C is also applied, call both `onPointerDown` handlers from one function. In `chat-lookup.test.tsx`, add a case: touch `pointerDown` on the assistant text with `caretRangeFromPoint` stubbed, advance 450 ms, dispatch `selectionchange`, and `lookup-bar` appears.
- [ ] **Commits:** `feat(web): select the pressed word for lookup on a long-press when the browser did not` (helper and hook), then `fix(web): long-press a word in a chat message to look it up` (wiring).

---

## Task T4: Docs

**Files:** `web/src/features/lookup/CLAUDE.md`, `web/src/features/chat/CLAUDE.md`, `web/README.md` (and `web/src/lib/CLAUDE.md` if branch A or G added files there).

- [ ] **Lookup CLAUDE.md Pitfalls:** one line per applied branch, for example:
  - D: markdown components must stay module-level.
  - E: `readSelection` clamps a one-sided spill; two contexts still reject.
  - F/A: the bar's positioning and why.
  - B: the trigger opens on touch `pointerup`.

  Add: "Native long-press on Android is not reproducible in Chromium/Playwright; use `web/scripts/lookup-harness` plus the device probe in plan 2026-10-14-chat-longpress-lookup-fix."
- [ ] **Chat CLAUDE.md:** for C, "touching the message list blurs the composer (touch only)". For G, "`useLongPressWord` on the message list fills an empty selection (R-LP3), never `preventDefault`".
- [ ] **`web/README.md`:** in the lookup paragraph (around line 148, "**未在真机验证:**"), append: "对话页长按选词(Android Chrome 标签页与已安装应用)的修复未在真机验证,结果与清单见 `docs/superpowers/plans/2026-10-14-chat-longpress-lookup-fix-results.md`。" Mention the applied branch in one clause.
- [ ] **Run:** `cd web && yarn vitest run src/architecture.test.ts src/features/lookup src/features/chat/chat-lookup.test.tsx src/components/markdown.test.tsx src/lib` and `yarn web:typecheck`.
- [ ] **Commit:** `docs(web): document the chat long-press lookup fix and its device status`.

## Task T5 (controller only, after merge, deploy and the owner's device check): changelog draft

- [ ] Only after the owner confirms on the phone that the bug is gone, append an entry to `docs/changelog/2026-10.json` (an array; see `docs/CLAUDE.md`). Use `entry_date` = the deploy date, `version: null`, tag `fix`, at most 4 items, zh + en, plain words, claim only what shipped. Template, adjusted to the applied branch:

```json
{
  "entry_date": "2026-10-DD",
  "version": null,
  "title_zh": "对话里长按查词修复",
  "title_en": "Long-press lookup in chat fixed",
  "items": [
    { "tag": "fix", "zh": "在安卓手机上,对话里长按一个词现在会出现查词条,可以查词、朗读或加入生词本。", "en": "On Android phones, long-pressing a word in a chat message now brings up the lookup bar to look it up, hear it or save it." }
  ]
}
```

  If branch A shipped, add one item: "安卓上选词后的操作条改到屏幕上方,不再被浏览器的搜索面板挡住。" / "On Android the selection bar now sits at the top so the browser's search panel no longer covers it." If branch G shipped: "长按消息里的词会直接选中它,不用再拖动选择。" / "Long-pressing a word in a message selects it right away."
- [ ] Run `cd server && uv run pytest -q tests/test_changelog_import.py`. Remind the user to run `docker compose exec server python -m app.admin.changelog_import` after the next rebuild, and to publish in 更新日志.

---

## Device checklist (owner; UNVERIFIED until ticked by the owner)

Record each row in the results doc.

**A. Android Chrome tab** (the owner's phone):
- [ ] A1 Long-press a word in an AI reply, keyboard closed: the bar appears fully visible within about 1 s, and 查词 opens the drawer with the word.
- [ ] A2 Same with the keyboard open (text mode, input focused).
- [ ] A3 Own typed message; A4 voice-message transcript (also on a highlighted poor word); A5 a word inside a link in an AI reply.
- [ ] A6 Drag the handles to select a whole sentence: the bar switches to 翻译, and the native Copy / Share still work and copy the right text.
- [ ] A7 Scrolling the message list with a finger never selects a word by itself. A quick tap on text selects nothing.
- [ ] A8 The 朗读 and ☆ buttons on the bar work after a long-press.
- [ ] A9 Controls: shadow sheet reference sentence, vocabulary review card, library word tap, wordbook review double-tap all still work.

**B. Android installed app (home-screen PWA):**
- [ ] B1 A1 and A6 again.

**C. iOS Safari (regression):**
- [ ] C1 Long-press a word in chat: the bar appears, 查词 works, and there is no double callout or loupe glitch (watch for this if branch G shipped).
- [ ] C2 Drag-select a sentence and use Copy from the iOS callout.
- [ ] C3 With branch A: the bar is still at the bottom on iOS.
- [ ] C4 Keyboard open, then long-press in the list: no page jump (the 2026-10-13 keyboard fix still holds).

**D. Desktop (sanity):**
- [ ] D1 Mouse drag-select in chat shows the bar. Clicking the message list does not steal focus from the input (branch C is touch-only).

## Results table (fill after execution)

| Item | Result |
|---|---|
| T0 owner triage | (pending) |
| T1a vitest characterization | (pending) |
| T1b Playwright harness | (pending) |
| T1c device log | (pending) |
| T2 confirmed hypothesis / branch(es) | (pending) |
| T3 branch tests | (pending) |
| typecheck | (pending) |
| Device checklist A–D | **UNVERIFIED** (owner) |
