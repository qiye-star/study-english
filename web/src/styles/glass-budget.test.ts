// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..");
const css = readFileSync(path.join(SRC, "index.css"), "utf8");
const START = "/* ===== liquid glass (plan 2026-10-15-liquid-glass INDEX §5.3) ===== */";
const END = "/* ===== liquid glass end ===== */";
const section = css.slice(css.indexOf(START), css.indexOf(END));

/** Innermost rules: [selector, body]. Comments stripped; nested @media/@supports are flattened by matching only brace-free bodies. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (source: string) =>
  [...strip(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
const blurs = (body: string) => /(?:^|[;\s])(?:-webkit-)?backdrop-filter:\s*(?!none|\s)[^;]+;/.test(body);

const BLUR_CLASSES = ["glass", "glass-bar", "glass-float", "glass-pop", "glass-sheet", "mat-chrome", "mat-chrome-bar", "mat-sheet"];
const NEVER_BLUR = ["mat-surface", "mat-surface-strong", "mat-float", "well", "plate", "page-bg"];

/**
 * Files allowed to put a blurring material on an element (INDEX R-LG6). Each later lane appends its own lines here in
 * the same commit that adds the class; anything else fails.
 */
export const BLUR_OWNERS: Record<string, string> = {
  "components/glass-top-bar.tsx": "title capsule (E2)",
  "components/bottom-sheet.tsx": "T3 sheet (transient)",
  "components/glass-tab-bar.tsx": "frozen tab bar (.glass-float)",
  "components/liquid.ts": "LQ_DIALOG constant (T3)",
  "features/lookup/lookup-bar.tsx": "frozen lookup bar (.glass-pop)",
  "features/lookup/lookup-layer.tsx": "frozen lookup drawer (BottomSheetContent glass prop)",
  "features/agents/persona-editor-sheet.tsx": "classic .glass action bar (existing)",
  "features/wordbook/spell/spell-page.tsx": "classic .glass action bars (existing)",
  "lib/glass-flag.ts": "false positive: the \"glass\" query parameter name, not a class",
  "features/library": "locked library (own rules)",
  "features/practice/shadow": "locked shadow sheet (own rules)",
  "features/chat/conversation-page.tsx": "classic .glass composer (existing)",
  "features/rooms": "classic .glass composer/docks (existing)",
  "features/wordbook/ui.ts": "classic .glass DOCK (existing)",
  "features/realtime": "classic .glass call dock (existing)",
  "features/rank": "classic .glass match composer (existing)",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("blur budget guards (plan 2026-10-15-liquid-glass INDEX §8)", () => {
  it("has the liquid section, and every rule in it is scoped to html[data-glass=v2]", () => {
    expect(css.indexOf(START)).toBeGreaterThan(0);
    expect(css.indexOf(END)).toBeGreaterThan(css.indexOf(START));
    const selectors = rules(section).map(([sel]) => sel);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      for (const part of sel.split(",")) expect(part.trim(), sel).toMatch(/^html\[data-glass="v2"\]/);
    }
  });

  it("only .glass* and mat-chrome / mat-chrome-bar / mat-sheet ever blur in index.css", () => {
    for (const [sel, body] of rules(css)) {
      if (!blurs(body)) continue;
      for (const part of sel.split(",")) {
        expect(BLUR_CLASSES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(part)), part).toBe(true);
      }
    }
  });

  it("E1 / well / plate / float / page background never blur", () => {
    for (const [sel, body] of rules(section)) {
      if (!blurs(body)) continue;
      for (const c of NEVER_BLUR) expect(new RegExp(`\\.${c}(?![\\w-])`).test(sel), `${c} in ${sel}`).toBe(false);
    }
  });

  it("solid fallback first, blur only inside @supports, reduced transparency forces solid", () => {
    const supports = section.indexOf("@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))");
    expect(supports).toBeGreaterThan(0);
    expect(section.slice(0, supports)).not.toMatch(/backdrop-filter:\s*var/);
    const reduced = section.slice(section.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(reduced).toContain("--plate: rgb(var(--surface));");
    expect(reduced).toMatch(/\.mat-chrome-bar[\s\S]*backdrop-filter: none;/);
  });

  it("only allowlisted files use a blurring material or Tailwind backdrop-blur", () => {
    const offenders = walk(SRC).filter((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const text = readFileSync(file, "utf8");
      const usesMat = /\bmat-(?:chrome|chrome-bar|sheet)\b/.test(text) || /["'`\s]glass(?:-bar)?["'`\s]/.test(text);
      const usesTw = /\bbackdrop-blur-/.test(text) && rel !== "app.tsx" && rel !== "components/toast-classes.ts";
      const allowed = Object.keys(BLUR_OWNERS).some((k) => rel === k || rel.startsWith(`${k}/`));
      return (usesMat && !allowed) || usesTw;
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
