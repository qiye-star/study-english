import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { AssistEntry } from "./assist-entry";

describe("AssistEntry", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("is a round primary-colour button when closed", () => {
    const onToggle = vi.fn();
    renderWithProviders(<AssistEntry open={false} unread={false} disabled={false} onToggle={onToggle} />);
    const button = screen.getByTestId("room-assist-open");
    expect(button.className).toContain("bg-blue");
    expect(button.className).toContain("text-on-blue");
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("size-tap");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("助手");
    expect(screen.queryByTestId("assist-unread")).toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("turns tint when open", () => {
    renderWithProviders(<AssistEntry open unread={false} disabled={false} onToggle={vi.fn()} />);
    const button = screen.getByTestId("room-assist-open");
    expect(button.className).toContain("bg-blue-tint");
    expect(button.className).not.toContain("text-on-blue");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an amber dot for new suggestions", () => {
    renderWithProviders(<AssistEntry open={false} unread disabled={false} onToggle={vi.fn()} />);
    const dot = screen.getByTestId("assist-unread");
    expect(dot.className).toContain("bg-amber");
    expect(screen.getByRole("button", { name: "助手,有新建议" })).toBeTruthy();
  });

  it("can be disabled", () => {
    const onToggle = vi.fn();
    renderWithProviders(<AssistEntry open={false} unread={false} disabled onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("room-assist-open"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
