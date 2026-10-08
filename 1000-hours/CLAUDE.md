# 1000-hours/ (upstream)

Upstream documentation site (1000 hours of English, `yarn docs:dev`). Not ours to reorganize.

- Do not restructure, rename, or reformat files here; keep diffs against upstream minimal.
- `web/` reads upstream code only through `web/src/shims` (and the `@renderer/*` alias); never edit this directory to make web work.
- Our own work lives in `web/`, `server/`, `docs/`.
