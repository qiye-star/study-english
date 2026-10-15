import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { TapLookupHint } from "./tap-lookup-hint";
import { readTapLookupHintSeen } from "./tap-lookup-pref";

beforeEach(() => {
  localStorage.clear();
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  vi.restoreAllMocks();
  void i18n.changeLanguage("en");
});

describe("TapLookupHint", () => {
  it("shows once, remembers it, and a later instance stays hidden", () => {
    const first = render(<TapLookupHint />);
    expect(screen.getByTestId("tap-lookup-hint")).toHaveTextContent("点一下单词会出现横线,再点一次查词");
    expect(readTapLookupHintSeen()).toBe(true);
    first.unmount();
    render(<TapLookupHint />);
    expect(screen.queryByTestId("tap-lookup-hint")).toBeNull();
  });

  it("speaks English too", async () => {
    await i18n.changeLanguage("en");
    render(<TapLookupHint />);
    expect(screen.getByTestId("tap-lookup-hint")).toHaveTextContent("Tap a word to underline it, tap again to look it up");
  });

  it("is not a live region (the result line is the page's only status)", () => {
    render(<TapLookupHint />);
    expect(screen.getByTestId("tap-lookup-hint")).not.toHaveAttribute("role");
  });

  it("keeps showing when storage is unavailable, without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<TapLookupHint />);
    expect(screen.getByTestId("tap-lookup-hint")).toBeTruthy();
  });
});
