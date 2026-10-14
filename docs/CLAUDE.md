# docs/

Design and planning records for our own work (web PWA, self-hosted server). Upstream docs live elsewhere (`1000-hours/`, `book/`).

## Layout
- `superpowers/specs/YYYY-MM-DD-<topic>-design.md` — approved designs (the "what and why"). Change only with the user's agreement.
- `superpowers/plans/YYYY-MM-DD-<topic>.md` — implementation plans: numbered tasks with `- [ ]` checkboxes, rulings (R1, R2 …) and review notes. Plans may grow dated `## Addendum (YYYY-MM-DD)` sections; rulings there override earlier text.
- `superpowers/plans/*-results.md`, `*-spike-*.md`, `*-latency.md`, `e2e-results.md` — measured results and verification checklists.
- `images/readme/NN-<name>.png` — screenshots used by the root `README.md` (real app, local demo environment with fake data and a fake upstream; ≤ 250 KB each; no secrets or real users). Replace them when the UI changes noticeably.
- `superpowers/design/<name>/` — visual design notes (e.g. `redesign-v3/design-notes.md`, the source for `web/src/styles/theme.css`).
- `changelog/YYYY-MM.json` — user-facing changelog **drafts** (spec `superpowers/specs/2026-10-14-changelog-design.md`, plan `superpowers/plans/2026-10-14-changelog.md`): one JSON array per month, `[{entry_date, version|null, title_zh, title_en, items:[{tag: new|improve|fix|library|other, zh, en}]}]`. **Claude writes them** after a feature is merged, deployed and checked, and only as drafts: `docker compose exec server python -m app.admin.changelog_import` (idempotent by `entry_date` + `title_zh`; `--dry-run` counts only; the image carries the folder after a rebuild, which happens only when the user asks); the user edits and publishes them in the admin console (更新日志, `/admin/changelog`). Writing rules: plain friendly words for end users (no internal terms such as migration, table, endpoint, worktree), no secrets or user data, one sentence per item, at most 4 items per entry, Chinese and English both filled, claim only what shipped, `version` stays null unless the user gives one. A renamed `title_zh` imports as a new draft. `server/tests/test_changelog_import.py` validates every file here.
- Duty note (belongs in the repo-root `CLAUDE.md` Conventions, which this plan must not edit): "After a user-visible feature is merged and verified, Claude drafts a changelog entry in `docs/changelog/YYYY-MM.json` (see `docs/CLAUDE.md`) and reminds the user to run the import command; the user publishes in the admin console."

## Conventions
- File names start with the ISO date the document was created; topic in kebab-case.
- Write what was verified vs. not: mark anything not run on a real device or real upstream as unverified. Never invent numbers; latency figures come only from the latency doc.
- Tick checkboxes in plans only when the work is merged and tests pass.
- Reference code by repo-relative path (`web/src/features/chat/turn-results.ts`).
- No secrets, tokens, or personal data in docs; use placeholders.
- Prose may be Chinese or English; keep each document consistent.
