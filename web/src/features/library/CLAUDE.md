# web/src/features/library/

Follow-along library: upload / import material, play it sentence by sentence, shadow it. Lazy-loaded behind `/library` and `/library/:id`; only `index.ts` is public (`LibraryListPage`, `LibraryPlayerPage`, `useLibraryEnabled`). Spec: `docs/superpowers/specs/2026-10-13-video-import-design.md` §11; visual source of truth: `docs/superpowers/design/video-import-v1/mockup-glass.html` (D11).

## What lives here
- Pages: `library-list-page.tsx` (list, usage bar, add button, opens the sheet), `player-page.tsx` (+ `segment-list.tsx`, `shadow-panel.tsx`, `use-media-player.ts`, `use-shadowing.ts`).
- Add material (bottom sheet): `add-sheet.tsx` (tabs) → `upload-form.tsx` (`checkUpload` / `checkSubtitles` validate; the form owns the state) → `file-pick-tile.tsx` (big dashed tile → file card, drag and drop) and `subtitle-picker.tsx` (compact row); `import-form.tsx` (link tab, paste button, DRM / disabled notices); `add-sheet-helpers.ts` (`formatFileSize`, `formatsHint`, `fileKind`, `deriveTitle`).
- Upload pipeline: `upload-client.ts` (chunked, resumable), `upload-store.ts` (module-level jobs; the list cards show progress), `library-api.ts` (endpoints, `limitsOrDefault`, `extOf`, `stemOf`), `config.ts` (`/api/library/config`; kept free of lazy strings).
- Featured library (spec `docs/superpowers/specs/2026-10-14-curated-library-design.md` §10; mockup `docs/superpowers/design/curated-library-v1/mockup.html`; results `docs/superpowers/plans/2026-10-14-curated-library-web-results.md`): `catalog-api.ts` (list / add / poster), `use-catalog.ts`, `catalog-view.tsx` + `catalog-card.tsx` (`/library?tab=catalog`, switch 我的素材 / 精选 shown only when `config.catalog`). A copy is a normal item (`source: "catalog"`, `catalogId`): 精选 badge, "uses no space", no ⋯ menu at all (no re-recognize / re-split), cover shown for audio too (`usePosterUrl(id, hasPoster, ref, fetcher)`), stored translations show in the player even when `config.ai` is false (nothing is requested then).
- Visual layer: `library.css` (scoped to `.library-root`; the add-sheet form has its own section), `library-root.tsx`, `fx/` (hand-written effects: SpotlightCard, SpecularButton, GlassSurface, SoftAurora, …; no new npm dependencies).
- Strings: `locales/{en,zh-CN}.json` merged lazily by `locales.ts` (every module using `web.library.*` does `import "./locales"`); `i18n/` holds only the nav label (eager).
- `test-fixtures.ts` / `test-i18n.ts` are test-only; product code must not import them.

## Allowed dependencies
- `lib/`, `api/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, `~/features/practice` (the one allowed cross-feature edge, see `architecture.test.ts`). Never import `chat` or `lookup`.

## Test
- `cd web && yarn vitest run src/features/library`; style rules only: `yarn vitest run src/features/library/library-css.test.ts`.

## Pitfalls
- Blur budget: at most 3 `backdrop-filter` declarations in `library.css` (`.lib-glass`, `.lib-gblur`, the add sheet); `library-css.test.ts` counts them. Tiles, cards, fields and notices use translucent fill + highlight border only. No new `@keyframes` for form controls (transitions only); `html.lite` and `prefers-reduced-motion` sections at the end of `library.css` must list new transitions / animations.
- The add sheet is a Radix portal: it carries its own `library-root lib-sheet` classes so the CSS variables apply. Submitting the upload form closes the sheet immediately (`library-list-page.tsx`); progress is on the list card, not in the sheet.
- File inputs: the real `<input type=file>` stays in the DOM, visually hidden (`.lib-pick-input`, not `hidden` / `display:none`) and is opened by a `<label htmlFor>` so iOS Safari opens the picker inside the tap. Never call `input.click()` after an `await`. Reset `value` after reading `files[0]`. A dropped file bypasses `accept`, so `checkUpload` is the only type check.
- The title field auto-fills from the file name until the user types in it (`titleTouched`); the submitted title is still `title.trim() || undefined`.
- `SegmentedControl` is shared: restyle it only through `className` / `optionClassName` and `.library-root .lib-seg …` selectors.
- A copy's media is shared with the catalog: deleting a copy removes only the user's own item (the delete dialog has its own text for copies). Never infer or show file paths. `add` is idempotent; an already added card opens the player. `?tab=catalog` is the only new query parameter and is ignored when `config.catalog` is false. Add returning 404 (item withdrawn) toasts and removes the card at once. A featured card's "取消入库" (`useCatalog.remove`) uses the same `DELETE /items/{id}` and the same `DeleteItemDialog`; only `404 Not Found` counts as already deleted; on success `onCopyRemoved` makes the list page drop the item. The player page has no such entry.
- Catalog cards: compact row on narrow screens, two columns only from 430px (`library.css` `.lib-cat-*`); no new `backdrop-filter` / `@keyframes` (the spinner is Tailwind `animate-spin`); licence line is `ink-2` at 80%, never `ink-3` (ink-3 is not for text).
- Words, titles, links and file names never go into URLs or logs; the import link travels only in the POST body.
- Real-device behaviour (iOS picker, drag and drop, clipboard paste, glass look) is unverified; see `docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md`.
