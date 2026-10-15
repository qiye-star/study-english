// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 计划 2026-10-14-floating-glass-bottom-bar R-F5:选词操作条浮在悬浮底栏上方 16px(--tab-bar-space 已含 8px 间距 + 0.5rem)。 */
const src = readFileSync(fileURLToPath(new URL("./lookup-bar.tsx", import.meta.url)), "utf8");

describe("LookupBar offset", () => {
  it("sits above the floating tab bar through the shared variable, not a hard-coded height", () => {
    expect(src).toContain("bottom-[calc(var(--tab-bar-space)+0.5rem)]");
    expect(src).not.toContain("4.5rem");
    expect(src).not.toContain("safe-area-inset-bottom");
  });
  it("is a floating rounded glass pill above the tab bar (plan 2026-10-15 R-G1, R-G2)", () => {
    for (const cls of ["glass-pop", "pop-halo", "h-[54px]", "rounded-[27px]", "p-1", "z-40", "select-none"]) expect(src).toContain(cls);
    for (const cls of ["bg-surface", "shadow-lg", "border-border", "rounded-full border"]) expect(src).not.toContain(cls);
  });
});
