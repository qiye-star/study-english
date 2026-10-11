import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(here, file), "utf8");

describe("the learned-words page stays out of the main bundle", () => {
  it("is reached only through lazy-pages.tsx", () => {
    expect(read("lazy-pages.tsx")).toMatch(/import\("\.\/learned-page"\)/);
    for (const file of ["index.ts", "lazy-pages.tsx", "home-page.tsx"]) {
      expect(read(file)).not.toMatch(/from "\.\/learned-page"|from "\.\/free-review-sheet"|from "\.\/free-browse"/);
    }
  });
});
