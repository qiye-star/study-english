import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GlassTabBar, TAB_BAR_SPACE, tabBarItemClass } from "./glass-tab-bar";

describe("GlassTabBar (plan 2026-10-14-floating-glass-bottom-bar R-F2, R-F8)", () => {
  it("is a floating rounded glass pill inset from the screen edges", () => {
    render(<GlassTabBar label="Main" columns={5}><li>a</li></GlassTabBar>);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const cls = nav.className.split(/\s+/);
    for (const c of ["glass-float", "absolute", "inset-x-3", "bottom-[var(--tab-bar-bottom)]", "z-30", "mx-auto", "h-16", "max-w-screen-sm", "rounded-dock", "p-[3px]"]) {
      expect(cls, c).toContain(c);
    }
    // 旧的全宽贴边配方不再出现:不叠第二套玻璃、没有顶部发丝线;安全区由 --tab-bar-bottom 负责
    for (const c of ["glass", "glass-edge-t", "inset-x-0", "bottom-0"]) expect(cls, c).not.toContain(c);
    expect(nav.className).not.toContain("safe-area");
    // 不对模糊元素本身做动画(design-notes)
    expect(nav.className).not.toMatch(/\b(transition|animate)/);
    const list = screen.getByRole("list");
    expect(list.className).toMatch(/\bh-14\b/);
    expect(list.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("passes extra classes through", () => {
    render(<GlassTabBar label="Main" columns={3} className="test-extra"><li>a</li></GlassTabBar>);
    expect(screen.getByRole("navigation").className).toMatch(/\btest-extra\b/);
  });

  it("exposes the reserved space as one CSS variable", () => {
    expect(TAB_BAR_SPACE).toBe("var(--tab-bar-space)");
  });

  it("keeps 56px targets with a halo, and gives only the active item a concentric pill", () => {
    const on = tabBarItemClass(true).split(/\s+/);
    const off = tabBarItemClass(false).split(/\s+/);
    for (const cls of [on, off]) for (const c of ["tab-halo", "min-h-14", "rounded-[24px]", "focus-visible:ring-inset"]) expect(cls, c).toContain(c);
    expect(on).toEqual(expect.arrayContaining(["bg-[var(--tab-on)]", "text-blue", "font-semibold"]));
    expect(off).toEqual(expect.arrayContaining(["text-ink-2", "font-medium"]));
    expect(off).not.toContain("bg-[var(--tab-on)]");
  });
});
