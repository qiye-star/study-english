# app/static_config/

Static JSON snapshots (with per-deployment overrides applied) served by `GET /api/config/{key}` (`app/routers/config_api.py`), replacing
the enjoy.bot config endpoints for the desktop and web clients.

## What lives here
`gpt_presets`, `gpt_providers`, `default_gpt_preset`, `default_tts_preset`, `tts_providers_v2`,
`volcengine_voices` (voice list incl. `language`/accent data used by the web voice picker),
`chat_agent_templates`, `ipa_mappings`, `ytb_channels` (`.json` each).

## Allowed dependencies
Data only, no code. Read by `routers/config_api.py` via a path relative to `routers/`
(`../static_config`); keep this directory at `app/static_config/`.

## Entry points
- Refresh upstream snapshots: `uv run python scripts/fetch_config.py` (writes here)
- Hand-maintained: `volcengine_voices.json` (not in `fetch_config.py`'s KEYS; edit by hand)

## Tests
`uv run pytest -q tests/test_static_config_files.py tests/test_config_api.py`

## Pitfalls
- Files must stay valid JSON with the shapes the clients parse; the tests check this.
- Never put keys or private endpoints in these files: the endpoint is unauthenticated.
