import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { DEFS_EN, card } from "./test-fixtures";
import { WordCardView } from "./word-card";
import type { Card } from "./wordbook-api";

const WITH_DEFS = { ...card("talk", { senses: [{ pos: "v", text: "说话；谈话" }], phrases: [{ en: "talk about", zh: "谈论" }] }), defsEn: DEFS_EN } as unknown as Card;

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  void i18n.changeLanguage("zh-CN");
});
afterEach(() => {
  localStorage.removeItem("enjoy-web.settings");
  void i18n.changeLanguage("en");
});

describe("WordCardView · controlled 中文 chip (R-Z2)", () => {
  it("replaces the small 中 switch with the chip and hides phrase translations until peek", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" peek={false} onPeek={vi.fn()} />);
    expect(screen.queryByTestId("def-peek")).toBeNull();
    expect(screen.getByTestId("after-zh")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("word-card")).not.toHaveTextContent("说话；谈话");
    expect(document.querySelector("summary")).not.toHaveTextContent("谈论");
  });

  it("follows the peek prop", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="en" peek onPeek={vi.fn()} />);
    expect(screen.getByTestId("word-card")).toHaveTextContent("说话；谈话");
    expect(document.querySelector("summary")).toHaveTextContent("谈论");
  });

  it("has no chip under 'both'", () => {
    renderWithProviders(<WordCardView card={WITH_DEFS} defLang="both" peek={false} onPeek={vi.fn()} />);
    expect(screen.queryByTestId("after-zh")).toBeNull();
  });
});
