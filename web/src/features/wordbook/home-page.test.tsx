import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookHomePage } from "./home-page";
import { CONFIG, ENROLLED_TODAY, NO_BOOK_TODAY, PLAN } from "./test-fixtures";

function setup(today: unknown, extra: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(CONFIG), "GET /api/wordbook/today": () => json(today), ...extra });
  renderWithProviders(<WordbookHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
  return mock;
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookHomePage", () => {
  it("shows the book progress, today's plan and the three actions", async () => {
    setup(ENROLLED_TODAY);
    expect(await screen.findByText("四级")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "7"); // 312 / 4544 已掌握
    expect(screen.getByTestId("wordbook-legend")).toHaveTextContent("已掌握312");
    expect(screen.getByTestId("wordbook-legend")).toHaveTextContent("已学860");
    expect(screen.getByTestId("wordbook-legend")).toHaveTextContent("剩余3,684");
    expect(screen.getByTestId("wordbook-tomorrow")).toHaveTextContent("明天预计复习41");
    const review = screen.getByTestId("wordbook-action-review");
    expect(review).toHaveAttribute("href", "/wordbook/review");
    expect(review).toHaveTextContent("复习");
    expect(review).toHaveTextContent("34");
    expect(screen.getByTestId("wordbook-action-learn")).toHaveAttribute("href", "/wordbook/learn");
    expect(screen.getByTestId("wordbook-action-learn")).toHaveTextContent("12");
    expect(screen.getByTestId("wordbook-action-spell")).toHaveAttribute("href", "/wordbook/spell");
    expect(screen.getByTestId("wordbook-action-spell")).toHaveTextContent("按句拼写");
    expect(screen.getByRole("link", { name: "词书与每日设置" })).toHaveAttribute("href", "/wordbook/books");
    expect(screen.queryByText("复习积压,今天少学新词")).toBeNull();
  });

  it("marks finished actions as done and not clickable", async () => {
    setup({ ...ENROLLED_TODAY, plan: { ...PLAN, review_left: 0, review_done: 34 } });
    const review = await screen.findByTestId("wordbook-action-review");
    expect(review.tagName).not.toBe("A");
    expect(review).toHaveTextContent("已完成");
  });

  it("warns about a review backlog", async () => {
    setup({ ...ENROLLED_TODAY, plan: { ...PLAN, review_due: 240, review_left: 100, new_left: 5, backlog_guard: true } });
    expect(await screen.findByText("复习积压,今天少学新词")).toBeTruthy();
  });

  it("sends readers without a book to the book picker", async () => {
    setup(NO_BOOK_TODAY);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/books"));
  });

  it("explains a turned-off book and offers another", async () => {
    setup({ ...ENROLLED_TODAY, book: null, plan: null, progress: null });
    expect(await screen.findByText("这本词书已停用,换一本吧")).toBeTruthy();
    expect(screen.getByRole("link", { name: "换一本" })).toHaveAttribute("href", "/wordbook/books");
  });

  it("shows a translated error with retry", async () => {
    let fail = true;
    setup(null, { "GET /api/wordbook/today": () => (fail ? json({ error: "Wordbook data unavailable" }, 503) : json(ENROLLED_TODAY)) });
    expect(await screen.findByText("词书数据暂不可用,请稍后再试")).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("四级")).toBeTruthy();
  });

  it("shows the disabled message when the wordbook is off", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: false }) });
    renderWithProviders(<WordbookHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
    expect(await screen.findByText("背单词未开启")).toBeTruthy();
  });
});
