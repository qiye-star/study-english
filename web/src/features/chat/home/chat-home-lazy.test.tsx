// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.resolve(__dirname);
const read = (file: string) => readFileSync(path.join(here, file), "utf8");
const imports = (src: string) => [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

describe("chat home stays out of the main bundle", () => {
  it("routes.tsx loads the shell lazily and statically imports nothing heavy from home/", () => {
    const src = read("routes.tsx");
    expect(src).toMatch(/lazy\(\(\) => import\("\.\/chat-home-shell"\)\)/);
    const staticHome = imports(src).filter((s) => s.startsWith("./"));
    expect(staticHome).toEqual(["./use-chat-home-config"]);
  });

  it("register-chat-home.tsx only dynamically imports the open effect", () => {
    const src = read("../register-chat-home.tsx");
    expect(imports(src).filter((s) => s.startsWith("./"))).toEqual([]);
    expect(src).toMatch(/import\("\.\/home\/open-effect"\)/);
  });

  it("the shell lazy-loads the greeting modal", () => {
    const src = read("chat-home-shell.tsx");
    if (src.includes("GreetingModal")) {
      expect(imports(src).some((s) => s.includes("greeting-modal"))).toBe(false);
      expect(src).toMatch(/lazy\(\(\) => import\("\.\/greeting-modal"\)/);
    }
  });
});
