// Main bundle size (spec 2026-10-12-agents R-A2): the entry <script type="module"> and its modulepreload chunks, gzip kB.
// Lazy chunks and CSS are not counted (CSS is printed for reference only).
import { gzipSync } from "node:zlib";

export function mainChunkFiles(html) {
  const entry = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/);
  if (!entry) throw new Error("no module entry script in dist/index.html");
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+\.js)"/g)].map((m) => m[1]);
  return [entry[1], ...preloads.filter((f) => f !== entry[1])];
}

export function gzipKb(buf) {
  return gzipSync(buf, { level: 9 }).length / 1000;
}

export function checkDelta(baseKb, nowKb, maxDeltaKb) {
  const delta = Math.round((nowKb - baseKb) * 100) / 100;
  return { delta, ok: delta <= maxDeltaKb };
}
