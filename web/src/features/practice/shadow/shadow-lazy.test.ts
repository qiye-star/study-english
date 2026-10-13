// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(R-S09):这些模块在主包里,不得静态导入弹窗块、文案、样式或效果。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["shadow-context.tsx", "shadow-host.tsx", "../use-shadow-session.ts", "../index.ts"];
const LAZY_ONLY = ["shadow-sheet", "shadow-result", "shadow-fx", "word-tap", "shadow-locales", "shadow-sheet.css"];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""))
    .map((p) => p.replace(/^\.\/(shadow\/)?/, "").replace(/^\.\.\/shadow\//, ""));

describe("the shadow sheet stays out of the main bundle (R-S09)", () => {
  it("main-bundle modules never statically import the lazy chunk, its copy, styles or effects", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) {
        expect(LAZY_ONLY, `${f} -> ${target}`).not.toContain(target);
      }
    }
  });

  it("the host reaches the sheet only through import()", () => {
    const host = src("shadow-host.tsx");
    expect(host).toContain('import("./shadow-sheet")');
    expect(host).toContain("lazy(");
    expect(host).not.toMatch(/from\s*["']\.\/shadow-sheet["']/);
  });

  it("the practice barrel exports the provider, host and hook, never the lazy modules or the session hook", () => {
    const index = src("../index.ts");
    expect(index).toContain('from "./shadow/shadow-context"');
    expect(index).toContain('from "./shadow/shadow-host"');
    for (const lazy of ["shadow-sheet", "shadow-result", "shadow-fx", "word-tap", "shadow-locales", "use-shadow-session"]) {
      expect(index, lazy).not.toContain(lazy);
    }
  });

  it("the sheet chunk pulls in its own copy and styles", () => {
    const sheet = src("shadow-sheet.tsx");
    expect(sheet).toContain('import "./shadow-locales";');
    expect(sheet).toContain('import "./shadow-sheet.css";');
    expect(src("shadow-result.tsx")).toContain('import "./shadow-locales";');
  });

  it("the copy is not in the eager i18n files and the lazy locales are not under an i18n directory", () => {
    expect(src("../i18n/en.json")).not.toContain('"shadow"');
    expect(src("../i18n/zh-CN.json")).not.toContain('"shadow"');
    expect(path.basename(path.dirname(path.join(here, "locales", "en.json")))).toBe("locales");
  });

  it("the app shell mounts the provider around the shell and the host beside the lookup layer", () => {
    const shell = readFileSync(path.resolve(here, "../../../layout/app-shell.tsx"), "utf8");
    expect(shell).toContain('from "~/features/practice"');
    expect(shell).toContain("<ShadowSheetProvider>");
    expect(shell).toContain("<ShadowSheetHost />");
    expect(shell.indexOf("<LookupLayer />")).toBeLessThan(shell.indexOf("<ShadowSheetHost />"));
  });

  it("test/render.tsx stays light: it never imports the practice feature (R-S05)", () => {
    const render = readFileSync(path.resolve(here, "../../../test/render.tsx"), "utf8");
    expect(render).not.toContain("features/practice");
  });
});
