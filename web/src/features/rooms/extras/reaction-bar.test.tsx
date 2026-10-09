import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { QuoteBar, QuoteBlock } from "./quote-block";
import { ReactionBar } from "./reaction-bar";

describe("ReactionBar", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("renders a chip per key, marks mine and toggles", () => {
    const onToggle = vi.fn();
    renderWithProviders(<ReactionBar reactions={[{ key: "like", userIds: [11, 22] }, { key: "haha", userIds: [33] }]} meId={11} onToggle={onToggle} />);
    const like = screen.getByTestId("reaction-like");
    const haha = screen.getByTestId("reaction-haha");
    expect(like.textContent).toBe("👍2");
    expect(haha.textContent).toBe("😂1");
    expect(like.className).toContain("bg-blue-tint");
    expect(like.getAttribute("aria-pressed")).toBe("true");
    expect(haha.className).not.toContain("bg-blue-tint");
    fireEvent.click(like);
    expect(onToggle).toHaveBeenLastCalledWith("like", false);
    fireEvent.click(haha);
    expect(onToggle).toHaveBeenLastCalledWith("haha", true);
  });

  it("renders nothing without reactions", () => {
    const { container } = renderWithProviders(<ReactionBar reactions={[]} meId={11} onToggle={vi.fn()} />);
    expect(container.querySelector("[data-testid^='reaction-']")).toBeNull();
    // a key with nobody left is not drawn either
    renderWithProviders(<ReactionBar reactions={[{ key: "wow", userIds: [] }]} meId={11} onToggle={vi.fn()} />);
    expect(screen.queryByTestId("reaction-wow")).toBeNull();
  });
});

describe("QuoteBlock / QuoteBar", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("shows the quoted name and text and jumps to it", () => {
    const onJump = vi.fn();
    renderWithProviders(<QuoteBlock quote={{ seq: 4, name: "bob", kind: "text", text: "What snacks do you like?" }} onJump={onJump} />);
    const block = screen.getByTestId("quote-block");
    expect(block.textContent).toContain("bob");
    expect(block.textContent).toContain("What snacks do you like?");
    fireEvent.click(block);
    expect(onJump).toHaveBeenCalledWith(4);
  });

  it("says when the quoted message was hidden and names the AI", () => {
    renderWithProviders(<QuoteBlock quote={{ seq: 4, name: "bob", kind: "text", text: "" }} onJump={vi.fn()} />);
    expect(screen.getByText("引用的消息已被隐藏")).toBeTruthy();
    renderWithProviders(<QuoteBlock quote={{ seq: 5, name: null, kind: "ai_answer", text: "It means…" }} onJump={vi.fn()} />);
    expect(screen.getByText("AI 助手")).toBeTruthy();
  });

  it("the composer bar shows who is being replied to and clears", () => {
    const onClear = vi.fn();
    renderWithProviders(<QuoteBar quote={{ seq: 4, name: "lily", kind: "text", text: "Have you tried the matcha one?" }} onClear={onClear} />);
    expect(screen.getByTestId("quote-bar").textContent).toContain("回复 lily:Have you tried the matcha one?");
    fireEvent.click(screen.getByRole("button", { name: "取消引用" }));
    expect(onClear).toHaveBeenCalled();
  });
});
