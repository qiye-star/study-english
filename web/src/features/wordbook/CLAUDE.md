# web/src/features/wordbook/

背单词 (spec `docs/superpowers/specs/2026-10-10-wordbook-design.md` §11): book picker, daily plan, learn, review, summary;
the spelling-in-context mode lives in `spell/`. Hidden unless `/api/wordbook/config` says enabled.

## What lives here
- `wordbook-api.ts` (types + calls, `WORDBOOK_SERVER_ERRORS`), `use-wordbook-config.ts`.
- Pages: `home-page.tsx` (/wordbook), `books-page.tsx` (/wordbook/books), `learn-page.tsx`, `review-page.tsx`; entries
  `wordbook-card.tsx` (practice page) and `me-row.tsx` (`WordbookMeRow`, 我的 → 学习). No bottom tab.
- Session chrome: `session-header.tsx` (× close + `StepBar`), shared `DOCK` bar (sticky above the tab bar).
- `use-speaker.ts` (TTS via `useTtsPlayer` + server default model/voice, US/UK voice by accent), `use-rank-enabled.ts`.
- `use-today.ts` (`useWordbookToday`), `page-status.tsx` (loading / translated error + retry / note), `ui.ts` (shared button / dock classes, `bookTitle`, `fmt`), `test-fixtures.ts` (snake_case server samples for tests only).
- `session-machine.ts` (learn/review queue), `word-card.tsx`, `choice-question.tsx`, `typing-question.tsx`, `letter-diff.tsx`, `plan-ring.tsx`, `session-summary.tsx`.
- Review after-answer (spec `2026-10-13-review-after-answer-and-library-alignment-design.md` §2, plans `2026-10-13-review-after-answer.md` + `2026-10-14-review-bilingual-longpress.md`): `option-view.ts` (pure: bilingual per-option row view, panel card), `after-answer-panel.tsx` (study panel under the question, with the 中文 chip), `tap-lookup-pref.ts` + `tap-lookup-hint.tsx` (one-time hint 「点一下单词就能查词」, device-local `tapLookupOnceHintSeen`; the two-tap-era `tapLookupHintSeen` is ignored; the old `longPressHintSeen` is ignored and cleared with the whole prefs key at logout). `ChoiceQuestion` takes an optional `after` prop: only the review page passes it. Typed questions (`dictation` / `spell` fallback) also get `AfterAnswerPanel` (WordCardView path) from the batch card only; spot checks need nothing (the flipped recall card already is the card). The result line stays the only `role="status"`.
- `spell/` – see `spell/CLAUDE.md`. `i18n/{en,zh-CN}.json`.
- Wordbook v2 (spec `2026-10-11-wordbook-recall-design.md`): `recall-cover.tsx` (meaning cover button), `recall-rating-bar.tsx`
  (`RecallRatingBar` 不认识 / 模糊 / 认识, `SpotBar`, `RatingBadge`), `recall-card.tsx` (review quick-recall front / back).
  `session-machine.ts` also exports `startCard` / `cardReducer` / `ratingPayload` (peek + clamped `elapsedMs`), `planLearnQuiz`,
  `slotId` / `slotKey`, `learnTally`. The review page calls `reviewBatch(api, 20, { recall: true })`; `/config.learn` carries
  `autoplay` / `showExample`.
- Daily goals (spec `2026-10-11-wordbook-goals-design.md`): `goals-math.ts` (estimates D / S = 5N / R(t), presets,
  `previewPlan` mirroring the server's `plan.compute_plan`, `parseCount` with full-width digits), `goals-stepper.tsx`,
  `goals-fields.tsx` (shared by the goal sheet and the book picker), `goals-sheet.tsx` (每日目标 sheet: extra words, streak,
  change / pause / reset), `goals-confirm.tsx` (its pause / reset confirmations), `use-goals.ts` (only PATCH is optimistic),
  `use-return-focus.ts`, `goals-test-fixtures.ts` (snake_case goals samples, extends `test-fixtures.ts`).
- Learned words & free review (spec `2026-10-12-wordbook-review-and-room-reopen-design.md` §1): `learned-page.tsx`
  (`/wordbook/learned`, lazy; list, filters, word-card sheet), `box-bar.tsx` (distribution bar, press a segment to filter),
  `use-learned.ts` (`useLearnedSummary`, `useLearnedList` cursor paging, `useDebounced`), `free-review-sheet.tsx` (scope x mode x
  count), `free-batch.ts` (`FREE_PATH`, `toBatch`, `readFreeState`), `free-browse.tsx` (flip-card browse, sends no requests),
  `learned-test-fixtures.ts` (snake_case samples for tests only).

## Public surface
`index.ts`: pages (lazy, from `lazy-pages.tsx`), `WordbookCard`, `WordbookMeRow`, `useWordbookEnabled`, `useWordbookConfig`.
Other directories import only `~/features/wordbook`.

## Allowed dependencies
`lib/`, `api/`, `audio/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, other features via `index.ts`
(TTS: `useTtsPlayer` from `~/features/chat`, called inside components only — never at module top level).

## Test
`cd web && yarn vitest run src/features/wordbook`. Page tests set `zh-CN` in `beforeEach` and assert Chinese copy. To stub TTS,
`vi.mock("~/features/chat/use-tts-player", …)` (mocking the `~/features/chat` barrel does not reach `use-speaker.ts`).

## Pitfalls
- Card, recap, defs, phrases, after-answer, summary and spell-result English text is marked with `lookupContext`. Quiz prompts only after the answer (`lookupContextIf(result !== null)`); never the recall front, the covered headword or the spelling cloze (plan 2026-10-15 R-M3, guarded by `src/lookup-marks.test.ts`). Answered option rows are non-interactive divs (no role / handlers) whose word span carries `data-lookup-context`, so the global tap-to-lookup treats them as targets; before the answer the options are buttons (ineligible, no peeking). `word-card-legacy.test.tsx` strips `data-lookup-context` before comparing (R-M4).
- Teal is the wordbook identity colour; blue only for primary actions and the active blank; wrong answers are neutral, never red.
- Liquid glass (plan 2026-10-15-liquid-glass L9): home = `today-liquid.tsx` (`WordbookTodayLiquid`, rendered only under `useLiquid()`, same test ids); docks = `mat-chrome-bar` with `GHOST_DOCK` plate pills (Rule 4); quiz after-answer = ink ring + green 正确 mark / red ✕ 你的选择; no teal under liquid (progress = ink, plan ring arc = accent); the reset confirm keeps the red fill; word-card-legacy snapshot regenerated deliberately (only added tokens).
- `/answers` returns `expected` = the headword and `correctOption` = the exact correct option text (choice questions;
  null for typed / known). `correctOptionOf` uses it verbatim; never rebuild the server's meaning line (Ruling Z-e).
- Grading happens on the server; never grade or reveal answers client-side beyond what the response returns.
- `wordbook-api.ts` types/signatures are shared by every lane (plan P-W4); changing them needs a plan Addendum.
- Response keys are camelCased deeply by `ApiClient`: never rely on word-keyed maps from the server (`reviewBatch` re-keys
  `cards` by `card.key`); word text lives in values, which are never transformed.
- Pages are code-split (`lazy-pages.tsx`, each with its own Suspense + `PageLoading`): never export a page module statically
  from `index.ts`, or the main chunk grows again (base 1,537.8 kB; with eager pages 1,622.8 kB; lazy 1,562.2 kB).
- `session-summary.tsx` serves learn, review and spell (`kind: "spell"`); `letter-diff.tsx` is shared with `spell/`.
- Spell prefs use `WORDBOOK_PREFS_KEY` from `~/lib/storage` (one key; `auth/device-data.clearDeviceData()` clears it at logout).
- The 练习 bottom tab stays highlighted on `/wordbook/*` (`layout/bottom-nav.tsx` `also`).
- E2E: `web/e2e/wordbook.spec.ts` (learns each card with 模糊) and `wordbook-recall.spec.ts` (needs `WORDBOOK_SPOT_CHECK_PCT=100`;
  the review part makes a word due through `e2e/support/wordbook-db.ts`). Zero upstream; the e2e guard lets `/api/wordbook/*`
  through except `/explain`.
- Boxes, spot checks and the two-fuzzy rule are decided by the server: the client only reports `rating`, `revealedBefore`
  and `elapsedMs`. Never show a box or spot-check result before the response, and never send an `elapsedMs` above
  600000 (the server rejects it with 422): use `ratingPayload` / `clampElapsed`.
- While covered, the meaning, examples and phrases are not in the DOM at all (no blur or opacity tricks).
- Plan rules live in three places that must change together: server `plan.compute_plan`, `goals-math.previewPlan` and the shared
  table `server/tests/fixtures/wordbook_plan_cases.json` (`goals-math.test.ts` reads it directly, never skips, and also checks the server's
  `INTERVAL_DAYS` / `BACKLOG_NEW`). `wordbook-contract.test.ts` compares every goals key with no gate.
- `review_cap` 0 means "no limit" on the wire (`reviewUnlimited: true`); forms use `reviewCap: null`. Always read limits via `limitsOf`.
- Never nest enjoy's `AlertDialog` inside a `BottomSheet`: it bundles another `@radix-ui/react-focus-scope` copy and the two
  focus traps recurse forever. Use `goals-confirm.tsx` (same `@radix-ui/react-dialog`). Radix modals return focus only to a
  `Trigger`; sheets opened by plain buttons spread `useReturnFocus()` on the content.
- Pause / reset only from their confirmation dialogs; red is for reset only.
- Learned page, free-review sheet and browse component are reached only through `lazy-pages.tsx` (or from inside the lazy page);
  `learned-lazy.test.ts` guards it. The home page only gains one row and one summary request. Copy is merged eagerly into the
  main bundle, so keep new keys few (budget: plan R-L13).
- Words and the search prefix go only in POST bodies: `fetchLearned`, `fetchLearnedCard`, `startFree` must never become GET or put a
  word in a path. `fetchCard` (GET `/cards/{book}/{key}`) is legacy; new pages do not use it.
- A free batch travels as `navigate(FREE_PATH, { state: { free } })` to `/wordbook/review?source=free`. `ReviewSession` under `free`
  sends `mode: "free"`, takes `bookId` per item, skips the today-plan request and shows no rank points; `applied` in free mode
  means "added to today's review".
- Mastery tiers are boxes 0-1 / 2-3 / 4-5 (not "1-6"); `LearnedSummary.byBook` is a list.
- Contract: `wordbook-contract.test.ts` checks `learned_summary / learned_list / learned_card / free_start / answer_free` key by key.
- Audio: no autoplay before the first tap (iOS); `speaker.prime()` only on the first gesture; read in click handlers, not
  effects, so StrictMode cannot read twice (a second `play()` with the same id stops playback).
- 释义显示默认「仅英文」(`def-lang.ts` 的 `DEFAULT_DEF_LANG`,spec `2026-10-13-defs-default-lookup-ios-design.md` §2):组件的默认 prop、`defLangOf`、`RecallCard` 都引用它,不要再写死 `"both"`。「哪些行显示」只由纯函数 `defView()` 决定(没有英文释义的卡回退成中文);卡片右上角「中」开关(`word-card.tsx`)是单卡本地状态,按 `card.key` 复位,不写服务端也不写本机;设置里的「短语」开关与学新词页卡片上的手动开合写同一个 `phrasesOpen`(`phrases-pref.ts`);复习页答后区不用右上角「中」,改用 `zhReveal()` + `ZhToggle`「中文」按钮(`WordCardView` 受控 `peek`/`onPeek`,状态在复习页按题槽复位),中文释义与短语译文一起藏 / 显(计划 `2026-10-14-review-bilingual-longpress` R-Z2 / R-Z3)。
- 「我的 → 中文释义」点击后显示(`~/settings/zh-defs-pref`):学新词、复习背面、答后区、自由复习浏览由页面传 `zhCover`,`WordCardView` / `AfterAnswerPanel` 用 `ZhDefsCover` 原位盖住**本来会显示**的中文释义(`def_lang` en 时仍是「中」/「中文」);已学词弹层不传;揭开不影响 `peeked` / `revealedBefore`(计划 2026-10-23 R-A2/R-A5/R-A8)。
- `ChoiceQuestion` answered-state containers exist only when `after` is passed (review page, meaning / word / cloze; cloze only when the server sent `option_info`, otherwise it keeps the old look). The learn page and the spot-check question keep disabled buttons (E2E selectors `button[data-state="correct"]` depend on it). Never put `role="status"` in the after-answer area (the result line is the only one).
- `optionInfo` / `phrases` / `example` on `AnswerResult` are optional (old server, memo miss, other qtypes): match info by `option` text, never by index; render the old look when absent. Answered meaning rows are always bilingual (Chinese option text + small English word), independent of `def_lang`. Looking a word up on an answered row is the global one-tap lookup (one tap selects the word and shows the lookup bar); the rows have no long-press, click swallowing, contextmenu suppression or keyboard activation any more. Real iOS / Android behaviour is UNVERIFIED (docs/superpowers/plans/2026-10-15-tap-lookup-results.md).
