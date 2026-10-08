# enjoy/ (upstream)

Upstream Electron desktop app (Enjoy). `web/` reuses some of `enjoy/src` read-only: UI primitives, pronunciation components, i18n JSON, constants, command prompt sources. Not ours to reorganize.

- Do not restructure, rename, or reformat files here; keep diffs against upstream minimal.
- `web/` reads upstream code only through `web/src/shims` (and the `@renderer/*` alias); never edit this directory to make web work.
- Our own work lives in `web/`, `server/`, `docs/`.
