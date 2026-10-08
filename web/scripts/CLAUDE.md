# web/scripts/

Build-time Node scripts.

## What lives here
- `copy-vad-assets.mjs` — copies 4 VAD/ONNX files from `node_modules` into `public/vad/<vad-web>-ort<onnxruntime-web>/`, deleting other version dirs. Runs before `yarn dev` and `yarn build`.
- `vad-assets.mjs` (+ `.d.mts`) — shared version/path logic used by the script and by `vite.config.ts` (`__VAD_ASSET_BASE__`).

## Test
- `cd web && yarn test` (`src/audio/vad-assets.test.ts`, `src/build/vite-config.test.ts`).

## Pitfalls
- The script fails if it does not find exactly 4 files; recheck file names after upgrading `@ricky0123/vad-web` or `onnxruntime-web`.
- No network access: assets are self-hosted, never from a CDN.
