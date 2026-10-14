# app/wordbook/

背单词 (spec `docs/superpowers/specs/2026-10-10-wordbook-design.md`). Off unless `WORDBOOK_ENABLED`.

## What lives here
- `books.py` – the seven books, enabled-list parsing, data dir (pure)
- `textnorm.py` / `entry.py` – tokenizing, inflections, cleaning and merging raw lines into `WordCard` (pure)
- `index.py` – `BookIndex` + `DictionaryStore` (`dictionary(app)`): lazy per-book index, line reads, LRU, hidden sentences
- `grading.py` / `quiz.py` / `cloze.py` / `plan.py` – grading, question types and distractors, spelling sets, daily plan (pure)
- `store.py` – enrollments, learned words, events, counters (DB); `service.py` – endpoint orchestration; `explain.py` – AI "why"
- `learned.py` – 已学词熟练度分档(存储盒 0–5)、易错判定、游标、本地日窗口(纯;只导入 `plan`)
- `recall.py` – v2 self-rating rules (spec `2026-10-11-wordbook-recall-design.md` §5): effective rating (peek → fuzzy,
  two fuzzy in a row → unknown), spot-check hash, new-word boxes, same-day quiz / re-rate targets (pure)
- `forms.py` – 词形 → 原形小表加载器(forms.txt,懒加载、文件变了自动重读)
- `lookup.py` – 选词词典(DictionaryLookup:规范化 → 七本书直接命中 → 词形 → 短语表;不记录查询)
- `option_memo.py` – 出题时记「选项原文 → 词键」的进程内有界 LRU(挂在 `DictionaryStore.option_memo`),答题后回填 `/answers` 的 `option_info`(无日志调用;取不到就省略)

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`. Imported only by `app/admin`, `app/routers`,
`app/main.py` (enforced by `tests/test_architecture.py`). Rank reads `wordbook_events` through `app.models`, never this package.

## Tests
`uv run pytest -q tests/test_wordbook_*.py tests/test_rank_wordbook.py tests/test_admin_wordbook.py`
Fixture book: `tests/fixtures/wordbook/mini.jsonl`; helpers `tests/wordbook_helpers.py`.

## Pitfalls
- Dictionary files are read-only and byte-exact; never write next to them. Build indexes off the event loop (`asyncio.to_thread`).
- Grading is deterministic and stateless (P-W2); never call an LLM to grade.
- Never log user answers, explanations or prompt bodies; log book id, word length, status codes.
- `app.core.config.WORDBOOK_BOOK_IDS` duplicates `books.BOOK_IDS` (core cannot import this layer); `tests/test_wordbook_books.py` keeps them equal.
- `admin/wordbook_admin.py` uses `store.wordbook_source` and `store.load_hidden`; never re-implement the `wordbook:<book>`
  source string or the hidden-set refresh elsewhere.
- `/answers` returns `expected` (headword) and `correct_option` (exact option text for choice questions, else null).
  Spell blanks carry `form` (sentence surface form, e.g. go → went) for the hint and TTS only; grading never trusts it.
- Contract fixture `tests/fixtures/wordbook_contract.json` is read by the web contract test (never skipped): re-record with
  `CONTRACT_UPDATE=1` whenever a response shape changes.
- `/answers` 对 `meaning` / `word` / `cloze` 选择题追加**可选**键 `option_info`(`[{option, word, defs_zh, defs_en}]`,与题面同序,网页按 `option` 文本匹配)、`phrases`(≤ 3)、`example`;只在判分后构造。`/answers` 无状态,所以 `option_info` 靠出题时的 `option_memo`(进程内,重启 / 淘汰 / 多 worker 取不到就省略,不是错误);打字题、自评与抽查答案不带这三个键(cloze 的选项是词头,与 `word` 同构)。不要把备忘用于判分(P-W2),也不要把词或选项写进日志。
- `def_lang` 默认值是 `store.DEFAULT_DEF_LANG = "en"`(无偏好行的用户);已存过偏好的用户读最新 `defpref` 事件,不受默认值影响。录制的 `def_lang_patch` 用 `"zh"`(PATCH 成默认值是空操作)。
- Self-rating (`qtype=recall`): boxes, spot checks and the fuzzy streak are decided here, never by the client.
  `known:true` is an alias for an unpeeked `know`. Same-day follow-ups on a new word (round quiz, spot check,
  re-rating) only move the box through `store.set_learn_box` (no reps, no `last_reviewed_at` → no `vocab_review`);
  not-due words still go through `apply_lapse`. The new-word event kind comes only from `service._learn_kind`.
- The spot-check seed is the enrollment `seed`: never put it in a response. A review spot check is two steps
  (`pending` + `check`, then the same rating with `choice`); the pending step writes no box and no event.
  `service._spot_seed` takes the seed of the book the word was learned in (not the client's `book_id`). Only a
  `meaning` answer passes a new word's spot check, and only while the latest rating is still `know_chk`.
- Learn-mode `/answers` run under `service._learn_lock` (per user, per process; the image runs one worker): without it,
  concurrent answers for one new word create duplicate rows and several `learn` events (rank points).
- `tests/wordbook_helpers.enable_wordbook` defaults `wordbook_spot_check_pct=0`; spot-check tests pass 0 / 1 / 100.
- Limits: answers 3,000 per user per local day (`store.ANSWERS_DAILY_MAX`), reports 20 (`REPORTS_DAILY_MAX`), card LRU 1,024
  per process; all seven indexes ≈ 7 MiB traced.
- Goals v2 (spec `2026-10-11-wordbook-goals-design.md`): `_day_plan(..., settings=settings)` is the only plan entry
  (effective limits, today's bonus, remaining words); `review_cap == 0` means 「不限」 (`plan.REVIEW_UNLIMITED`); stored
  values outside the admin range are clamped on read, never rewritten. New event kinds `relearn` (counts toward
  today's new words, no rank points), `bonus` (credit = words), `goal` (one per local day), `reset`; rank reads only
  `learn`/`spell_set`. `plan.compute_plan` and web `goals-math.previewPlan` share `tests/fixtures/wordbook_plan_cases.json`.
- Reset deletes only `vocabulary_items` with `source='wordbook:<book>'` and resets cursor/seed; the router injects the rank
  sync as `before_delete` so it runs only after the book, confirmation and daily-limit checks pass.
  Settings/pause/resume/bonus share 60/day (`wordbook_settings`), reset 2/day (`wordbook_resets`).
- 已学词 = `source='wordbook:<启用书>'`;盒子 0–5 分三档(`learned.TIERS`,熟练下界 = `plan.MASTERED_BOX`);响应没有映射(`by_book` 是列表)。
- 词、前缀、游标永远不进 URL:`/learned/query`、`/learned/card`、`/free/start` 都是 POST 体;
  `test_wordbook_learned_api.py::test_new_routes_carry_no_word_in_the_url` 守着。`GET /cards/{book}/{key}` 是遗留写法,别再让新页面用。
- `mode="free"`(`service._free_answer`):永不调用 `apply_review` / `apply_lapse` / `set_learn_box`;事件固定 `practice`;
  答错只可能 `pull_due`(`due_at = now`),受「24 小时内正式复习过、或 24 小时内刚学(没复习过的词看 `created_at`)的不拉」与每日 20 次(`store.FREE_PULLS_DAILY_MAX`)约束。
  改这几条前先读计划 R-L6:`due_at = now` 会通向 `vocab_review`。
- `free_start` 用系统熵 `random.Random()`(可注入),不用选书 `seed`;空池不扣 `FREE_STARTS_DAILY_MAX`(200)。
- 契约样例新增 `learned_summary / learned_list / learned_card / free_start / answer_free`。
- 选词词典 `POST /api/dictionary/lookup` 的词只在 POST 体;`lookup.py` 里不许有 logging 调用,`forms.py` 只记行数、不记词(`test_dictionary_lookup.py::test_the_module_is_not_a_logging_site`);不受 `WORDBOOK_ENABLED` 控制;`DictionaryLookup` 随 `dictionary(app)` 的 store 更换(`lookup_service`)。
