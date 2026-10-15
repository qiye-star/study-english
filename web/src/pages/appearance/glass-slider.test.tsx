import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GlassSlider } from "./glass-slider";

describe("GlassSlider (plan 2026-10-15-liquid-glass L3)", () => {
  it("is a labelled native range with units in aria-valuetext and a 44px hit area", () => {
    const onChange = vi.fn();
    render(<GlassSlider id="blur" label="模糊" value={1} min={0} max={1.5} step={0.05} format={(v) => `${Math.round(24 * v)} px`} onChange={onChange} hint="E2" />);
    const input = screen.getByRole("slider", { name: "模糊" });
    expect(input).toHaveAttribute("aria-valuetext", "24 px");
    expect(input.className).toMatch(/\bh-11\b/);
    expect(screen.getByText("24 px")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(1.5);
  });

  it("shows a warning hint and can be disabled", () => {
    render(<GlassSlider id="t" label="透明度" value={100} min={0} max={100} step={1} format={String} onChange={() => {}} hint="已到可读下限" warn disabled />);
    expect(screen.getByRole("slider", { name: "透明度" })).toBeDisabled();
    expect(screen.getByText("已到可读下限").className).toContain("text-amber");
  });
});
