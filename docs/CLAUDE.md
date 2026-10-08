# docs/

Design and planning records for our own work (web PWA, self-hosted server). Upstream docs live elsewhere (`1000-hours/`, `book/`).

## Layout
- `superpowers/specs/YYYY-MM-DD-<topic>-design.md` — approved designs (the "what and why"). Change only with the user's agreement.
- `superpowers/plans/YYYY-MM-DD-<topic>.md` — implementation plans: numbered tasks with `- [ ]` checkboxes, rulings (R1, R2 …) and review notes. Plans may grow dated `## Addendum (YYYY-MM-DD)` sections; rulings there override earlier text.
- `superpowers/plans/*-results.md`, `*-spike-*.md`, `*-latency.md`, `e2e-results.md` — measured results and verification checklists.
- `superpowers/design/<name>/` — visual design notes (e.g. `redesign-v3/design-notes.md`, the source for `web/src/styles/theme.css`).

## Conventions
- File names start with the ISO date the document was created; topic in kebab-case.
- Write what was verified vs. not: mark anything not run on a real device or real upstream as unverified. Never invent numbers; latency figures come only from the latency doc.
- Tick checkboxes in plans only when the work is merged and tests pass.
- Reference code by repo-relative path (`web/src/features/chat/turn-results.ts`).
- No secrets, tokens, or personal data in docs; use placeholders.
- Prose may be Chinese or English; keep each document consistent.
