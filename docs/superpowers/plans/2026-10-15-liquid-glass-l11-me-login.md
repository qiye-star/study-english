# Liquid glass · L11 Me / settings + login + install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Read first:** `2026-10-15-liquid-glass-INDEX.md` §3, §5.4, §6; v2 mockup frame "我的 / 设置" (`me()`: profile hero
> `.m1.strong` with `.wells`, one-row rank panel `.rankbar`, regrouped `.grpl` panels, 外观与主题 row showing the preset,
> logout `.pill.gh.red`). Starts after **L2**; may be developed in parallel, but **merges after L3** (the new row links to
> `/me/appearance`).

**Goal:** Me in the v2 layout: large title 我的; a profile hero panel (neutral avatar, name, three stat wells inside — streak,
speaking minutes, average with a score dot); the rank card as its own panel; the learning / voice / general / server
groups as panels; the colour-scheme select replaced (liquid only) by an **外观与主题** row that opens the L3 page and shows
the current preset; logout as red text on a well pill 32px below. Login and install: page background, the logo mark in an
ink well, pill fields, the one accent submit pill.

**Architecture:** additive classes (R-LG1) plus two JS branches in `me-page.tsx` (R-LG2): the hero wrapper and the
appearance row. The classic branch renders exactly today's JSX (the existing `me-page.test.tsx` cases, including the
colour-scheme select and the whole-object settings assertion, keep passing).

## Global Constraints

- Owned files: `web/src/pages/{me-page,login-page,install-page}.tsx`, `web/src/pages/{me-page,login-page}.test.tsx`,
  `web/src/pages/i18n/{zh-CN,en}.json` (INDEX §9). The appearance page itself (`pages/appearance/**`) is L3's.
- Keep test ids: `me-username`, `me-stats`, `me-week`, `me-progress`, `me-vocabulary`, `me-playback-rate`,
  `me-room-voice-auto-text`, `me-color-scheme` (classic only), `me-language`, `me-services`, `me-ai-error`, `me-logout`,
  `login-*`, `register-invite`. New: `me-hero`, `me-appearance` (liquid only).
- `login-page.test.tsx:80-81` (`/\bh-(11|12)\b/`, `/\btext-base\b/`) stays true (additive).
- Worktree `.claude/worktrees/lg-l11`, branch `feat/lg-l11`, junctioned `node_modules`. CRLF: single-line anchors.
- Tests per task: listed files + `src/architecture.test.ts` + `src/i18n/i18n.test.ts`; lane end: `cd web && yarn vitest run src/pages` + `yarn web:typecheck`.
- Commits `feat(web): …`, one per task, own `Co-Authored-By:` line.

## Rulings specific to L11

- **R-L11-1** Under liquid the colour scheme is chosen on the appearance page (spec §6.4); the Me row shows the preset name
  (`web.appearance.preset.<preset>` from L3's eager strings).
- **R-L11-2** Stats: the three `StatTile`s become wells inside the hero (L2 styles them); the average gets a `ScoreDot`.
- **R-L11-3** Week strip: active day = ink 85 % fill with a surface check; today = accent outline (unchanged).
- **R-L11-4** Logout: red text on a well pill, centred, `mt-8`.

---

## Task L11-1: Me page

**Files:** Modify `web/src/pages/me-page.tsx`, `web/src/pages/me-page.test.tsx`, `web/src/pages/i18n/{zh-CN,en}.json`.

- [ ] **Step 1:** i18n: in `pages/i18n/zh-CN.json` inside `"me": {`, after the `"groups"` line add
  `      "appearance": "外观与主题",`; in `en.json` `      "appearance": "Appearance",` (Read; single-line anchor on the `"groups"` line).
- [ ] **Step 2 (test):** Append to `me-page.test.tsx` (reuse its render helper; Read):
```tsx
import { setLiquid } from "~/test/glass";

describe("Me in the liquid skin (plan 2026-10-15-liquid-glass L11)", () => {
  afterEach(() => setLiquid(false));

  it("profile hero with stat wells, appearance row instead of the colour select, red well logout", async () => {
    setLiquid(true);
    // render exactly like the existing stats test (stats endpoint answering), then:
    const hero = await screen.findByTestId("me-hero");
    expect(hero.className).toContain("mat-surface-strong");
    expect(hero).toContainElement(screen.getByTestId("me-username"));
    expect(hero).toContainElement(await screen.findByTestId("me-stats"));
    expect(screen.queryByTestId("me-color-scheme")).toBeNull();
    const row = screen.getByTestId("me-appearance");
    expect(row).toHaveAttribute("href", "/me/appearance");
    expect(row).toHaveTextContent(/磨砂|Frosted/);
    expect(screen.getByTestId("me-logout").className).toContain("liquid:text-red");
  });
});
```
- [ ] **Step 3:** Edit `web/src/pages/me-page.tsx`:
  1. Imports: lucide line 3 → add `PaletteIcon` to the list; add
     `import { LQ_DANGER_TEXT, LQ_PAGE, LQ_PANEL } from "~/components/liquid";`, `import { ScoreDot } from "~/components/score-dot";`,
     `import { useLiquid } from "~/lib/glass-flag";`, `import { useGlassTheme } from "~/settings/glass-theme-store";`.
  2. `SelectRow` single line starting `    <div className="relative flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring active:bg-surface-2">`
     → same string + ` liquid:px-4 liquid:active:bg-wash` before the closing quote.
  3. `SwitchRow` single line `    <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">` →
     `    <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 liquid:px-4">`; its `Switch` className single line
     (`… data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />`) → + ` liquid:data-[state=unchecked]:bg-wash-2` before the closing quote.
  4. `WeekStrip` lines 107–109:
     `"mx-auto mb-[3px] flex h-5 w-5 items-center justify-center rounded-inline text-blue",` → + ` liquid:rounded-full liquid:text-surface`;
     `d.active || today ? "bg-blue-tint" : "bg-surface-2",` → `d.active ? "bg-blue-tint liquid:bg-ink/85" : today ? "bg-blue-tint liquid:bg-transparent" : "bg-surface-2 liquid:bg-wash",`.
  5. In `MePage`, after `const id = useId();` add:
```tsx
  const liquid = useLiquid();
  const { theme } = useGlassTheme();
```
  6. Turn the profile row (lines 168–175, the `<div className="flex items-center gap-3.5 px-0.5 pb-0.5 pt-1.5">…</div>`) and the
     stats block (lines 177–185) into two constants declared before `return` — **byte-identical JSX** — named `profile` and
     `statsBlock`; in `statsBlock`, the third tile's `value` becomes
     `value={stats.avgPronunciation === null ? "—" : <span className="inline-flex items-center gap-1.5">{oneDecimal(stats.avgPronunciation)}<ScoreDot score={stats.avgPronunciation} /></span>}`
     (ScoreDot is hidden in classic: classic pixels unchanged). On the `Avatar` in `profile` append ` liquid:text-ink` to its
     `className`.
  7. Render: single line `      <PageHeader title={t("web.me.title")} />` → `      <PageHeader large title={t("web.me.title")} />`;
     single line `      <div className="px-gutter pb-6">` → ``      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>``; where `profile` and
     `statsBlock` were, put:
```tsx
        {liquid ? (
          <SurfaceCard strong data-testid="me-hero" className="mt-2 p-4 [&_[data-testid=me-stats]]:mt-3.5">
            {profile}
            {statsBlock}
          </SurfaceCard>
        ) : (
          <>
            {profile}
            {statsBlock}
          </>
        )}
```
  8. General group: single line `          <div className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">` →
     ``          <div className={`divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface ${LQ_PANEL}`}>``.
     Replace the colour-scheme `<SelectRow … >…</SelectRow>` (lines 214–218) with:
```tsx
            {liquid ? (
              <ListRow icon={<IconChip tone="gray" icon={PaletteIcon} />} title={t("web.me.appearance")} to="/me/appearance" testId="me-appearance"
                value={<span>{t(`web.appearance.preset.${theme.preset}`)}</span>} />
            ) : (
              <SelectRow id={`${id}-color-scheme`} testId="me-color-scheme" icon={SunMoonIcon} title={t("web.me.colorScheme")}
                hint={t("web.me.colorSchemeHint")} display={t(`web.me.colorSchemeOptions.${colorScheme}`)} value={colorScheme}
                onChange={(v) => setColorScheme(v as ColorScheme)}>
                {COLOR_SCHEMES.map((s) => <option key={s} value={s}>{t(`web.me.colorSchemeOptions.${s}`)}</option>)}
              </SelectRow>
            )}
```
     (the classic `SelectRow` is byte-identical to lines 214–218).
  9. Logout single line
     `          className="mt-[18px] flex h-12 w-full items-center justify-center gap-1.5 rounded-button text-body font-semibold text-red transition-colors duration-fast active:bg-red-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">`
     → same string + ` ${LQ_DANGER_TEXT} liquid:mx-auto liquid:mt-8 liquid:w-auto liquid:px-6` (convert to a template literal).
- [ ] **Step 4:** Run `cd web && yarn vitest run src/pages/me-page.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts` — green
  (classic cases unchanged; the liquid case needs L3's strings, which are merged before this lane merges — if running before
  L3 merged, the preset text assertion falls back to the raw key; accept `/磨砂|Frosted|preset/` until rebased on L3).
- [ ] **Step 5:** Commit `feat(web): liquid Me page with profile hero and appearance row`.

---

## Task L11-2: login and install

**Files:** Modify `web/src/pages/login-page.tsx`, `web/src/pages/install-page.tsx`, `web/src/pages/login-page.test.tsx`.

| File:line | Current fragment | Append / change |
|---|---|---|
| `login-page.tsx:52` | `"flex min-h-[100dvh] flex-col justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"` | + ` page-bg` |
| `login-page.tsx:55` | `"flex h-[60px] w-[60px] items-center justify-center rounded-sheet bg-blue-tint text-blue"` | + ` well liquid:rounded-full liquid:text-ink` |
| `login-page.tsx` `FIELD` constant (line ~14; `… focus-visible:ring-blue focus-visible:ring-offset-0"`) | | + ` liquid:h-11 liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:shadow-well liquid:focus-visible:ring-blue/35` (keep `h-11`/`h-12` and `text-base` tokens) |
| `login-page.tsx:61` | `<form onSubmit={submit} className="space-y-4" noValidate>` | `<form onSubmit={submit} className="space-y-4 mat-surface-strong liquid:rounded-panel liquid:p-4" noValidate>` |
| `login-page.tsx:85` | `className="!mt-6 h-12 w-full rounded-button text-[15px] font-semibold"` | + ` liquid:!rounded-full liquid:shadow-accent` |
| `install-page.tsx:16` | `<div className="px-gutter pb-6 pt-1">` | + ` liquid:px-frame` |
| `install-page.tsx:18` | `"flex h-[60px] w-[60px] flex-none items-center justify-center rounded-sheet bg-blue-tint text-blue"` | + ` well liquid:rounded-full liquid:text-ink` |
| `install-page.tsx:26` | `"num flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-blue-tint text-sub font-semibold text-blue"` | + ` well liquid:text-ink` |
| `install-page.tsx:9` | `ShareIcon … text-blue` | unchanged (it shows the real iOS share glyph colour) |

- [ ] **Step 1 (test):** Append to `login-page.test.tsx`:
```tsx
import { setLiquid } from "~/test/glass";
  it("liquid: form panel, pill fields, accent submit (plan 2026-10-15-liquid-glass L11-2)", () => {
    setLiquid(true);
    // render like the existing field test, then:
    expect(screen.getByTestId("login-submit").className).toContain("liquid:shadow-accent");
    expect(screen.getByLabelText(/用户名|Username/).className).toMatch(/\bh-(11|12)\b/);
    expect(screen.getByLabelText(/用户名|Username/).className).toContain("liquid:rounded-full");
    setLiquid(false);
  });
```
- [ ] **Step 2:** Apply the rows.
- [ ] **Step 3:** Run `cd web && yarn vitest run src/pages src/architecture.test.ts` — green.
- [ ] **Step 4:** Commit `feat(web): liquid login and install pages`.

## Task L11-3: docs

- [ ] `web/src/pages/CLAUDE.md`: bullet "Liquid glass (plan 2026-10-15-liquid-glass L11): Me = profile hero (`me-hero`) + 外观与主题 row (`me-appearance`, liquid only; the colour select stays for classic); login form is an E1 panel."
- [ ] Commit `docs(web): pages liquid notes`.

## Device checklist (UNVERIFIED)

- [ ] Me at 360px: three stat wells fit (labels 连续 / 口语时长 / 平均发音 on one line each).
- [ ] Login on iOS: pill inputs keep 16px (no zoom); the page background reaches under the status bar.
