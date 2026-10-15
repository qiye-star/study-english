# web/src/styles/

`theme.css`: design tokens for redesign v3 (`docs/superpowers/design/redesign-v3/design-notes.md`), imported by `src/index.css` before Tailwind.

## Rules
- Channel tokens are "r g b" for `rgb(var(--x) / <alpha>)` (e.g. `bg-blue/10`, `text-ink-2`); tint/hairline/glass tokens are full colors.
- One meaning per hue: blue action/user, teal vocabulary, amber streak/hints, green high score/online, red hang-up/exit.
- shadcn names (`--background`, `--primary`) alias the semantic tokens so reused enjoy UI keeps working.
- Forked from `enjoy/src/index.css`; do not sync back.

## Test
- `cd web && yarn test` (`theme.test.ts` validates tokens and light/dark pairs).

## Pitfalls
- Add tokens in both light and dark blocks and to `tailwind.config.cjs` if used as utilities.
- Liquid glass (plan `2026-10-15-liquid-glass`): new tokens (`--graphite`, `--ink-wash*`, `--plate`, `--scrim`, `--page-*`, `--mat-*`, scalars `--gx-radius`, `--frame-x`) are read only by the section at the end of `index.css`, scoped `html[data-glass="v2"]`. Never re-value an existing token (locked pages read them). Guards: `liquid-tokens`, `liquid-variant`, `glass-budget` (blur owners + `BLUR_OWNERS` allowlist), `locked-pages`. `liquid-colour-guard` bans un-neutralised `*-tint` / teal classes in in-scope sources (reviewed exceptions are listed in the test).
