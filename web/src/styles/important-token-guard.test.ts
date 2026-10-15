// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/**
 * Tailwind scans source text for class candidates. A JS negation written next to one of our material utilities
 * (`!glass`, `!well`, ...) is read as the important modifier `!glass`, which makes Tailwind emit a rule with an
 * EMPTY selector (esbuild then warns "Unexpected {" while minifying CSS). Write `x === false` instead.
 */
describe("no accidental important-modifier candidates", () => {
  it("no non-test source has !glass / !mat-* / !well / !plate", () => {
    const re = /(?<![\w!])!(?:glass|mat-|well\b|plate\b)/;
    const bad = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(bad).toEqual([]);
  });
});
