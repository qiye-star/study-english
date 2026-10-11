// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkDelta, gzipKb, mainChunkFiles } from "../../scripts/main-bundle.mjs";

describe("main bundle size check (spec 2026-10-12-agents R-A2)", () => {
  it("counts the entry script and its modulepreload chunks, never lazy chunks or CSS", () => {
    const html = [
      '<script type="module" crossorigin src="/assets/index-AbC12.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-x9.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-Q1.css">',
    ].join("\n");
    expect(mainChunkFiles(html)).toEqual(["assets/index-AbC12.js", "assets/vendor-x9.js"]);
  });

  it("fails loudly when the page has no module entry", () => {
    expect(() => mainChunkFiles("<html></html>")).toThrow(/entry/);
  });

  it("measures gzip in kB and compares against the baseline with the 0.2 kB budget", () => {
    expect(gzipKb(new TextEncoder().encode("a".repeat(10_000)))).toBeLessThan(1);
    expect(checkDelta(514.33, 514.5, 0.2)).toEqual({ delta: 0.17, ok: true });
    expect(checkDelta(514.33, 514.6, 0.2)).toEqual({ delta: 0.27, ok: false });
    expect(checkDelta(514.33, 510, 0.2).ok).toBe(true);
  });
});
