import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { QuoteBar, QuoteBlock } from "./quote-block";

describe("quotes of voice messages (review m2)", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("labels an untranscribed voice message instead of calling it hidden", () => {
    const voice = { seq: 4, name: "bob", kind: "voice", text: "" };
    renderWithProviders(<><QuoteBlock quote={voice} onJump={vi.fn()} /><QuoteBar quote={voice} onClear={vi.fn()} /></>);
    expect(screen.getByTestId("quote-block").textContent).toContain("语音消息");
    expect(screen.getByTestId("quote-bar").textContent).toContain("语音消息");
    expect(document.body.textContent).not.toContain("已被隐藏");
  });

  it("still says hidden for a text message whose snapshot was cleared", () => {
    renderWithProviders(<QuoteBlock quote={{ seq: 4, name: "bob", kind: "text", text: "" }} onJump={vi.fn()} />);
    expect(screen.getByTestId("quote-block").textContent).toContain("引用的消息已被隐藏");
  });
});
