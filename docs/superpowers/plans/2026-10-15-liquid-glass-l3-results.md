# Liquid glass · L3 results (2026-10-15)

Branch `feat/lg-l3`. Plan: `2026-10-15-liquid-glass-l3-appearance.md`. Targeted tests only.

## Deviations (plan vs reality)

1. **Test data (language).** `SettingsProvider` re-applies the stored UI language on mount, so `i18n.changeLanguage("zh-CN")`
   alone left the page in English. `background-picker.test.tsx` and `appearance-page.test.tsx` also set
   `enjoy-web.settings = {"language":"zh-CN"}` in `beforeEach` and remove it in `afterEach`. No frozen name or ruling changed.
2. **Typecheck (plan code).** `SegmentedControl` for the 正在编辑 switch inferred `T = string` (setter `Dispatch<SetStateAction<ColorMode>>`
   rejected, TS2322); fixed with an explicit `<SegmentedControl<ColorMode>>` and options built from `(["light","dark"] as const)`.
3. `glass-budget.test.ts` is an LF file in the repo; the appended `BLUR_OWNERS` line is LF (one line, diff +1). New files are CRLF.
4. All other anchors in `app.tsx` and `pages/CLAUDE.md` matched. The import of `TOAST_CLASSNAMES` sits after the
   `SettingsProvider` import as the plan says. The `toastOptions.classNames` block is replaced by `TOAST_CLASSNAMES`
   (classic values byte-identical, plus the `liquid:` additions from L2).
5. The `redirects to Me` test prints React Router's "No routes matched location /me" warning (the test has no `/me` route); passes.

## Verification

- New tests: glass-slider 2, background-picker 3, appearance-page 5 (10 total).
- `src/layout src/pages src/build src/components src/lib src/settings src/styles src/test src/app src/architecture.test.ts`:
  62 files, 522 of 523 passed; the one failure is the known `layout/app-shell-shadow.test.tsx` load flake (L1 results), it passes alone.
- `src/i18n/i18n.test.ts` green; `yarn web:typecheck` clean.

## UNVERIFIED

- No browser/device run: slider thumb look (webkit/moz pseudo-elements), live preview repaint while dragging, toast look with
  the liquid classes, redirect when the switch is off in the real router, lazy chunk loading offline (Suspense fallback is `null`).
- `prefers-reduced-transparency` note and low-memory hint paths are not covered by tests.
