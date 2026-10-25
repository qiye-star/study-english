# app/agents/greeting/

Chat home and daily greeting (plan `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting.md`). Off unless
`CHAT_HOME_ENABLED` (routes in `app/routers/chat_home.py`; this package has no switch checks of its own).

## What lives here
- `prefs.py` - per-user prefs (`greeting_trigger`, `language`, `daily_persona_id`, `include_stats`): defaults, `load` (drops bad keys), `save` (strict, flush only)
- `facts.py` - learning-data sources (`streak`, `due_vocab`, `yesterday_*`; `wordbook_today` comes from `app/links/greeting_facts.py`), `gather` (300 ms per source, 600 ms total), `GreetingFacts`, `focus_hint`
- `prompt.py` / `parse.py` / `templates.py` / `slots.py` - pure functions: default template + fixed prefix/facts rules/contract, output rules (`check_lines`, `normalize_marks`, `model_text_error`, `fill`), three-paragraph fallback, fact slots
- `service.py` - `ensure_today` (default conversation + greeting, idempotent, one model call at most), `mark_seen`

## Allowed dependencies
`app.core`, `app.models`, `app.providers`, `app.services`, `app.agents.*`. Never `wordbook / links / rank / rooms / realtime / routers / admin`
(not even inside functions; `tests/test_architecture.py`). Data that needs the dictionary comes from `app/links/greeting_facts.py` via the registry.

## Privacy
No words, greeting text, persona text, prompt text or user ids in logs, URLs or errors. Logs carry event name, status, source, error class, counts and ms.
`chat_greetings.facts` holds numbers only.

## Fixed parts of the prompt
The `SAFETY_PREAMBLE` prefix, the facts rules block (`slots.rules_block`) and the JSON output contract suffix are appended by code; the admin-editable `chat.daily_greeting` template cannot remove them.

## Facts are filled by code (plan addendum 2026-10-25, R18)
The model never writes a number or a fact. It writes prose with `{streak}` `{due}` `{mistake}` `{practice_minutes}` placeholders, and only those the learner really has are offered (none: a welcome greeting). `parse.parse(raw, language, slots)` rejects any digit, Chinese numeral, English number word, unknown / unoffered placeholder or stray brace outside placeholders, then substitutes the localized phrases from `slots.build` and wraps them in `*...*` (the model's own `*` are dropped). `{name}` cannot appear in the admin template (it is `str.format`-ed, so `validate_prompt` rejects it).
