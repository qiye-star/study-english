// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.resolve(__dirname);
const code = (f: string) => readFileSync(path.join(here, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = readdirSync(here).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f) && f !== "test-routes.tsx");

describe("chat home skin rules", () => {
  it("never renders HTML from strings (FR19)", () => {
    for (const f of sources) expect(readFileSync(path.join(here, f), "utf8"), f).not.toContain("dangerouslySetInnerHTML");
  });

  it("adds no backdrop-filter / blur utility layers (glass budget)", () => {
    for (const f of sources) {
      expect(code(f), f).not.toMatch(/backdrop-filter|backdrop-blur|glass-sheet|mat-chrome-bar/);
    }
  });

  it("does not log greeting text, facts or messages", () => {
    for (const f of sources) expect(code(f), f).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});
