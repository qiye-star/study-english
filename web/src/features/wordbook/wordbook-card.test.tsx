import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookCard } from "./wordbook-card";
import { WordbookMeRow } from "./me-row";
import { CONFIG, ENROLLED_TODAY, NO_BOOK_TODAY, PLAN } from "./test-fixtures";

function client(routes: Parameters<typeof createFetchMock>[0]) {
  return new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(routes).fetch });
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookCard", () => {
  it("renders nothing when the wordbook is disabled", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    const { container } = renderWithProviders(<WordbookCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid=wordbook-card]")).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/today")).toBe(false);
  });

  it("asks to pick a book when there is no enrollment", async () => {
    const api = client({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(NO_BOOK_TODAY) });
    renderWithProviders(<WordbookCard />, { api });
    expect(await screen.findByRole("link", { name: "选择词书" })).toHaveAttribute("href", "/wordbook/books");
    expect(screen.getByText("选一本词书,每天 20 个新词")).toBeTruthy();
  });

  it("shows today's plan and starts with reviews", async () => {
    const api = client({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(ENROLLED_TODAY) });
    renderWithProviders(<WordbookCard />, { api });
    expect(await screen.findByText("四级")).toBeTruthy();
    expect(screen.getByText("8/20")).toBeTruthy();
    expect(screen.getByText("待复习 34 · 新词还剩 12")).toBeTruthy();
    expect(screen.getByRole("link", { name: "开始复习 34" })).toHaveAttribute("href", "/wordbook/review");
    expect(screen.getByRole("link", { name: "拼写练习" })).toHaveAttribute("href", "/wordbook/spell");
    expect(screen.getByText("已掌握 312 / 4,544")).toBeTruthy();
  });

  it("offers new words once reviews are done, then reports the day as done", async () => {
    const learn = { ...ENROLLED_TODAY, plan: { ...PLAN, review_left: 0, review_done: 34 } };
    const api = client({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(learn) });
    const view = renderWithProviders(<WordbookCard />, { api });
    expect(await screen.findByRole("link", { name: "学新词 12" })).toHaveAttribute("href", "/wordbook/learn");
    view.unmount();
    const done = { ...ENROLLED_TODAY, plan: { ...PLAN, review_left: 0, new_left: 0, new_done: 20 } };
    renderWithProviders(<WordbookCard />, { api: client({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(done) }) });
    expect(await screen.findByRole("link", { name: "今日完成" })).toHaveAttribute("href", "/wordbook");
  });
});

describe("WordbookMeRow", () => {
  it("links to the wordbook with the book and mastered count, and a due badge", async () => {
    const api = client({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(ENROLLED_TODAY) });
    renderWithProviders(<WordbookMeRow />, { api });
    const row = await screen.findByTestId("me-wordbook");
    expect(row).toHaveAttribute("href", "/wordbook");
    expect(row).toHaveTextContent("背单词");
    await waitFor(() => expect(row).toHaveTextContent("四级 · 已掌握 312 词"));
    expect(row).toHaveTextContent("34");
  });

  it("renders nothing when disabled", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    renderWithProviders(<WordbookMeRow />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("me-wordbook")).toBeNull();
  });
});
