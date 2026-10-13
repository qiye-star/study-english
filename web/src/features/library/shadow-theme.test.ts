import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_FILES = [
  "shadow-panel.tsx", "score-card.tsx", "analysis-card.tsx", "segment-menu.tsx", "segment-editor.tsx", "save-sentence.tsx", "shadow-fx.tsx",
].filter((f) => existsSync(path.join(here, f)));

// 十六进制色、不带 var() 的 rgb()/rgba()/hsl()、tailwind 的 white / black 色类
const FORBIDDEN: Array<[string, RegExp]> = [
  ["hex colour", /#[0-9a-fA-F]{3,8}\b/],
  ["rgb()/rgba() literal", /\brgba?\((?!\s*var\()/],
  ["hsl() literal", /\bhsla?\(/],
  ["white/black colour class", /\b(?:bg|text|border|fill|stroke|ring|from|to|via)-(?:white|black)\b/],
];

describe("shadowing UI follows the theme tokens (D12, spec §11.4a)", () => {
  it("has files to scan", () => {
    expect(UI_FILES.length).toBeGreaterThan(3);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`has no ${label} in the W2 UI sources`, () => {
      for (const file of UI_FILES) {
        const source = readFileSync(path.join(here, file), "utf8");
        expect(source.match(pattern)?.[0] ?? null, `${file}`).toBeNull();
      }
    });
  }
});
