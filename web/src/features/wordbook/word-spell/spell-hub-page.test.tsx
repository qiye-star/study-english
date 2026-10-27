import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { WordbookSpellHubPage } from "./spell-hub-page";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });

describe("WordbookSpellHubPage", () => {
  it("offers sentence spelling and word spelling as two entries", () => {
    renderWithProviders(<WordbookSpellHubPage />);
    expect(screen.getByTestId("wordbook-spell-sentences")).toHaveAttribute("href", "/wordbook/spell/sentences");
    expect(screen.getByTestId("wordbook-spell-sentences")).toHaveTextContent("例句拼写");
    expect(screen.getByTestId("wordbook-spell-words")).toHaveAttribute("href", "/wordbook/spell/words");
    expect(screen.getByTestId("wordbook-spell-words")).toHaveTextContent("单词拼写");
  });
});
