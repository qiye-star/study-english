import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const BASE = { senses: [{ pos: "v", text: "说话；谈话" }, { pos: "n", text: "交谈" }], phrases: [] };
const WITH_DEFS = { ...card("talk", BASE), defsEn: DEFS_EN } as unknown as Card;
const PLAIN = card("talk", BASE) as unknown as Card;
const OTHER = { ...card("walk", { senses: [{ pos: "v", text: "走路" }] }), defsEn: [{ pos: "v", text: "move on foot" }] } as unknown as Card;
const peek = () => screen.queryByTestId("def-peek");

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("the 中 peek switch on a word card", () => {
  it("shows only for English-only cards that have both languages, once revealed", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(peek()).toBeTruthy();
    expect(peek()).toHaveAccessibleName("显示中文释义");
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(peek()).toHaveTextContent("中");
  });

  it.each(["both", "zh"] as const)("is absent in %s mode", (mode) => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang={mode} />);
    expect(peek()).toBeNull();
  });

  it("is absent for a card that fell back to Chinese (no English definitions: nothing to switch)", () => {
    renderWithProviders(<WordCardView card={PLAIN} defLang="en" />);
    expect(peek()).toBeNull();
    expect(screen.getByText("说话；谈话")).toBeTruthy();
  });

  it("is not rendered while the card is covered (the Chinese meaning is not in the DOM)", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" covered onReveal={() => {}} />);
    expect(peek()).toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
  });

  it("toggles the Chinese rows for this card only, keeping the English rows", async () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(screen.queryByText("说话；谈话")).toBeNull();
    await userEvent.click(peek()!);
    expect(peek()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    expect(screen.getByTestId("word-defs-en")).toBeTruthy();
    await userEvent.click(peek()!);
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("说话；谈话")).toBeNull();
  });

  it("resets when the card changes", async () => {
    function Pair() {
      const [word, setWord] = useState<Card>(WITH_DEFS);
      return (<><button type="button" onClick={() => setWord(OTHER)}>next</button><WordCardView card={word} defLang="en" /></>);
    }
    renderWithProviders(<Pair />);
    await userEvent.click(peek()!);
    expect(screen.getByText("说话；谈话")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "next" }));
    expect(peek()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("走路")).toBeNull();
  });

  it("sits at the top right next to the badge, with a 44 px target and no storage writes", async () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" badge={<span data-testid="badge">模糊</span>} />);
    const button = peek()!;
    expect(button.className).toContain("h-tap");
    expect(button.className).toContain("w-tap");
    expect(button.className).toContain("motion-reduce:transition-none");
    expect(button.parentElement).toBe(screen.getByTestId("badge").parentElement); // same right-hand group
    expect(button.parentElement!.parentElement!.className).toContain("justify-between");
    await userEvent.click(button);
    expect(Object.keys(localStorage)).toEqual(["enjoy-web.settings"]); // nothing written: not the server, not the device
  });

  it("renders the toggle without an eyebrow or a badge too", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" />);
    expect(peek()!.parentElement!.parentElement!.className).toContain("justify-between");
  });
});
