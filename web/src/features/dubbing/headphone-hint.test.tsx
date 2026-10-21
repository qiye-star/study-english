import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeadphoneHint } from "./headphone-hint";

const TEXT = /Wear headphones/;

describe("headphone hint (plan L5 R14: shown once, localStorage read/write wrapped)", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the first time, and is remembered after 'Got it'", () => {
    const { unmount } = render(<HeadphoneHint />);
    expect(screen.getByText(TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(TEXT)).toBeNull();
    unmount();
    render(<HeadphoneHint />);
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("when storage throws, it shows every time and never crashes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<HeadphoneHint />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(TEXT)).toBeNull();
  });
});
