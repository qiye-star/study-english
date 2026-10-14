import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { LongPressHint } from "./long-press-hint";
import { readLongPressHintSeen } from "./long-press-pref";

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  void i18n.changeLanguage("en");
});

describe("LongPressHint", () => {
  it("shows once, remembers it, and a later instance stays hidden", () => {
    const first = render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).toHaveTextContent("长按选项里的单词可查询");
    expect(readLongPressHintSeen()).toBe(true);
    first.unmount();
    render(<LongPressHint />);
    expect(screen.queryByTestId("long-press-hint")).toBeNull();
  });

  it("is not a live region (the result line is the page's only status)", () => {
    render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).not.toHaveAttribute("role");
  });

  it("keeps showing when storage is unavailable, without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<LongPressHint />);
    expect(screen.getByTestId("long-press-hint")).toBeTruthy();
  });
});
