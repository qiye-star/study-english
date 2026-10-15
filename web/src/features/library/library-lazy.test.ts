// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(计划 R-L23):这些模块在主包里,不得静态导入懒模块、懒加载文案、视觉层或动效。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["index.ts", "lazy-pages.tsx", "use-library-enabled.ts", "config.ts", "page-status.tsx"];
const LAZY_ONLY = [
  "locales", "library-api", "library-list-page", "player-page", "upload-store", "upload-client", "use-media-player", "library-root", "library.css",
  "catalog-api", "catalog-view", "catalog-card", "use-catalog", "delete-item-dialog",
];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']\.\/([^"']+)["']|(?:^|\n)\s*import\s*["']\.\/([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""));

describe("library stays out of the main bundle (R-L23)", () => {
  it("main-bundle modules never statically import lazy modules, the lazy copy, the visual layer or effects", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) {
        expect(LAZY_ONLY, `${f} -> ./${target}`).not.toContain(target);
        expect(target.startsWith("fx/"), `${f} -> ./${target}`).toBe(false);
      }
    }
  });

  it("pages are reached only through import()", () => {
    const lazy = src("lazy-pages.tsx");
    expect(lazy).toContain('import("./library-list-page")');
    expect(lazy).toContain('import("./player-page")');
    expect(src("index.ts")).toContain('from "./lazy-pages"');
    expect(src("index.ts")).toContain('from "./use-library-enabled"');
  });

  it("app.tsx mounts both routes", () => {
    const app = readFileSync(path.resolve(here, "../../app.tsx"), "utf8");
    expect(app).toContain('path="/library"');
    expect(app).toContain('path="/library/:id"');
  });

  it("the entry is the bottom tab: no practiceHome card, no plugin registration (spec E9, R-L24)", () => {
    expect(existsSync(path.join(here, "register.tsx"))).toBe(false);
    expect(existsSync(path.join(here, "entry-card.tsx"))).toBe(false);
    expect(readFileSync(path.resolve(here, "../../plugins/index.ts"), "utf8")).not.toContain("features/library");
    const nav = readFileSync(path.resolve(here, "../../layout/bottom-nav.tsx"), "utf8");
    expect(nav).toContain('from "~/features/library"');
    expect(nav).toContain("useLibraryEnabled");
  });
});
