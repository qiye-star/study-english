// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(计划 R-3):这些模块在主包里,不得静态导入懒模块、懒加载文案或样式。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["index.ts", "register.tsx"];
const LAZY_ONLY = [
  "locales", "changelog-entry", "changelog-page", "entry-card", "unread-store", "use-unread", "use-one-time-hint", "hint-pref",
  "use-changelog-list", "use-near-end", "api", "entries", "changelog.css",
];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']\.\/([^"']+)["']|(?:^|\n)\s*import\s*["']\.\/([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""));

describe("changelog stays out of the main bundle (R-3)", () => {
  it("main-bundle modules never statically import lazy modules, the copy or the css", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) expect(LAZY_ONLY, `${f} -> ./${target}`).not.toContain(target);
    }
  });

  it("the entry is reached only through import()", () => {
    expect(src("register.tsx")).toContain('import("./changelog-entry")');
  });

  it("is wired in without a new cross-feature edge", () => {
    expect(readFileSync(path.resolve(here, "../../plugins/core.ts"), "utf8")).toContain('import "~/features/changelog/register"');
    expect(readFileSync(path.resolve(here, "../practice/practice-page.tsx"), "utf8")).not.toContain("features/changelog");
    const register = src("register.tsx");
    expect(register).toContain('point: "practiceHeaderActions"');
    expect(register).not.toMatch(/\blink:|requiresLinks/); // a core contribution: visible with every learning link off
  });
});
