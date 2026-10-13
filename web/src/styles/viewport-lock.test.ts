// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 计划 2026-10-13-ios-keyboard-scroll:外壳固定 + 触屏输入框 16px。jsdom 没有布局,这里只断言样式源码;
 * 固定外壳在 iOS 上是否真的止住跳动,由真机清单判定(未验证)。
 */
const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

const decls = (body: string) =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe("document shell is locked (R-K5, R-K6)", () => {
  const lock = css.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? "";
  const d = decls(lock);

  it("html and body are fixed to the viewport and cannot scroll or rubber-band", () => {
    expect(d.position).toBe("fixed");
    expect(d.inset).toBe("0");
    expect(d.width).toBe("100%");
    expect(d.overflow).toBe("hidden");
    expect(d["overscroll-behavior"]).toBe("none");
  });

  it("the lock lives in @layer base next to the height rule", () => {
    const base = css.slice(css.indexOf("@layer base"), css.indexOf("@font-face"));
    expect(base).toMatch(/html,\s*body\s*\{[^}]*position:\s*fixed/);
    expect(base).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%/);
  });
});

describe("touch inputs are at least 16px so iOS does not zoom on focus (R-K4)", () => {
  const rule = css.match(/@media \(pointer: coarse\)\s*\{\s*input,\s*textarea,\s*select\s*\{([^}]*)\}/);

  it("exists, covers input / textarea / select and is !important", () => {
    expect(rule, "the (pointer: coarse) rule is missing").not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*16px\s*!important/);
  });

  it("sits outside @layer so it also beats utility classes such as text-sm / text-body", () => {
    const at = css.indexOf("@media (pointer: coarse)");
    const before = css.slice(0, at);
    const opened = (before.match(/@layer[^{]*\{/g) ?? []).length;
    // 每个 @layer 块的括号都已闭合:数大括号平衡
    const balance = [...before].reduce((n, c) => n + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
    expect(opened).toBeGreaterThan(0);
    expect(balance).toBe(0);
  });
});
