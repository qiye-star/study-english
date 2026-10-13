import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { matchesBook } from "./goals-sheet";
import { GOAL_MET_TODAY, GOALS_CONFIG, GOALS_ENROLLMENT, GOALS_PLAN, GOALS_TODAY } from "./goals-test-fixtures";
import { WordbookHomePage } from "./home-page";

function setup(initial: unknown = GOALS_TODAY, extra: Record<string, Handler> = {}, { strict = false } = {}) {
  let current = initial;
  const mock = createFetchMock({
    "GET /api/wordbook/config": () => json(GOALS_CONFIG),
    "GET /api/wordbook/today": () => json(current),
    "PATCH /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT),
    ...extra,
  });
  const ui = strict ? <StrictMode><WordbookHomePage /></StrictMode> : <WordbookHomePage />;
  renderWithProviders(ui, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
  return { mock, serve: (next: unknown) => { current = next; } };
}

async function openSheet() {
  await userEvent.click(await screen.findByRole("button", { name: "每日目标设置" }));
  return screen.findByRole("dialog", { name: "每日目标" });
}

const body = (mock: ReturnType<typeof setup>["mock"], path: string) =>
  JSON.parse(String(mock.calls.find((c) => c.url.pathname === path)!.body));
const count = (mock: ReturnType<typeof setup>["mock"], method: string, path: string) =>
  mock.calls.filter((c) => c.method === method && c.url.pathname === path).length;

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("GoalsSheet definitions setting", () => {
  it("contains the definitions segmented control, 仅英文 by default", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByRole("radiogroup", { name: "释义显示" })).toBeTruthy();
    expect(within(sheet).getByRole("radio", { name: "仅英文" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("GoalsSheet", () => {
  it("opens from both gears, traps focus and gives focus back on close", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByText("四级 · 剩余 3,684 词 · 改动立即生效")).toBeTruthy();
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    await userEvent.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "每日目标设置" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "调整今天的目标" }));
    expect(await screen.findByRole("dialog", { name: "每日目标" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "调整今天的目标" })).toHaveFocus());
  });

  it("applies a new goal at once, then trusts the server", async () => {
    const { mock, serve } = setup();
    const sheet = await openSheet();
    serve({ ...GOALS_TODAY, enrollment: { ...GOALS_ENROLLMENT, daily_new: 30 }, plan: { ...GOALS_PLAN, new_target: 30, new_left: 22 } });
    await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: "每日新词" })).getByRole("radio", { name: "30" }));
    expect(within(sheet).getByTestId("goals-today")).toHaveTextContent("新词 8 / 30 · 还能学 22 个");
    await waitFor(() => expect(mock.calls.filter((c) => c.url.pathname === "/api/wordbook/today")).toHaveLength(2));
    expect(body(mock, "/api/wordbook/enrollment")).toEqual({ daily_new: 30 });
    expect(screen.getByTestId("wordbook-action-learn")).toHaveTextContent("22");
    expect(within(sheet).getByText("已保存")).toBeTruthy();
  });

  it("rolls back a refused change and says why", async () => {
    setup(GOALS_TODAY, { "PATCH /api/wordbook/enrollment": () => json({ error: "Daily new words out of range" }, 422) });
    const sheet = await openSheet();
    const daily = within(sheet).getByRole("radiogroup", { name: "每日新词" });
    await userEvent.click(within(daily).getByRole("radio", { name: "50" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("每日新词超出允许范围");
    expect(within(daily).getByRole("radio", { name: "20" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wordbook-action-learn")).toHaveTextContent("12");
  });

  it("explains why extra words are not available yet and shows the streak", async () => {
    setup();
    const sheet = await openSheet();
    expect(within(sheet).getByRole("button", { name: "加练 10 个" })).toBeDisabled();
    expect(within(sheet).getByText("先学完今天剩下的 12 个新词")).toBeTruthy();
    expect(within(sheet).getByTestId("goals-streak")).toHaveTextContent("连续达标 12 天 · 今天还差 12 个新词");
  });

  it("grants extra words from the goal banner and starts learning", async () => {
    const { mock } = setup(GOAL_MET_TODAY, {
      "POST /api/wordbook/bonus": () => json({ plan: { ...GOALS_PLAN, new_target: 30, new_done: 20, new_left: 10, bonus: 10, goal_met: true }, bonus_left: 40 }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "今天加练" }));
    const sheet = await screen.findByRole("dialog", { name: "每日目标" });
    expect(within(sheet).getByTestId("goals-streak")).toHaveTextContent("今天已达标");
    expect(within(sheet).getByText("今天还可加练 50 个")).toBeTruthy();
    await userEvent.click(within(sheet).getByRole("button", { name: "加练 10 个" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/learn"));
    expect(body(mock, "/api/wordbook/bonus")).toMatchObject({ size: 10 });
  });

  it("hides the goal banner when the admin turned extra words off", async () => {
    let served = false;
    const mock = createFetchMock({
      "GET /api/wordbook/config": () => json({ ...GOALS_CONFIG, limits: { ...GOALS_CONFIG.limits, bonus_max: 0 } }),
      "GET /api/wordbook/today": () => { served = true; return json(GOAL_MET_TODAY); },
    });
    renderWithProviders(<WordbookHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook" });
    await screen.findByTestId("wordbook-streak");
    expect(served).toBe(true);
    await waitFor(() => expect(screen.queryByText("今天的目标完成了")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "每日目标设置" }));
    const sheet = await screen.findByRole("dialog", { name: "每日目标" });
    expect(within(sheet).getByText("管理员关闭了加练")).toBeTruthy();
  });

  it("pauses after confirmation", async () => {
    const { mock } = setup(GOALS_TODAY, { "POST /api/wordbook/enrollment/pause": () => json({ ...GOALS_ENROLLMENT, status: "paused" }) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "暂停这本书" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "暂停这本书" })).toHaveFocus());
    await userEvent.click(within(sheet).getByRole("button", { name: "暂停这本书" }));
    const alert = await screen.findByRole("alertdialog", { name: "暂停四级?" });
    await userEvent.click(within(alert).getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/pause")).toBe(true));
  });

  it("resets only after the book name is typed", async () => {
    const { mock } = setup(GOALS_TODAY, { "POST /api/wordbook/enrollment/reset": () => json({ removed: 860, enrollment: GOALS_ENROLLMENT }) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "重置进度" }));
    const alert = await screen.findByRole("alertdialog", { name: "重置四级的进度?" });
    expect(alert).toHaveTextContent("本书已学 860 词");
    const confirm = within(alert).getByRole("button", { name: "重置进度" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(alert).getByRole("textbox", { name: "输入「四级」确认" }), "四级");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/enrollment/reset")).toBe(true));
    expect(body(mock, "/api/wordbook/enrollment/reset")).toMatchObject({ book_id: "cet4", confirm: "四级" });
  });

  it("keeps the reset dialog open with the server's reason, and Esc cancels it", async () => {
    setup(GOALS_TODAY, { "POST /api/wordbook/enrollment/reset": () => json({ error: "Daily reset limit reached" }, 429) });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "重置进度" }));
    const alert = await screen.findByRole("alertdialog", { name: "重置四级的进度?" });
    await userEvent.type(within(alert).getByRole("textbox"), "CET-4");
    await userEvent.click(within(alert).getByRole("button", { name: "重置进度" }));
    expect(await within(alert).findByRole("alert")).toHaveTextContent("今天重置次数已达上限");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog", { name: "每日目标" })).toBeTruthy();
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "重置进度" })).toHaveFocus());
  });

  it("waits for the input method to finish composing before comparing the name", async () => {
    setup();
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "重置进度" }));
    const alert = await screen.findByRole("alertdialog", { name: "重置四级的进度?" });
    const input = within(alert).getByRole("textbox", { name: "输入「四级」确认" });
    const confirm = within(alert).getByRole("button", { name: "重置进度" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "四级" } });
    expect(confirm).toBeDisabled();
    fireEvent.compositionEnd(input);
    expect(confirm).toBeEnabled();
  });

  it("sends one request per tap under StrictMode (double-mount regression)", async () => {
    const { mock } = setup(GOAL_MET_TODAY, {
      "POST /api/wordbook/bonus": () => json({ plan: { ...GOALS_PLAN, new_target: 25, new_done: 20, new_left: 5, bonus: 5, goal_met: true }, bonus_left: 45 }),
    }, { strict: true });
    const sheet = await openSheet();
    await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: "顺序" })).getByRole("radio", { name: "书序" }));
    await waitFor(() => expect(count(mock, "PATCH", "/api/wordbook/enrollment")).toBe(1));
    await userEvent.click(within(within(sheet).getByRole("radiogroup", { name: "加练数量" })).getByRole("radio", { name: "5" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "加练 5 个" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/learn"));
    expect(count(mock, "PATCH", "/api/wordbook/enrollment")).toBe(1);
    expect(count(mock, "POST", "/api/wordbook/bonus")).toBe(1);
  });

  it("matches the book by Chinese name, English name or id", () => {
    const book = { id: "cet4", titleZh: "四级", titleEn: "CET-4" };
    expect(["四级", " cet-4 ", "CET4"].map((s) => matchesBook(s, book))).toEqual([true, true, true]);
    expect(["六级", "", "cet"].map((s) => matchesBook(s, book))).toEqual([false, false, false]);
  });
});
