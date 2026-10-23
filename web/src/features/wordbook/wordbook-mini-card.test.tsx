import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookMiniCard } from "./wordbook-mini-card";
import { CONFIG, ENROLLED_TODAY, NO_BOOK_TODAY } from "./test-fixtures";

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  renderWithProviders(<WordbookMiniCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookMiniCard", () => {
  it("renders nothing when the wordbook is disabled", async () => {
    const mock = setup({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    await waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("wordbook-mini-card")).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/today")).toBe(false);
  });

  it("shows the due count and mastery on one line, linking to /wordbook", async () => {
    setup({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(ENROLLED_TODAY) });
    const card = await screen.findByTestId("wordbook-mini-card");
    expect(card).toHaveAttribute("href", "/wordbook");
    expect(card.textContent).toContain("34");
    expect(card.textContent).toContain("待复习");
    expect(card.textContent).toContain("已掌握 312 / 4,544");
  });

  it("shows a dash and a hint before a book is chosen", async () => {
    setup({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(NO_BOOK_TODAY) });
    const card = await screen.findByTestId("wordbook-mini-card");
    expect(card.textContent).toContain("—");
    expect(card.textContent).toContain("选一本词书开始背");
  });
});
