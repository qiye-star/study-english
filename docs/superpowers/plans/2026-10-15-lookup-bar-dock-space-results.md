# Lookup bar above bottom docks (results)

Problem: the global lookup bar (z-40, bottom = `--tab-bar-space + 0.5rem`) landed on the review DOCK and covered 继续 (bar y700-754 vs DOCK y696-762 at 390x844), so a mis-tap advanced the question.

## Mechanism
- `web/src/components/use-dock-space.ts`: `useDockSpace()` returns a callback ref; writes `--dock-space` (px) on `<html>`. Value = dock top to `<main>` content-box bottom (main bottom minus its padding-bottom = tab-bar top), i.e. the dock's height plus its liquid gap, the space it takes above `--tab-bar-space`. No `<main>` ancestor: the dock's own height. Module registry, MAX of all mounted docks, property removed when none remain; ResizeObserver (guarded) on dock and main + window resize.
- `web/src/components/dock.tsx`: `<Dock>` = div + hook (forwards ref).
- `lookup-bar.tsx`: `bottom-[calc(var(--tab-bar-space)+var(--dock-space,0px)+0.5rem)]` (unset = old offset; /library* and /practice/changelog have no dock, unchanged).

## Wired
- Wordbook DOCK (class string unchanged, `<Dock className={DOCK}>`): review-page (start + after-answer), learn-page, learned-page, free-browse (2), session-summary, recall-rating-bar; spell-page (2 inline sticky docks).
- Chat composer (`chat-composer`, hook merged with its own measuring ref), rooms composer (`room-composer`, forwarded ref kept), rank match dock (`match-dock`).
- match-page is now route-lazy (`rank/lazy-pages.tsx`, same pattern as chat/wordbook): it was in the main bundle and dragged the hook in (+0.66 kB); main is now 409.14 kB (-7.12 vs 416.26 baseline, baseline not edited). Tests import `./match-page` directly.

## Not wired (and why)
- Realtime call screen (own fixed z-50 layer above the bar) and its call-dock; library shadow panel / shadow sheet / bottom sheets / lookup drawer (other layers, locked or modal); persona-editor-sheet sticky footer (inside a sheet); practice page record buttons and assessment page (inline in cards, not a bottom bar); conversation-list FAB (a button, not a bar).

## Geometry (Chromium, production build, mocked API, touch + CDP long press on option word, liquid skin)
| viewport | before: bar / DOCK / Continue | after: bar / DOCK / Continue | gap bar-bottom to DOCK-top |
|---|---|---|---|
| 390x844 | y700-754 / y696-762 / y705-753 | y626-680 / y688-754 / y697-745 | 8 px |
| 360x740 | not measured | y530-584 / y592-658 / y601-649 | 8 px |
`--dock-space`: 74px (390x844), 66px (360x740; stuck sticky dock has no bottom gap there). No intersection with Continue; `elementFromPoint` at the bar centre and four corners returns the bar in both. Chat conversation page: unit level only (not mocked in Chromium).
