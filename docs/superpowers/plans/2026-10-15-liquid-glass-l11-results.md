# Liquid glass · L11 results (2026-10-15)

Branch `feat/lg-l11`. Plan: `2026-10-15-liquid-glass-l11-me-login.md`. Targeted tests only.

## Deviations (plan vs reality)

1. All anchors matched. The extracted `profile` / `statsBlock` constants are declared before `return` (statsBlock wrapped in a fragment; JSX content unchanged).
2. L3's page and its `web.appearance.preset.*` strings are not in this branch: the Me row uses a local `APPEARANCE_PATH = "/me/appearance"` constant (INDEX-frozen path), and the test accepts `/磨砂|Frosted|preset/` (raw key until rebased on L3). Re-check after the L3 merge.
3. Test added beyond the plan: switch-off keeps the classic structure (no `me-hero`/`me-appearance`, colour select present). The liquid Me test supplies its own stats mock (the plan said "like the stats test").
4. Edits done with a CRLF-preserving script (multi-line); new tests CRLF. No 「已加入 N 天」 (owner answer).

## Verification

- `src/pages src/i18n/i18n.test.ts src/architecture.test.ts`: me-page 15, login-page, architecture, i18n all green (pages dir 33 tests incl. architecture).
- Red-first run done for the Me liquid test (failed on `me-hero`); login liquid test written with the code in the same step.

## UNVERIFIED

- No browser/device run: 360px stat wells fit, iOS 16px pill inputs, page background under the status bar.
- Preset label rendering until L3 strings exist.
