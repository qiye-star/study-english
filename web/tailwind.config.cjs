const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const ENJOY_CONFIG = path.resolve(__dirname, "../enjoy/tailwind.config.js");
const webRequire = createRequire(__filename);
const noopPlugin = webRequire("tailwindcss/plugin")(() => {});

function loadEnjoyConfig() {
  const source = fs.readFileSync(ENJOY_CONFIG, "utf8");
  const mod = { exports: {} };
  const requireFromWeb = (id) => (id === "@vidstack/react/tailwind.cjs" ? noopPlugin : webRequire(id));
  new Function("module", "exports", "require", source)(mod, mod.exports, requireFromWeb);
  return mod.exports;
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...loadEnjoyConfig(),
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../enjoy/src/renderer/components/ui/**/*.tsx",
    "../enjoy/src/renderer/components/pronunciation-assessments/**/*.tsx",
    "../enjoy/src/renderer/components/misc/wavesurfer-player.tsx",
  ],
};
