import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { BoxBar } from "./box-bar";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

const BY = { learning: 3, growing: 2, mastered: 1 };

describe("BoxBar", () => {
  it("shows the three tiers with counts and marks the selected one", () => {
    render(<BoxBar by={BY} value="growing" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "新学 3 词" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "巩固中 2 词" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "熟练 1 词" })).toBeTruthy();
  });

  it("selects a tier and clears it when the active one is pressed again", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<BoxBar by={BY} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    expect(onChange).toHaveBeenLastCalledWith("mastered");
    rerender(<BoxBar by={BY} value="mastered" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders without dividing by zero when nothing is learned", () => {
    render(<BoxBar by={{ learning: 0, growing: 0, mastered: 0 }} value={null} onChange={() => {}} />);
    expect(screen.getByTestId("box-bar")).toBeTruthy();
  });
});
