// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const enjoyCss = read("../../../enjoy/src/index.css");
const webCss = read("./theme.css");

function tokens(css: string, selector: ":root" | ".dark"): Record<string, string> {
  const pattern = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("theme tokens", () => {
  it.each([":root", ".dark"] as const)("%s matches enjoy/src/index.css", (selector) => {
    const expected = tokens(enjoyCss, selector);
    expect(Object.keys(expected).length).toBeGreaterThan(15);
    expect(tokens(webCss, selector)).toEqual(expected);
  });
});
