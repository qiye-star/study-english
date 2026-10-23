import "fake-indexeddb/auto";
import { act, configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { resetChatHomeStore } from "./chat-home-store";
import { ChatRoutesHarness, TODAY, chatHomeRoutes, goTo } from "./test-routes";

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});
beforeEach(() => { resetServerAiConfigCache(); resetChatHomeStore(); });
afterEach(() => resetChatHomeStore());

function setup(route: string, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock(chatHomeRoutes(extra));
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<ChatRoutesHarness />, { api, route, path: "*" });
  return mock;
}
const callsTo = (mock: ReturnType<typeof createFetchMock>, method: string, path: string) =>
  mock.calls.filter((c) => c.method === method && c.url.pathname === path);

describe("chat home routes (CHAT_HOME_ENABLED)", () => {
  it("on: /chat shows today's conversation in the new chrome", async () => {
    const mock = setup("/chat");
    expect(await screen.findByTestId("chat-history-open")).toBeInTheDocument();
    expect(screen.getByTestId("chat-settings-open")).toBeInTheDocument();
    expect(await screen.findByTestId("message-list")).toBeInTheDocument();
    expect(callsTo(mock, "GET", "/api/conversations/c-today")).toHaveLength(1);
    expect(callsTo(mock, "POST", "/api/chat-home/today")).toHaveLength(1);
    // the old classic chrome pieces are absent
    expect(screen.queryByTestId("conversation-options")).toBeNull();
    expect(screen.queryByTestId("conversations-empty")).toBeNull();
  });

  it("on: the title says Today and nothing carries message text or user ids in URLs", async () => {
    const mock = setup("/chat");
    await screen.findByTestId("message-list");
    expect(await screen.findByText(/^Today · /)).toBeInTheDocument();
    for (const c of mock.calls) {
      expect(c.url.search).not.toMatch(/Good morning|12345678/);
      expect([...c.url.searchParams.keys()].every((k) => ["page", "per_page", "hide_idle_daily", "tz_offset_minutes"].includes(k))).toBe(true);
    }
  });

  it("on: /chat/:id shows that conversation in the same chrome and never loads /today greetings for it", async () => {
    const mock = setup("/chat/c1");
    expect(await screen.findByTestId("chat-history-open")).toBeInTheDocument();
    expect(await screen.findByText("Trip planning")).toBeInTheDocument();
    expect(callsTo(mock, "GET", "/api/conversations/c1")).toHaveLength(1);
    expect(callsTo(mock, "POST", "/api/chat-home/today")).toHaveLength(0);
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
  });

  it("on: /chat/new is the local draft", async () => {
    const mock = setup("/chat/new");
    expect(await screen.findByTestId("chat-new")).toBeInTheDocument();
    expect(callsTo(mock, "POST", "/api/conversations")).toHaveLength(0);
  });

  it.each([
    ["off", () => json({ enabled: false, llm: false })],
    ["404", () => json({ error: "Not Found" }, 404)],
    ["error", () => new Response("boom", { status: 500 })],
  ])("flag %s: /chat is the old list page, /chat/:id the old page, /chat/new redirects", async (_name, config) => {
    const mock = setup("/chat", { "GET /api/chat-home/config": config, "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }) });
    expect(await screen.findByTestId("conversations-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-history-open")).toBeNull();
    expect(callsTo(mock, "POST", "/api/chat-home/today")).toHaveLength(0);

    act(() => goTo("/chat/c1"));
    expect(await screen.findByText("Trip planning")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-options")).toBeInTheDocument(); // classic chrome
    expect(screen.queryByTestId("chat-history-open")).toBeNull();

    act(() => goTo("/chat/new"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat"));
    expect(screen.getByTestId("location").textContent).toBe("/chat");
  });

  it("shows a busy skeleton while the flag is loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setup("/chat", { "GET /api/chat-home/config": async () => { await gate; return json({ enabled: true, llm: false }); } });
    expect(await screen.findByTestId("chat-home-loading")).toHaveAttribute("aria-busy", "true");
    release();
    expect(await screen.findByTestId("chat-history-open")).toBeInTheDocument();
  });

  it("a failed /today shows a retry and no invented conversation; the drawer still opens", async () => {
    let n = 0;
    const mock = setup("/chat", { "POST /api/chat-home/today": () => (++n === 1 ? new Response("boom", { status: 500 }) : json(TODAY)) });
    expect(await screen.findByTestId("chat-home-error")).toBeInTheDocument();
    expect(callsTo(mock, "POST", "/api/conversations")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("chat-home-retry"));
    expect(await screen.findByTestId("message-list")).toBeInTheDocument();
    expect(callsTo(mock, "POST", "/api/chat-home/today")).toHaveLength(2);
  });

  it("the history drawer opens from the top bar, closes on Esc and gives the focus back to the button", async () => {
    setup("/chat");
    const button = await screen.findByTestId("chat-history-open");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(await screen.findByTestId("chat-history-drawer")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("chat-history-drawer")).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("the settings button opens the settings sheet", async () => {
    setup("/chat");
    await userEvent.click(await screen.findByTestId("chat-settings-open"));
    expect(await screen.findByTestId("chat-settings-sheet")).toBeInTheDocument();
  });
});
