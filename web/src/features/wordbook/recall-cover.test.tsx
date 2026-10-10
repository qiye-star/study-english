import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { RatingBadge, RecallRatingBar } from "./recall-rating-bar";
import { card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const TALK = card("talk", { senses: [{ pos: "v", text: "说话；谈话" }] }) as unknown as Card;

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("covered word card (spec recall §3.1)", () => {
  it("keeps the meaning out of the DOM until the cover button is pressed", async () => {
    const onReveal = vi.fn();
    renderWithProviders(<WordCardView card={TALK} covered onReveal={onReveal} />);
    const cover = screen.getByRole("button", { name: /显示释义/ });
    expect(cover).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(cover.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("They talk a lot.");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("talk about");
    // 朗读键仍在(词头与音标不遮)
    expect(screen.getByRole("button", { name: "朗读美音" })).toBeTruthy();
    await userEvent.setup().click(cover);
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("renders the meaning region with the same id once uncovered", () => {
    renderWithProviders(<WordCardView card={TALK} />);
    expect(screen.queryByTestId("recall-cover")).toBeNull();
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-card")).toHaveTextContent("They talk a lot.");
  });

  it("hides the example when showExample is off", () => {
    renderWithProviders(<WordCardView card={TALK} showExample={false} />);
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("They talk a lot.");
  });

  it("shows a badge next to the eyebrow", () => {
    renderWithProviders(<WordCardView card={TALK} eyebrow="新词 1 / 5" badge={<RatingBadge rating="know" check />} />);
    expect(screen.getByTestId("rating-badge")).toHaveTextContent("认识 · 本轮抽查");
    expect(screen.getByText("新词 1 / 5")).toBeTruthy();
  });

  it("rating bar: three labelled buttons; the peek note describes 认识", async () => {
    const onRate = vi.fn();
    renderWithProviders(<RecallRatingBar onRate={onRate} busy={false} peeked />);
    const know = screen.getByRole("button", { name: "认识" });
    expect(know).toHaveAccessibleDescription("已看过释义:点「认识」会记为「模糊」");
    await userEvent.setup().click(screen.getByRole("button", { name: "模糊" }));
    expect(onRate).toHaveBeenCalledWith("fuzzy");
    expect(screen.getByRole("button", { name: "不认识" })).toBeEnabled();
  });

  it("rating bar without a peek has no note and disables while busy", () => {
    renderWithProviders(<RecallRatingBar onRate={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: "认识" })).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: "认识" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "你认识这个词吗?" })).toBeTruthy();
  });
});
