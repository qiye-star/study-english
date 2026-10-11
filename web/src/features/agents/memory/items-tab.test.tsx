import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { json } from "~/test/fetch-mock";
import { ITEM_A, ITEM_B, PAGE } from "./test-fixtures";
import { setupMemory } from "./test-setup";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("ItemsTab", () => {
  it("shows the source label, filters by type and pins", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({
      "POST /api/agents/memory/items/b/pin": () => json({ ...ITEM_B, pinned: true }),
    }, "/me/agents/memory?tab=items");
    const a = await screen.findByTestId("memory-item-a");
    expect(a).toHaveTextContent("准备雅思口语考试");
    expect(a).toHaveTextContent("所有角色共享");
    expect(screen.getByTestId("memory-item-b")).toHaveTextContent("英语教练");
    await user.click(screen.getByRole("button", { name: "弱点" }));
    await waitFor(() => expect(mock.calls.at(-1)!.url.searchParams.get("kind")).toBe("weakness"));
    expect(screen.getByRole("button", { name: "弱点" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(await screen.findByTestId("memory-item-b")).getByRole("button", { name: "置顶" }));
    await waitFor(() => expect(within(screen.getByTestId("memory-item-b")).getByRole("button", { name: "取消置顶" }))
      .toHaveAttribute("aria-pressed", "true"));
    expect(screen.getAllByTestId(/^memory-item-/)[0]).toHaveAttribute("data-testid", "memory-item-b");
  });

  it("deletes only after the second step, and says it is permanent", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({ "DELETE /api/agents/memory/items/a": () => json({ id: "a" }) }, "/me/agents/memory?tab=items");
    await user.click(within(await screen.findByTestId("memory-item-a")).getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("删除是永久的,不能撤销。");
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByTestId("memory-item-a")).toBeNull());
    expect(screen.getByText("已永久删除,之后不会再自动记住这条。")).toBeTruthy();
    expect(mock.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("cancelling the delete sheet keeps the item and sends nothing", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({}, "/me/agents/memory?tab=items");
    await user.click(within(await screen.findByTestId("memory-item-a")).getByRole("button", { name: "删除" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("memory-item-a")).toBeTruthy();
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("shows a deleted persona and loads more pages", async () => {
    const user = userEvent.setup();
    let page = 0;
    setupMemory({
      "GET /api/agents/memory/items": () => json(page++ === 0
        ? { ...PAGE, items: [{ ...ITEM_B, persona: { id: "gone", name: null } }], next_cursor: "1" }
        : { ...PAGE, items: [ITEM_A], next_cursor: null }),
    }, "/me/agents/memory?tab=items");
    expect(await screen.findByText(/已删除的角色/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByTestId("memory-item-a")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("shows the empty state", async () => {
    setupMemory({ "GET /api/agents/memory/items": () => json({ items: [], next_cursor: null, persona_counts: [] }) }, "/me/agents/memory?tab=items");
    expect(await screen.findByText("还没有长期记忆。和智能体多聊几次,它会记住对你有用的事。")).toBeTruthy();
  });

  it("never puts memory text in a request URL", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({}, "/me/agents/memory?tab=items");
    await screen.findByTestId("memory-item-a");
    await user.click(screen.getByRole("button", { name: "目标" }));
    await waitFor(() => expect(mock.calls.at(-1)!.url.searchParams.get("kind")).toBe("goal"));
    for (const call of mock.calls) expect(decodeURIComponent(call.url.href)).not.toContain("雅思");
  });
});

describe("RecapsTab", () => {
  it("lists recaps with their source and deletes one after confirming", async () => {
    const user = userEvent.setup();
    setupMemory({ "DELETE /api/agents/memory/recaps/r1": () => json({ id: "r1" }) }, "/me/agents/memory?tab=recaps");
    const recap = await screen.findByTestId("memory-recap-r1");
    expect(recap).toHaveTextContent("带我学回顾");
    expect(recap).toHaveTextContent("8 题答对 6 题");
    await user.click(within(recap).getByRole("button", { name: "删除回顾" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByTestId("memory-recap-r1")).toBeNull());
    expect(screen.getByText("已永久删除这条回顾。")).toBeTruthy();
  });
});
