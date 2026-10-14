import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { PhrasesSection } from "./phrases-section";

const PHRASES = [{ en: "talk about", zh: "谈论" }, { en: "talk back", zh: "顶嘴" }];

beforeEach(() => { localStorage.clear(); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { void i18n.changeLanguage("en"); });

describe("PhrasesSection · showZh (R-Z3)", () => {
  it("shows the translations by default (other pages unchanged)", () => {
    render(<PhrasesSection phrases={PHRASES} mode />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("talk about 谈论");
  });

  it("hides the translations in the summary and in the list when showZh is false", async () => {
    render(<PhrasesSection phrases={PHRASES} mode={false} showZh={false} />);
    const summary = document.querySelector("summary")!;
    expect(summary).toHaveTextContent("talk about");
    expect(summary).not.toHaveTextContent("谈论");
    await userEvent.click(summary);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("talk about");
    expect(items[0]).not.toHaveTextContent("谈论");
    expect(items[1]).not.toHaveTextContent("顶嘴");
  });
});
