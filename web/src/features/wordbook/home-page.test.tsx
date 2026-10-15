import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { setLiquid } from "~/test/glass";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookHomePage } from "./home-page";
import { GOALS_CONFIG, GOALS_ENROLLMENT, GOALS_PLAN, GOALS_TODAY, PAUSED_TODAY } from "./goals-test-fixtures";
import { LEARNED_SUMMARY } from "./learned-test-fixtures";
import { NO_BOOK_TODAY } from "./test-fixtures";

function setup(today: unknown, extra: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(GOALS_CONFIG), "GET /api/wordbook/today": () => json(today),
    "GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY), ...extra });
  renderWithProviders(<WordbookHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
  return mock;
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookHomePage", () => {
  it("shows the book progress, today's plan and the three actions", async () => {
    setup(GOALS_TODAY);
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
    expect(screen.getByRole("button", { name: "每日目标设置" })).toBeTruthy();
    expect(screen.queryByText("今天的目标完成了")).toBeNull();
    expect(screen.queryByText("复习积压,今天少学新词")).toBeNull();
  });

  it("marks finished actions as done and not clickable", async () => {
    setup({ ...GOALS_TODAY, plan: { ...GOALS_PLAN, review_left: 0, review_done: 34 } });
    const review = await screen.findByTestId("wordbook-action-review");
    expect(review.tagName).not.toBe("A");
    expect(review).toHaveTextContent("已完成");
  });

  it("warns about a review backlog", async () => {
    setup({ ...GOALS_TODAY, plan: { ...GOALS_PLAN, review_due: 240, review_left: 100, new_left: 5, backlog_guard: true } });
    expect(await screen.findByText("复习积压,今天少学新词")).toBeTruthy();
  });

  it("links to the learned words with the total", async () => {
    setup(GOALS_TODAY);
    const row = await screen.findByTestId("wordbook-action-learned");
    expect(row).toHaveAttribute("href", "/wordbook/learned");
    await waitFor(() => expect(row).toHaveTextContent("已学 6 词"));
  });

  it("keeps the row (without a count) when the summary cannot be loaded", async () => {
    setup(GOALS_TODAY, { "GET /api/wordbook/learned/summary": () => json({ error: "Wordbook data unavailable" }, 503) });
    const row = await screen.findByTestId("wordbook-action-learned");
    expect(row).toHaveAttribute("href", "/wordbook/learned");
    expect(row).not.toHaveTextContent("已学 0");
  });

  it("does not ask for the summary before a book is chosen", async () => {
    const mock = setup(NO_BOOK_TODAY);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/books"));
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/learned/summary"))).toBe(false);
  });

  it("sends readers without a book to the book picker", async () => {
    setup(NO_BOOK_TODAY);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/books"));
  });

  it("explains a turned-off book and offers another", async () => {
    setup({ ...GOALS_TODAY, book: null, plan: null, progress: null });
    expect(await screen.findByText("这本词书已停用,换一本吧")).toBeTruthy();
    expect(screen.getByRole("link", { name: "换一本" })).toHaveAttribute("href", "/wordbook/books");
  });

  it("shows a translated error with retry", async () => {
    let fail = true;
    setup(null, { "GET /api/wordbook/today": () => (fail ? json({ error: "Wordbook data unavailable" }, 503) : json(GOALS_TODAY)) });
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

  it("shows the goal streak in the plan card", async () => {
    setup(GOALS_TODAY);
    expect(await screen.findByTestId("wordbook-streak")).toHaveTextContent("连续12 天");
  });

  it("shows a dash before the first goal day", async () => {
    setup({ ...GOALS_TODAY, streak: { current: 0, today_met: false } });
    expect(await screen.findByTestId("wordbook-streak")).toHaveTextContent("连续—");
  });

  it("shows the paused book instead of the picker and resumes it", async () => {
    let paused = true;
    const mock = setup(null, {
      "GET /api/wordbook/today": () => json(paused ? PAUSED_TODAY : GOALS_TODAY),
      "POST /api/wordbook/enrollment/resume": () => { paused = false; return json(GOALS_ENROLLMENT); },
    });
    expect(await screen.findByTestId("wordbook-paused")).toHaveTextContent("四级已暂停");
    expect(screen.queryByRole("button", { name: "每日目标设置" })).toBeNull();
    expect(screen.getByRole("link", { name: "换一本" })).toHaveAttribute("href", "/wordbook/books");
    await userEvent.click(screen.getByRole("button", { name: "继续学习" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/resume")).toBe(true));
    const call = mock.calls.find((c) => c.url.pathname === "/api/wordbook/enrollment/resume")!;
    expect(JSON.parse(String(call.body))).toEqual({ book_id: "cet4" });
    expect(await screen.findByRole("button", { name: "每日目标设置" })).toBeTruthy();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/wordbook$/);
  });

  it("explains a refused resume on the paused card", async () => {
    setup(PAUSED_TODAY, { "POST /api/wordbook/enrollment/resume": () => json({ error: "Too many settings changes today" }, 429) });
    await userEvent.click(await screen.findByRole("button", { name: "继续学习" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("今天改设置的次数太多了,明天再试");
  });

  it("works with an older server without goals keys", async () => {
    const { paused: _p, streak: _s, ...legacy } = GOALS_TODAY;
    setup(legacy);
    expect(await screen.findByTestId("wordbook-streak")).toHaveTextContent("连续—");
    await userEvent.click(screen.getByRole("button", { name: "每日目标设置" }));
    expect(await screen.findByRole("dialog", { name: "每日目标" })).toHaveTextContent("还没有连续达标");
  });
});

describe("wordbook home in the liquid skin (plan 2026-10-15-liquid-glass L9-2)", () => {
  afterEach(() => setLiquid(false));
  it("today hero with one accent CTA, ink band, plan wells and two half panels; test ids once each", async () => {
    setLiquid(true);
    setup(GOALS_TODAY);
    const review = await screen.findByTestId("wordbook-action-review");
    expect(review.className).toContain("liquid:shadow-accent");
    for (const id of ["wordbook-action-learn", "wordbook-action-spell", "wordbook-action-learned", "wordbook-tomorrow", "wordbook-streak", "wordbook-legend"]) {
      expect(screen.getAllByTestId(id), id).toHaveLength(1);
    }
    expect(screen.getByTestId("wordbook-action-learn").className).not.toContain("liquid:shadow-accent");
    expect(screen.getByRole("progressbar").innerHTML).not.toMatch(/teal/);
    expect(screen.getByTestId("wordbook-action-learned")).toHaveAttribute("href", "/wordbook/learned");
  });
});
