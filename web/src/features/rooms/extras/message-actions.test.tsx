import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { blurLayers, setLiquid, textOutsidePlates } from "~/test/glass";
import type { RoomMessage } from "../protocol";
import { MessageActions } from "./message-actions";
import { isMostlyNative, speakable } from "./text-tools";

const m: RoomMessage = { seq: 3, id: "m3", lane: "public", kind: "text", sender: { kind: "user", id: 22, name: "bob" }, text: "What snacks do you like?",
  assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "", quote: null, voice: null, reactions: [{ key: "like", userIds: [11] }] };

describe("MessageActions", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("toggles reactions, quotes and reports", () => {
    const p = { onReact: vi.fn(), onQuote: vi.fn(), onReport: vi.fn() };
    renderWithProviders(<MessageActions message={m} mine={false} meId={11} canReport reported={false} {...p} />);
    expect(screen.getByTestId("react-like").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("react-like"));
    expect(p.onReact).toHaveBeenCalledWith("like", false);
    fireEvent.click(screen.getByTestId("react-haha"));
    expect(p.onReact).toHaveBeenLastCalledWith("haha", true);
    fireEvent.click(screen.getByTestId("msg-quote"));
    expect(p.onQuote).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "举报" }));
    expect(p.onReport).toHaveBeenCalled();
  });

  it("shows six reaction keys with glyphs and no report on own messages", () => {
    renderWithProviders(<MessageActions message={m} mine meId={22} canReport={false} reported={false} onReact={vi.fn()} onQuote={vi.fn()} onReport={vi.fn()} />);
    const keys = ["like", "love", "haha", "wow", "clap", "thanks"];
    for (const k of keys) expect(screen.getByTestId(`react-${k}`).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("react-like").textContent).toBe("👍");
    expect(screen.queryByTestId("room-report")).toBeNull();
    // 译 / 朗读 only when the list provides them
    expect(screen.queryByTestId("msg-translate")).toBeNull();
    expect(screen.queryByTestId("msg-speak")).toBeNull();
  });

  it("shows translate and read-aloud when provided, and the reported state", () => {
    const onTranslate = vi.fn();
    const onSpeak = vi.fn();
    renderWithProviders(<MessageActions message={m} mine={false} meId={11} canReport reported onReact={vi.fn()} onQuote={vi.fn()} onReport={vi.fn()}
      onTranslate={onTranslate} translateOpen onSpeak={onSpeak} speakState="playing" />);
    expect(screen.getByTestId("msg-translate").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("msg-translate"));
    expect(onTranslate).toHaveBeenCalled();
    expect(screen.getByTestId("msg-speak").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("msg-speak"));
    expect(onSpeak).toHaveBeenCalled();
    expect(screen.queryByTestId("room-report")).toBeNull();
    expect(screen.getByText("已举报")).toBeTruthy();
  });

  it("is one transient glass popup under the liquid skin, with its text on the sheet plate (rule 4)", () => {
    setLiquid(true);
    try {
      renderWithProviders(<MessageActions message={m} mine={false} meId={11} canReport reported={false} onReact={vi.fn()} onQuote={vi.fn()} onReport={vi.fn()}
        onTranslate={vi.fn()} onSpeak={vi.fn()} />);
      const popup = screen.getByTestId("msg-actions");
      expect(blurLayers()).toEqual([popup]);
      expect(popup.className).toContain("mat-sheet");
      expect(popup.className).toContain("liquid:rounded-tile");
      expect(textOutsidePlates(popup)).toEqual([]);
      expect(screen.getByTestId("msg-quote").className).toContain("liquid:rounded-full");
    } finally {
      setLiquid(false);
    }
  });

  it("knows when a message is already in the native language", () => {
    expect(isMostlyNative("我也喜欢巧克力", "zh-CN")).toBe(true);
    expect(isMostlyNative("I like 巧克力 a lot", "zh-CN")).toBe(false);
    expect(isMostlyNative("我也喜欢", "en-US")).toBe(false);
    expect(isMostlyNative("", "zh-CN")).toBe(false);
  });

  it("reads the English part of an AI answer and drops a leading @ai", () => {
    expect(speakable({ ...m, kind: "ai_answer", text: "It means starting a talk.\n中文:打破僵局。\n更多说明" })).toBe("It means starting a talk.");
    expect(speakable({ ...m, text: "@ai what does it mean?" })).toBe("what does it mean?");
    expect(speakable(m)).toBe("What snacks do you like?");
  });
});
