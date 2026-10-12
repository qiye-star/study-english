# server/dictionaries/

Third-party dictionary data read at runtime by `app/wordbook/` (spec 2026-10-10-wordbook §3). Not Python; not imported.

## What lives here
- `kylebing-english-vocabulary/` – seven sentence-level JSONL word books + `SOURCE.json` manifest + upstream `LICENSE`.

- `wordbook-definitions/` – English definitions (hand-written `function-words.jsonl`, licence texts `LICENSE-OEWN` / `LICENSE-ECDICT`;
  generated files arrive with the build lane). See its own `CLAUDE.md`; attribution is in the repo-root `NOTICE`.

## Rules
- Files are byte-identical to the pinned upstream commit; never edit them by hand. Update = change `SOURCE.json`,
  run `uv run python scripts/wordbook_data.py download`, commit alone (`chore(server): update wordbook data to <sha>`).
- `.gitattributes` marks `*.jsonl` here as `binary` (no EOL conversion: checksums must stay stable on Windows).
- Keep each file < 50 MB (GitHub soft limit); no Git LFS.
- Copied into the image by `server/Dockerfile` (`/app/dictionaries`); whitelisted in `server/Dockerfile.dockerignore`.

## Test
`uv run pytest -q tests/test_wordbook_data_files.py`
