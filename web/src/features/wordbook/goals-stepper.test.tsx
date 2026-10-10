import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { GoalsStepper, STEP_DEBOUNCE_MS } from "./goals-stepper";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { vi.useRealTimers(); localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

function setup(value = 20, min = 1, max = 200, { strict = false } = {}) {
  const onCommit = vi.fn();
  const ui = <GoalsStepper label="每日新词" value={value} min={min} max={max} onCommit={onCommit} />;
  const view = renderWithProviders(strict ? <StrictMode>{ui}</StrictMode> : ui);
  return { onCommit, view };
}

describe("GoalsStepper", () => {
  it("is a labelled group with 44px keys and a numeric keyboard", () => {
    setup(1);
    expect(screen.getByRole("group", { name: "每日新词" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAccessibleDescription("范围 1–200");
    expect(screen.getByRole("button", { name: "减少每日新词" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "增加每日新词" }).className).toContain("h-tap");
    expect(screen.getByRole("button", { name: "增加每日新词" }).className).toContain("w-tap");
  });

  it("debounces taps into one commit", () => {
    vi.useFakeTimers();
    const { onCommit } = setup();
    const more = screen.getByRole("button", { name: "增加每日新词" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByRole("textbox", { name: "每日新词" })).toHaveValue("23");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(23);
  });

  it("stops at the edges of the range", () => {
    vi.useFakeTimers();
    const { onCommit } = setup(199);
    const more = screen.getByRole("button", { name: "增加每日新词" });
    fireEvent.click(more);
    expect(more).toBeDisabled();
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledWith(200);
  });

  it("commits typed full-width digits on Enter, clamped to the range", () => {
    const { onCommit } = setup();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    input.focus();
    fireEvent.change(input, { target: { value: "２５０" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(200);
    expect(input).toHaveValue("200");
  });

  it("restores the saved value when the input is not a number", () => {
    const { onCommit } = setup();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    input.focus();
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("20");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit an unchanged value", () => {
    const { onCommit } = setup();
    const input = screen.getByRole("textbox", { name: "每日新词" });
    input.focus();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("saves a pending tap when the sheet closes before the debounce fires", () => {
    vi.useFakeTimers();
    const { onCommit, view } = setup();
    fireEvent.click(screen.getByRole("button", { name: "增加每日新词" }));
    view.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(21);
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("never commits on its own under StrictMode's double mount (regression)", () => {
    vi.useFakeTimers();
    const { onCommit } = setup(20, 1, 200, { strict: true });
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS * 2); });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "增加每日新词" }));
    act(() => { vi.advanceTimersByTime(STEP_DEBOUNCE_MS); });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(21);
  });
});
