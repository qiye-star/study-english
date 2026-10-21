// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 主包守卫(计划 L5 W2,写法同 library-lazy.test.ts):主包模块不得静态导入懒模块(文案、页面、工具包装)。
 * dubbing-api.ts 是小而纯的 HTTP 层,主包允许导入。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["index.ts", "config.ts", "use-dubbing-enabled.ts"];
const LAZY_ONLY = ["locales", "loader", "kit-context", "dub-home-page", "dub-item-page"];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']\.\/([^"']+)["']|(?:^|\n)\s*import\s*["']\.\/([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""));

describe("dubbing stays out of the main bundle (plan L5 W2)", () => {
  it("main-bundle modules never statically import lazy modules", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) {
        expect(LAZY_ONLY, `${f} -> ./${target}`).not.toContain(target);
      }
    }
  });

  it("the kit loader is reached only through import(), and the kit is never statically imported by main", () => {
    expect(src("loader.ts")).toContain("loadDubbingKit()");
    expect(src("loader.ts")).toContain('from "~/features/library"');
    for (const f of MAIN) expect(src(f), f).not.toContain("features/library");
    expect(src("index.ts")).not.toMatch(/export\s+(\*|\{[^}]*\})\s+from\s+["']\.\/loader["']/);
  });
});
