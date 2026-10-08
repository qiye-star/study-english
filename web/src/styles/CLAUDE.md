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
