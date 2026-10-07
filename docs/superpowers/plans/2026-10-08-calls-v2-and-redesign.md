# Calls v2 + Voice Preview + Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (1) voice preview + British/American choice; (2) realtime calls work on iOS; (3) hands-free/loud speaker output without recording the phone's own audio; (4) manual hold-to-talk and live VAD input never conflict; (5) per-message translation in calls; (6) a new mobile UI design.

**Architecture:** Three parallel lanes with disjoint file ownership (A voice picker, B call audio engine, C call translation), then one redesign lane (D) after A–C merge (it restyles screens they touch), then a deferred review wave and rebuild.

**Tech Stack:** React + Vite + Tailwind (web/), FastAPI (server/), Volcengine TTS, Web Audio, Silero VAD.

**Spec:** none written; the user's 7 requests of 2026-10-08 are the spec, and the acceptance criteria below are binding. Rulings made without a spec are provisional.

## Global Constraints

- Branch `feat/self-hosted-backend`; each lane works in its own git worktree off HEAD; no `git checkout --`/`git stash` in lane worktrees.
- Never edit `enjoy/` (desktop app shares it). Redesign only through web-local files (`web/src/styles/theme.css`, `web/src/index.css`, `web/src/layout/*`, `web/src/components/*`, page files) and web-local wrappers; `web/src/styles/theme.test.ts` keeps theme tokens in sync with `enjoy/src/index.css`, so update that test deliberately (ruling: web theme may diverge; test asserts web-specific token set).
- Never print, log or commit `.env` contents or keys; i18n: every new string added to both zh and en locale files.
- Existing tests must stay green: `npm test` in web/, `pytest` in server/; type-check passes. New behavior needs tests.
- Browser/AudioContext/iOS behavior that cannot be verified here is listed as unverified in the lane report; do not claim it works on a real device.

## File ownership

| Lane | Owns |
|---|---|
| A | `server/app/routers/config_api.py`, `server/app/static_config/volcengine_voices.json` (accent field), `web/src/api/server-config.ts`, `web/src/features/chat/conversation-settings-sheet.tsx`, new `web/src/features/chat/voice-picker.tsx`, `web/src/features/practice/*` voice usage, locales |
| B | `web/src/audio/*`, `web/src/features/realtime/realtime-call.ts`, `call-machine.ts`, `use-realtime-call.ts`, `vad.ts`, `web/public/sw.js`, `server` COOP/COEP headers if needed |
| C | `web/src/features/realtime/realtime-call-screen.tsx` (caption area only), `realtime-call-dialog.tsx`, new `call-caption-translation.tsx`, `use-message-translations.ts` reuse |
| D | theme, layout, pages, shared web components (after A–C merged) |

B and C both touch the realtime feature: B must not change `realtime-call-screen.tsx` except the controls area (PTT/hands-free buttons); C must not change anything but the caption list. Merge order B, A, C, then D.

---

### Task 1 (Lane A): Voice preview + British/American accent

**Files:** Modify `server/app/routers/config_api.py`, `server/app/static_config/volcengine_voices.json` consumers, `web/src/api/server-config.ts`, `conversation-settings-sheet.tsx`, `web/src/features/practice/*`; Create `web/src/features/chat/voice-picker.tsx` and test; locales.

**Interfaces:**
- Produces: `VoiceOption` gains `accent?: "us" | "gb" | "other"` (derived from `language` en-US / en-GB, or from id containing `british`); `voicesFor(config, ttsModel, {accent?})`.
- Consumes: `POST /api/ai/audio/speech` `{input, model, voice, stream:false}`; `sharedAutoplayAudio`/`primeAudioElement` from `use-tts-player.ts`.

- [ ] Test first: `voicesFor` filters by accent; accent derivation for en-US, en-GB, british ids; picker renders accent tabs (全部/美式/英式), a preview button per voice, only one preview plays at a time, tapping again stops it, preview failure shows a toast.
- [ ] Implement `VoicePicker` (replaces the `<select data-testid="settings-tts-voice">`; keep that testid on the selected value so existing e2e stays valid). Preview plays fixed sentence "Hi, nice to meet you. How is your day going?" with that voice via the speech endpoint; cache blobs per voice in memory.
- [ ] Server: if the voice JSON lacks accent, add an `accent` key in the `/config` output (not by editing 158 rows by hand; derive in code). Add test.
- [ ] Gender label shown if available. Selecting a voice whose model is not Volcengine still works; call voice fallback note unchanged.
- **Acceptance:** user can filter US/UK, tap ▶ to hear any voice without selecting it, select one and it persists in `config.ttsVoice`; tests green.

### Task 2 (Lane B): iOS realtime works (not only hold-to-talk)

**Files:** `web/src/audio/vad.ts`, `capture.ts`, `realtime-call.ts`, `call-machine.ts`, `web/vite.config.ts`/server headers, tests.

- [ ] Diagnose from code first (write findings in the report): why `vadUnavailable` or `ensureRunning` would trip on iOS Safari. Candidates: onnxruntime-web wasm without cross-origin isolation (set `ort.env.wasm.numThreads = 1` and `simd` handling explicitly before `MicVAD.new`; serve `.wasm`/`.mjs` with correct MIME), VAD loaded before user gesture context, AudioContext suspended after getUserMedia, 1.5 s resume timeout too short on iOS (raise to 4 s, retry `resume()` on `touchend`/`click`), `visibilitychange` ending the call during the permission prompt (ignore hidden events for the first 3 s and while the permission prompt is open).
- [ ] Add a fallback ladder when Silero fails: energy-gate-only continuous detection (`web/src/audio/energy-gate.ts` already exists) as "auto" mode instead of forcing push-to-talk; PTT remains available manually. `vadUnavailable` now means "Silero unavailable, using basic detection", not locked PTT. Test in `call-machine` tests.
- [ ] iOS-specific unit tests with mocked AudioContext (suspended → resume after gesture; worklet missing → ScriptProcessor).
- **Acceptance:** with Silero failing, the call still runs with hands-free energy-gate detection; with a suspended context it recovers; documented as unverified on real iOS.

### Task 3 (Lane B): Louder / hands-free output and no self-recording

- [ ] Set `navigator.audioSession.type = "play-and-record"` (guarded) when a call starts, restore `"auto"` on end, so iOS uses the loudspeaker route.
- [ ] `PcmPlayer`: expose `setVolume(v)`; default gain 1.8 with a `DynamicsCompressorNode` before destination to avoid clipping; call screen gets a speaker toggle (听筒/免提) that switches gain presets (earpiece 1.0, speaker 2.2) and persists the choice in localStorage (wrapped in try/catch).
- [ ] Echo: keep `echoCancellation/noiseSuppression/autoGainControl` true; additionally (a) while the bot is speaking, raise gate thresholds (already present) and add "half-duplex in speaker mode": mute frame sending and VAD triggers while the bot plays unless the user taps/holds to interrupt (barge-in by hold only in speaker mode; in earpiece mode barge-in stays voice-based). (b) Route the player output through a `MediaStreamDestination` → `<audio>` element when supported so the browser's AEC has the correct reference signal (WebRTC AEC only cancels audio from media elements/WebRTC on some browsers); behind a feature check with a test; fall back to `ctx.destination`.
- [ ] Never record the phone's own audio: speaker-mode half-duplex is the guaranteed guard; test with a simulated frame stream that frames sent while `botSpeaking && speakerMode` are 0.
- **Acceptance:** speaker toggle exists, defaults to hands-free on touch devices, louder output, no mic frames sent while the bot speaks in speaker mode; unit tests; real-device loudness unverified.

### Task 4 (Lane B): Manual hold-to-talk disables live input cleanly

- [ ] Single input-mode state in `call-machine.ts`: `inputMode: "auto" | "ptt"`; entering `ptt` pauses VAD **and** the energy-gate trigger, drops pre-roll, ends any in-progress auto utterance without sending a half-utterance (cancel it), and ignores VAD callbacks; leaving `ptt` resumes. Replace `pushToTalk`/`pttHeld` flags with the one mode plus `holding`.
- [ ] Holding the PTT button while the bot speaks interrupts the bot (as today); releasing sends `utterance_end`; a quick tap under `minHoldMs` cancels with no send.
- [ ] UI (controls area only): one segmented switch "自动 / 按住说话"; in "按住说话" mode the live mic indicator reads "麦克风已关闭，按住说话" and the mic is not captured outside holds (frames not sent).
- [ ] Tests: no frames sent in ptt mode outside holds; toggling mid-utterance cancels; no double utterance when VAD fires during hold.
- **Acceptance:** the two modes are mutually exclusive, with no leaked VAD utterances while in PTT mode.

### Task 5 (Lane C): Translation in calls

- [ ] Pass `api` and `nativeLanguage` into `RealtimeCallScreen` via the dialog; reuse `useMessageTranslations` + `MessageTranslation`.
- [ ] Per assistant caption (after `reply_done`, not streaming/interrupted): small "译" button toggles a translation line. User captions get the same button (translate the user's own words to the native language is not needed; show only on assistant captions).
- [ ] Setting "自动翻译" (call header menu, persisted in localStorage): when on, each finished assistant caption is translated automatically and shown under it. Translation requests are aborted on call end and never block audio.
- [ ] Tests: button hidden while streaming, translation shown/hidden, auto mode triggers once per caption, abort on unmount.
- **Acceptance:** translating works during a call, manual and auto, without delaying speech.

### Task 6 (Lane D): Frontend redesign

Runs after Tasks 1–5 are merged. Design brief (ruling by controller, provisional): a warm, calm, "language-coach" look, mobile first.

- [ ] Write `docs/superpowers/specs/2026-10-08-web-redesign.md` first: palette (warm off-white `#FAF7F2`, ink `#1E2A32`, primary teal-green, accent coral for recording/hang-up; dark mode equivalents), type scale (system UI font stack for UI, keep CharisSIL for English reading text), 8-pt spacing, radius 16/24, elevation, motion (≤200 ms, `prefers-reduced-motion` respected), touch targets ≥44 px, safe-area insets.
- [ ] Update tokens in `theme.css`; adapt `theme.test.ts` as per Global Constraints.
- [ ] Redesign: bottom nav (large icon + label, active pill), page headers, home/practice cards, chat list and conversation bubbles, composer (keep WeChat-style toggle), call screen (large avatar with speaking waveform ring, bottom control dock: 免提 / 静音 / 翻译 / 按住说话 / 挂断), settings sheet, voice picker, me page, login.
- [ ] Don't change behavior or testids; update e2e selectors only if markup moves.
- [ ] Screenshots at 375×812 light+dark for the main screens via the Browser tools, saved under `docs/superpowers/plans/redesign-screens/`.
- **Acceptance:** all screens use the new tokens; no horizontal scroll at 375 px; contrast ≥4.5:1 for text; tests and type-check green.

### Task 7: Final wave

- [ ] Deferred review wave over the merged diff (code quality + security + a11y); fix findings in one pass.
- [ ] Full web tests, server tests, type-check, build; rebuild container only when the user asks.
- [ ] Update `e2e-results.md` with new checklist items: iOS call, speaker volume, PTT/VAD exclusivity, translation, voice preview, redesign (marked unverified where not run on device).
