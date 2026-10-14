// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "changelog.css"), "utf8");

describe("changelog.css", () => {
  it("animates the ring with transform and opacity only and stops it under reduced motion", () => {
    expect(css).toContain("@keyframes cl-pop");
    const keyframes = css.slice(css.indexOf("@keyframes cl-pop"), css.indexOf("}", css.indexOf("100%")) + 1);
    expect(keyframes).toMatch(/transform:\s*scale\(/);
    expect(keyframes).not.toMatch(/(width|height|top|left|margin)\s*:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cl-ring\s*\{\s*animation:\s*none/);
  });

  it("colours the library tag in light and dark from the mockup, and adds no blur layer", () => {
    expect(css).toMatch(/\.cl-tag-library\s*\{[^}]*#efe9ff[^}]*#6a3df0/i);
    expect(css).toMatch(/\.dark \.cl-tag-library\s*\{[^}]*rgba\(183, 156, 255, 0\.16\)[^}]*#b79cff/i);
    expect(css).not.toContain("backdrop-filter");
  });

  it("has the hint bubble with its arrow", () => {
    expect(css).toMatch(/\.cl-hint\s*\{/);
    expect(css).toMatch(/\.cl-hint::after\s*\{/);
  });
});
