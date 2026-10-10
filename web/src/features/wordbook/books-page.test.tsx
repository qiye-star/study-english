import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WordbookBooksPage } from "./books-page";
import { BOOKS, CONFIG, ENROLLED_TODAY, ENROLLMENT, NO_BOOK_TODAY } from "./test-fixtures";

function setup(extra: Parameters<typeof createFetchMock>[0] = {}, today: unknown = ENROLLED_TODAY) {
  const mock = createFetchMock({
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/books": () => json(BOOKS),
    "GET /api/wordbook/today": () => json(today),
    "PUT /api/wordbook/enrollment": () => json({ ...ENROLLMENT, book_id: "cet6" }),
    ...extra,
  });
  renderWithProviders(<WordbookBooksPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/books" });
  return mock;
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookBooksPage", () => {
  it("lists the books with level, counts and the current mark", async () => {
    setup();
    const cet4 = await screen.findByRole("button", { name: /四级/ });
    expect(cet4).toHaveTextContent("当前");
    expect(cet4).toHaveTextContent("4,544 词 · 掌握 312");
    expect(cet4).toHaveAttribute("aria-current", "true");
    const cet6 = screen.getByRole("button", { name: /六级/ });
    expect(cet6).not.toHaveTextContent("当前");
    expect(cet6).toHaveTextContent("3,991 词");
    expect(within(cet6).getByRole("img")).toHaveAccessibleName("难度 4/6");
    expect(screen.getByText("难度条按词书大致排序;数据里没有词频,只是参考。")).toBeTruthy();
  });

  it("picks a book with daily settings and goes home", async () => {
    const mock = setup();
    await userEvent.click(await screen.findByRole("button", { name: /六级/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("六级 · 每日设置")).toBeTruthy();
    const daily = within(sheet).getByRole("radiogroup", { name: "每天新词" });
    expect(within(daily).getAllByRole("radio").map((r) => r.textContent)).toEqual(["10", "20", "30", "50"]);
    expect(within(daily).getByRole("radio", { name: "20" })).toHaveAttribute("aria-checked", "true");
    expect(within(within(sheet).getByRole("radiogroup", { name: "每天复习上限" })).getAllByRole("radio").map((r) => r.textContent)).toEqual(["50", "100", "200"]);
    expect(within(within(sheet).getByRole("radiogroup", { name: "新词顺序" })).getByRole("radio", { name: "乱序" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(sheet).getByRole("button", { name: "开始" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/wordbook$/));
    const put = mock.calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(String(put.body))).toEqual({ book_id: "cet6", daily_new: 20, review_cap: 100, order_mode: "shuffle" });
  });

  it("sends the chosen settings", async () => {
    const mock = setup({}, NO_BOOK_TODAY);
    await userEvent.click(await screen.findByRole("button", { name: /六级/ }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("radio", { name: "30" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "200" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "书序" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "开始" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = mock.calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(String(put.body))).toEqual({ book_id: "cet6", daily_new: 30, review_cap: 200, order_mode: "book" });
  });

  it("back goes to Practice for a user without a book (the home page would bounce straight back here)", async () => {
    setup({}, NO_BOOK_TODAY);
    await screen.findByRole("button", { name: /六级/ });
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/practice$/));
  });

  it("back goes to the wordbook home once a book is chosen", async () => {
    setup();
    await screen.findByRole("button", { name: /四级/ });
    await waitFor(() => expect(screen.getByRole("button", { name: /四级/ })).toHaveTextContent("当前"));
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(/^\/wordbook$/));
  });

  it("keeps the sheet open and shows the error when saving fails", async () => {
    setup({ "PUT /api/wordbook/enrollment": () => json({ error: "Book not found" }, 404) });
    await userEvent.click(await screen.findByRole("button", { name: /六级/ }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "开始" }));
    expect(await within(sheet).findByText("这本词书不存在或已停用")).toBeTruthy();
    expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/books");
  });
});
