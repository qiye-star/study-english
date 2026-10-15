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
 * Tailwind scans source text for class candidates (test files too, so this comment must not contain the literal
 * tokens). A JS negation written right in front of one of our material utility names (the glass, mat-*, well and
 * plate utilities) is read as Tailwind's important modifier, which makes it emit a rule with an EMPTY selector
 * (esbuild then warns "Unexpected {" while minifying CSS). Write `x === false` instead of negating.
 */
describe("no accidental important-modifier candidates", () => {
  it("no non-test source negates a material utility name directly", () => {
    const re = /(?<![\w!])!(?:glass|mat-|well\b|plate\b)/;
    const bad = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => re.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(bad).toEqual([]);
  });
});
