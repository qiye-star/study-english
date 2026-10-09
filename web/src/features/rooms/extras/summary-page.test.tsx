import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ROOM } from "../room-fixtures";
import { RoomSummaryPage } from "./summary-page";

const DONE = { status: "done", reason: null as string | null, overview_zh: "大家聊了周末吃什么,你点单的句子很自然。", created_at: "", finished_at: "",
  words: [{ en: "noodles", zh: "面条", example: "I tried the new noodle place." }],
  my_fixes: [{ seq: 3, original: "I want a ice latte big.", better: "Could I get a large iced latte, please?", note_zh: "点单用 Could I get…" }] };

function setup(routes: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/rooms/r1": () => json({ room: { ...ROOM, name: "美食角", status: "closed", code: null }, members: [] }),
    "GET /api/rooms/r1/summary": () => json({ summary: DONE }),
    "POST /api/vocabulary": (call) => json({ id: "v1", ...JSON.parse(call.body as string), example: null, box: 0, due_at: "", reps: 0, lapses: 0, last_reviewed_at: null, created_at: "" }),
    ...routes,
  });
  renderWithProviders(<RoomSummaryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1/summary", path: "/rooms/r/:roomId/summary" });
  return mock;
}

describe("RoomSummaryPage", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("shows the overview, my fixes and new words, and adds a word to vocabulary", async () => {
    const mock = setup();
    expect(await screen.findByText("大家聊了周末吃什么,你点单的句子很自然。")).toBeTruthy();
    expect(screen.getByText("学习小结")).toBeTruthy();
    expect(await screen.findByText(/美食角/)).toBeTruthy();
    expect(screen.getByText("I want a ice latte big.")).toBeTruthy();
    expect(screen.getByText("Could I get a large iced latte, please?")).toBeTruthy();
    expect(screen.getByText("仅你可见")).toBeTruthy();
    const row = screen.getByTestId("summary-word-0");
    expect(row.textContent).toContain("noodles");
    expect(row.textContent).toContain("面条");
    fireEvent.click(within(row).getByRole("button", { name: "加入词汇本" }));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname === "/api/vocabulary")).toBe(true));
    const body = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/vocabulary")!.body as string);
    expect(body).toMatchObject({ word: "noodles", meaning: "面条", example: "I tried the new noodle place.", source: "recap" });
  });

  it("says the summary is being generated", async () => {
    setup({ "GET /api/rooms/r1/summary": () => json({ summary: { status: "pending" } }) });
    expect(await screen.findByText("正在生成小结…")).toBeTruthy();
  });

  it("explains a skipped summary", async () => {
    setup({ "GET /api/rooms/r1/summary": () => json({ summary: { status: "skipped", reason: "few_messages" } }) });
    expect(await screen.findByText("这次聊得不多,没有生成小结")).toBeTruthy();
  });

  it("offers a retry when generation failed", async () => {
    const mock = setup({
      "GET /api/rooms/r1/summary": () => json({ summary: { status: "failed", reason: null } }),
      "POST /api/rooms/r1/summary/retry": () => json({ summary: DONE }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "重试" }));
    expect(await screen.findByText("大家聊了周末吃什么,你点单的句子很自然。")).toBeTruthy();
    expect(mock.calls.some((c) => c.url.pathname === "/api/rooms/r1/summary/retry")).toBe(true);
  });

  it("tells the user when the room is still open", async () => {
    setup({ "GET /api/rooms/r1/summary": () => json({ error: "Room is still open" }, 409) });
    expect(await screen.findByText("房间还没结束,结束后才有小结")).toBeTruthy();
  });
});
