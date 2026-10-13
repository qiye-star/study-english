import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { DoubleTapHint } from "./double-tap-hint";
import { readDoubleTapHintSeen } from "./double-tap-pref";

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  void i18n.changeLanguage("en");
});

describe("DoubleTapHint", () => {
  it("shows once, remembers it, and a later instance stays hidden", () => {
    const first = render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("双击选项可查词");
    expect(readDoubleTapHintSeen()).toBe(true);
    first.unmount();
    render(<DoubleTapHint />);
    expect(screen.queryByTestId("double-tap-hint")).toBeNull();
  });

  it("keeps showing for the whole question under StrictMode (the remembered flag is written after the first render)", () => {
    render(<StrictMode><DoubleTapHint /></StrictMode>);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });

  it("speaks English too", () => {
    void i18n.changeLanguage("en");
    render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toHaveTextContent("Double-tap an option to look it up");
  });

  it("does not crash when storage is unavailable (it just shows every time)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const { unmount } = render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
    unmount();
    render(<DoubleTapHint />);
    expect(screen.getByTestId("double-tap-hint")).toBeTruthy();
  });
});
