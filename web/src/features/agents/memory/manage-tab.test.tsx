import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { json } from "~/test/fetch-mock";
import { STATE } from "./test-fixtures";
import { REVOKE_DELAY_MS, saveBlob } from "./manage-tab";
import { setupMemory } from "./test-setup";

const ROUTE = "/me/agents/memory?tab=manage";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); vi.restoreAllMocks(); });

describe("saveBlob", () => {
  it("revokes the object URL only well after the click so iOS Safari can start the download", () => {
    vi.useFakeTimers();
    try {
      const revoke = vi.fn();
      Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: revoke });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      saveBlob(new Blob(["{}"]), "memory.json");
      vi.advanceTimersByTime(1000);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(REVOKE_DELAY_MS);
      expect(revoke).toHaveBeenCalledWith("blob:x");
      expect(REVOKE_DELAY_MS).toBeGreaterThanOrEqual(30_000);
    } finally { vi.useRealTimers(); }
  });
});

describe("ManageTab", () => {
  it("pauses memory and exports JSON", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:memory");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const mock = setupMemory({
      "PATCH /api/agents/settings": () => json({}),
      "GET /api/agents/memory/export": () => new Response('{"version":1}', { headers: { "Content-Type": "application/json" } }),
    }, ROUTE);
    const toggle = await screen.findByRole("switch", { name: "记住新内容" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText("已暂停:不会记住新内容,回复时也不使用记忆。")).toBeTruthy();
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/agents/settings")!.body))).toEqual({ memory_enabled: false });
    await user.click(screen.getByRole("button", { name: "导出 JSON" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已开始下载。")).toBeTruthy();
  });

  it("clears everything only after the second confirmation", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({
      "DELETE /api/agents/memory": () => json({ scope: "all", deleted: { items: 2, recaps: 1, threads: 0, profile: true } }),
    }, ROUTE);
    await user.click(await screen.findByRole("button", { name: "清空全部记忆" }));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确定清空全部记忆?");
    expect(dialog).toHaveTextContent("此操作不能撤销。");
    await user.click(within(dialog).getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "DELETE")!.body))).toEqual({ confirm: true, scope: "all" });
    expect(await screen.findByText("已清空 2 条记忆。")).toBeTruthy();
  });

  it("keeps the status line and the tab content while the profile reloads after clearing everything", async () => {
    const user = userEvent.setup();
    let profileCalls = 0;
    let releaseReload: (() => void) | undefined;
    setupMemory({
      "GET /api/agents/memory/profile": async () => {
        if (++profileCalls > 1) await new Promise<void>((resolve) => { releaseReload = resolve; });
        return json(STATE);
      },
      "DELETE /api/agents/memory": () => json({ scope: "all", deleted: { items: 2, recaps: 1, threads: 0, profile: true } }),
    }, ROUTE);
    await user.click(await screen.findByRole("button", { name: "清空全部记忆" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "确认清空" }));
    expect(await screen.findByText("已清空 2 条记忆。")).toBeTruthy();
    await waitFor(() => expect(profileCalls).toBe(2));
    expect(screen.queryByTestId("memory-loading")).toBeNull();
    expect(screen.getByText("已清空 2 条记忆。")).toBeTruthy();
    releaseReload?.();
  });

  it("cancelling the sheet sends nothing", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({}, ROUTE);
    await user.click(await screen.findByRole("button", { name: "清空全部记忆" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("clears one persona's memory after confirming", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({
      "DELETE /api/agents/memory": () => json({ scope: "persona", deleted: { items: 1, recaps: 0, threads: 0, profile: false } }),
    }, ROUTE);
    const select = await screen.findByRole("combobox");
    expect(screen.getByRole("button", { name: "清空这个角色的记忆" })).toBeDisabled();
    await user.selectOptions(select, "builtin:coach");
    await user.click(screen.getByRole("button", { name: "清空这个角色的记忆" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确定清空「英语教练」的记忆?");
    await user.click(within(dialog).getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "DELETE")!.body)))
      .toEqual({ confirm: true, scope: "persona", persona_id: "builtin:coach" });
  });

  it("closes the sheet and shows the error when clearing fails", async () => {
    const user = userEvent.setup();
    setupMemory({ "DELETE /api/agents/memory": () => json({ error: "Confirmation required" }, 400) }, ROUTE);
    await user.click(await screen.findByRole("button", { name: "清空全部记忆" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "确认清空" }));
    expect(await screen.findByText("需要再次确认。")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when the administrator turned memory off", async () => {
    setupMemory({ "GET /api/agents/memory/profile": () => json({ ...STATE, memory_available: false }) }, ROUTE);
    expect(await screen.findByText("管理员暂时关闭了记忆功能:已有记忆仍可查看、导出和删除。")).toBeTruthy();
  });
});
