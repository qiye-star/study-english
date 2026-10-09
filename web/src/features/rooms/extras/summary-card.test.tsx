import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { SummaryCard } from "./summary-card";

const DONE = { status: "done", reason: null as string | null, overview_zh: "聊了美食。", created_at: "", finished_at: "",
  words: [{ en: "noodles", zh: "面条", example: "I love noodles." }, { en: "spicy", zh: "辣的", example: "Too spicy!" }, { en: "to go", zh: "外带", example: "To go, please." }],
  my_fixes: [{ seq: 3, original: "I want a ice latte big.", better: "Could I get a large iced latte?", note_zh: "点单用 Could I get…" }, { seq: 5, original: "How much is it all?", better: "How much is that altogether?", note_zh: "altogether" }] };

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  renderWithProviders(<SummaryCard roomId="r1" />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}

describe("SummaryCard", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => {
    vi.useRealTimers();
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
  });

  it("polls while pending and links to the summary when done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = "pending";
    const mock = setup({ "GET /api/rooms/r1/summary": () => json({ summary: status === "pending" ? { status: "pending" } : DONE }) });
    expect(await screen.findByText("正在生成小结…")).toBeTruthy();
    status = "done";
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const link = await screen.findByRole("link", { name: "查看" });
    expect(link.getAttribute("href")).toBe("/rooms/r/r1/summary");
    expect(screen.getByTestId("summary-card").textContent).toContain("学习小结");
    expect(screen.getByTestId("summary-card").textContent).toContain("3 个新词");
    expect(screen.getByTestId("summary-card").textContent).toContain("2 句可以说得更好");
    expect(mock.calls.filter((c) => c.url.pathname === "/api/rooms/r1/summary")).toHaveLength(2);
  });

  it("stops polling after a minute and says to come back later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mock = setup({ "GET /api/rooms/r1/summary": () => json({ summary: { status: "pending" } }) });
    await screen.findByText("正在生成小结…");
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(await screen.findByText("小结还在生成,稍后再来看")).toBeTruthy();
    const n = mock.calls.length;
    expect(n).toBeLessThanOrEqual(21);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mock.calls.length).toBe(n);
  });

  it("retries a failed summary", async () => {
    const mock = setup({
      "GET /api/rooms/r1/summary": () => json({ summary: { status: "failed", reason: "format" } }),
      "POST /api/rooms/r1/summary/retry": () => json({ summary: DONE }),
    });
    expect(await screen.findByText("小结生成失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname === "/api/rooms/r1/summary/retry")).toBe(true));
    expect(await screen.findByRole("link", { name: "查看" })).toBeTruthy();
  });

  it("renders nothing when skipped, missing or unavailable", async () => {
    const mock = setup({ "GET /api/rooms/r1/summary": () => json({ summary: { status: "skipped", reason: "few_messages" } }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("summary-card")).toBeNull();
  });

  it("renders nothing on an error (e.g. old server without the endpoint)", async () => {
    const mock = setup({});
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("summary-card")).toBeNull();
  });
});
