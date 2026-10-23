# web/src/features/dubbing/

Film-clip role-play dubbing (plan `docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing.md`, mockup §C of `docs/superpowers/design/10.21-ui-v1/mockup.html`). Pick a clip of a library item, pick a role, rehearse, record, get per-line scores. Routes `/dub` and `/dub/:itemId` (liquid-glass skin; `/library*` is pinned to the classic skin, so dubbing does not live there).

## What lives here
- `index.ts`: public surface for the rest of the app (`useDubbingEnabled`). The main bundle imports only `index.ts`, `config.ts`, `use-dubbing-enabled.ts`.
- `config.ts`: `GET /api/dubbing/config`, cached per `ApiClient`; a failure counts as disabled.
- `dubbing-api.ts`: the HTTP layer and the wire types (contract fixture `server/tests/fixtures/dubbing_contract.json`). Role-name keys go out lowercased by the client's decamelize; the server upper-cases role letters.
- `loader.ts`: the lazy entry. It loads the library kit (`loadDubbingKit()`) and the dubbing strings. Pages arrive in later tasks.
- `kit-context.tsx`: `DubKitProvider` / `useDubKit()` hand the kit to the components.
- Pages (lazy, via `lazy-pages.tsx`, which is the only file besides `index.ts` that `app.tsx` imports): `dub-home-page.tsx` (`/dub`, picker), `dub-item-page.tsx` (`/dub/:itemId`: clip, role labels, role picker, then `dub-session.tsx`, then `dub-results.tsx`).
- Pure rules: `clip.ts` (R6 limits, same codes as the server), `windows.ts` (R14 windows, mute, countdown), `karaoke.ts` (linear word-time estimate), `compare-player.ts` (original vs mine, mutually exclusive).
- Capture and orchestration: `take-capture.ts` (one microphone per take, slices per window, PCM or MediaRecorder fallback, injected deps), `take-scheduler.ts` (media-time driver: mute, window open/close, end, interruptions), `line-queue.ts` (per-sentence assessment, concurrency 2, drain timeout, abort), `take-runner.ts` (the state machine), `use-dub-take.ts` (the React entry; wires the real deps).
- `role-identity.tsx`: the one role → colour / default-name table (`roleName`, `roleLabel`, `RoleDot`, `RoleTag`); the wire keys stay A–F and a user-saved custom name wins. `dubbing.css`: `.dub-root`-scoped tokens (light + dark; gentle selection tint, role colours), guarded by `dubbing-css.test.ts` (plan 2026-10-23 R-B1/R-B4).
- Screens: `clip-picker.tsx`, `role-labels.tsx` (debounced save; suggestions are drafts), `role-picker.tsx`, `stage.tsx` (video, ticket via the kit's `useMediaSource`), `rehearsal-view.tsx`, `recording-view.tsx`, `headphone-hint.tsx`, `results-view.tsx`.
- Entry: `register.tsx` (imported only by `src/plugins/core.ts`) contributes `practiceHome/dubbing.entry` as a core contribution; `entry-card.tsx` renders nothing while the feature is off.
- `locales.ts` + `locales/{en,zh-CN}.json`: strings under `web.dubbing.*`, merged lazily. English and Simplified Chinese only (plan R20, no Spanish).

## Allowed dependencies
- `~/api/client`, `~/auth/auth-context`, `~/i18n`, `~/features/library` (only `loadDubbingKit` and the `DubbingKit` type). `~/features/practice` arrives with the scoring queue (W6).
- Never the main-bundle modules of library (only through the kit). Never `features/rooms` or `features/chat`.

## Test
- `cd web && yarn vitest run src/features/dubbing`; architecture: `yarn vitest run src/architecture.test.ts`.

## Pitfalls
- Tickets (media URL, realtime tickets) are secrets: never print or log them.
- Sentence text, role names and assessment text never go into URLs or logs; only uuids and integers go into paths.
- A 404 from `/api/dubbing/*` means off; a 429 is the AI daily limit; a 503 from `/roles/suggest` is "AI unavailable". Classify by status, never by the message text.
- The features' lazy-bundle guard is `dubbing-lazy.test.ts`; do not statically import locales, the kit, or pages from `index.ts`.
