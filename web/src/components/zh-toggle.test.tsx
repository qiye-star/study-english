import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ZhToggle } from "./zh-toggle";

describe("ZhToggle (plan 2026-10-14-review-bilingual-longpress R-Z2)", () => {
  it("is a 44 px toggle button named by its visible label, with aria-pressed", async () => {
    const onToggle = vi.fn();
    const { rerender } = render(<ZhToggle pressed={false} onToggle={onToggle} label="中文" />);
    const btn = screen.getByRole("button", { name: "中文" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(btn).toHaveAttribute("data-testid", "zh-toggle");
    expect(btn.className).toMatch(/\bmin-h-tap\b/);
    expect(btn.className).toMatch(/\bmin-w-tap\b/);
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ZhToggle pressed onToggle={onToggle} label="中文" />);
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
  });

  it("takes a test id and extra classes from the caller", () => {
    render(<ZhToggle pressed={false} onToggle={vi.fn()} label="Chinese" testId="after-zh" className="mt-2.5" />);
    const btn = screen.getByTestId("after-zh");
    expect(btn).toHaveTextContent("Chinese");
    expect(btn.className).toMatch(/\bmt-2\.5\b/);
  });
});
