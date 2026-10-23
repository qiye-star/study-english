import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ZhDefsCover } from "./zh-defs-cover";

const Zh = () => <ul><li>说话；谈话</li></ul>;
const cover = (resetKey: unknown, active = true) => (
  <ZhDefsCover active={active} resetKey={resetKey} label="显示中文释义" offsetClassName="mt-3.5"><Zh /></ZhDefsCover>
);

describe("ZhDefsCover", () => {
  it("is a transparent pass-through when inactive: same markup, no wrapper, no testid", () => {
    const plain = render(<Zh />).container.innerHTML;
    const wrapped = render(cover("a", false));
    expect(wrapped.container.innerHTML).toBe(plain);
    expect(screen.queryByTestId("zh-defs-cover")).toBeNull();
  });

  it("hides the Chinese block in place and shows a 44 px reveal button", () => {
    render(cover("a"));
    const box = screen.getByTestId("zh-defs-cover");
    expect(box).toHaveAttribute("data-state", "hidden");
    const btn = screen.getByRole("button", { name: "显示中文释义" });
    expect(btn).toHaveAttribute("data-testid", "zh-defs-reveal");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    for (const c of ["min-h-tap", "w-full", "mt-3.5"]) expect(btn.className).toContain(c);
    const content = screen.getByText("说话；谈话").closest("[aria-hidden]")!;
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content.className).toContain("invisible");
    expect(screen.getByText("说话；谈话")).not.toBeVisible();
    const sizer = box.querySelector("[data-zh-sizer]")!;
    expect(sizer.className).toContain("min-h-tap");
    expect(sizer.className).toContain("mt-3.5");
  });

  it("uses no tint colours", () => {
    expect(readFileSync("src/components/zh-defs-cover.tsx", "utf8")).not.toContain("-tint");
  });

  it("reveals on tap without changing the box: sizer stays, content gets focus, button goes", () => {
    render(cover("a"));
    fireEvent.click(screen.getByTestId("zh-defs-reveal"));
    const box = screen.getByTestId("zh-defs-cover");
    expect(screen.queryByTestId("zh-defs-reveal")).toBeNull();
    expect(box).toHaveAttribute("data-state", "shown");
    const content = screen.getByText("说话；谈话").closest("div")!;
    expect(content).not.toHaveAttribute("aria-hidden");
    expect(content.className).not.toContain("invisible");
    expect(screen.getByText("说话；谈话")).toBeVisible();
    expect(box.querySelector("[data-zh-sizer]")).not.toBeNull();
    expect(document.activeElement).toBe(content);
  });

  it("keeps the reveal for the same resetKey and hides again on a new one", () => {
    const { rerender } = render(cover("a"));
    fireEvent.click(screen.getByTestId("zh-defs-reveal"));
    rerender(cover("a"));
    expect(screen.getByTestId("zh-defs-cover")).toHaveAttribute("data-state", "shown");
    rerender(cover("b"));
    expect(screen.getByTestId("zh-defs-cover")).toHaveAttribute("data-state", "hidden");
    expect(screen.getByTestId("zh-defs-reveal")).toBeInTheDocument();
  });
});
