// Usage (after yarn web:build): node scripts/check-main-bundle.mjs [--record] [--max-delta=0.8]
// Default budget 0.8 kB: plan 2026-10-27 Addendum (word spelling copy is eager; measured +0.69 kB).
// --record writes the current value as the baseline (only on the commit the plan names; commit main-bundle-baseline.json).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDelta, gzipKb, mainChunkFiles } from "./main-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const baselinePath = path.join(here, "main-bundle-baseline.json");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const files = mainChunkFiles(html);
const kb = Math.round(files.reduce((sum, f) => sum + gzipKb(readFileSync(path.join(dist, f))), 0) * 100) / 100;
const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+\.css)"/g)].map((m) => m[1]);
const cssKb = Math.round(css.reduce((sum, f) => sum + gzipKb(readFileSync(path.join(dist, f))), 0) * 100) / 100;
console.log(`main bundle: ${kb} kB gzip (${files.join(", ")}); css ${cssKb} kB gzip (not budgeted)`);
if (process.argv.includes("--record")) {
  writeFileSync(baselinePath, `${JSON.stringify({ gzipKb: kb, cssGzipKb: cssKb, recordedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`baseline recorded: ${baselinePath}`);
  process.exit(0);
}
const maxArg = process.argv.find((a) => a.startsWith("--max-delta="));
const max = maxArg ? Number(maxArg.split("=")[1]) : 0.8;
const base = JSON.parse(readFileSync(baselinePath, "utf8"));
const { delta, ok } = checkDelta(base.gzipKb, kb, max);
console.log(`delta vs baseline ${base.gzipKb} kB: ${delta >= 0 ? "+" : ""}${delta} kB (budget ${max} kB)`);
if (!ok) process.exit(1);
