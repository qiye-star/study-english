import "fake-indexeddb/auto";
import type { ComponentProps } from "react";
import { act, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { resetChatHomeStore } from "./chat-home-store";
import { CHAT_HOME_SHOWN_KEY } from "./chat-home-cache";
import { requestToday } from "./chat-home-store";
import { resetChatPrefsCache } from "./use-chat-prefs";
import { ChatRoutesHarness, FIRST_VIEW, SEEN_TODAY, chatHomeRoutes, goTo } from "./test-routes";

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});
beforeEach(() => { resetServerAiConfigCache(); resetChatHomeStore(); resetChatPrefsCache(); localStorage.removeItem(CHAT_HOME_SHOWN_KEY); });
afterEach(() => { resetChatHomeStore(); localStorage.removeItem(CHAT_HOME_SHOWN_KEY); });

function setup(route: string, extra: Record<string, Handler> = {}, embedded?: ComponentProps<typeof ChatRoutesHarness>["embedded"]) {
  const mock = createFetchMock(chatHomeRoutes(extra));
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<ChatRoutesHarness embedded={embedded} />, { api, route, path: "*" });
  return { ...mock, api };
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

  it("on: the chat / rooms switch handed in by app.tsx sits at the top of today's message list (rooms stay reachable)", async () => {
    setup("/chat", {}, { switcher: <div data-testid="hub-switch" /> });
    const list = await screen.findByTestId("message-list");
    expect(await within(list).findByTestId("hub-switch")).toBeInTheDocument();
  });

  it("on: /chat/:id never shows the switch (only the home page does)", async () => {
    setup("/chat/c1", {}, { switcher: <div data-testid="hub-switch" /> });
    await screen.findByText("Trip planning");
    expect(screen.queryByTestId("hub-switch")).toBeNull();
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
    const mock = setup("/chat", { "POST /api/chat-home/today": () => (++n === 1 ? new Response("boom", { status: 500 }) : json(SEEN_TODAY)) });
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

// ---- 问候时机(W10):只在 /chat 弹;daily / every_open / off;重播;删除今天的对话 ----
const prefs = (greeting_trigger: string) => ({ "GET /api/chat-home/settings": () => json({ greeting_trigger, language: "bilingual", daily_persona_id: "builtin:partner", include_stats: true }) });
const todayWith = (over: Record<string, unknown>) => ({ ...FIRST_VIEW, greeting: { ...FIRST_VIEW.greeting, ...over } });
const messagePosts = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/messages"));
const seenCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname.endsWith("/seen"));

describe("greeting trigger rules (only on the chat home)", () => {
  it("a cold start somewhere else pops the greeting the first time /chat is entered, once", async () => {
    const mock = setup("/practice", { "POST /api/chat-home/today": () => json(FIRST_VIEW) });
    await requestToday(mock.api, { open: true }); // what the app-open effect does at start
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
    act(() => goTo("/chat"));
    const modal = await screen.findByTestId("greeting-modal");
    expect(modal).toHaveAttribute("data-mode", "open");
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(seenCalls(mock)[0].url.pathname).toBe("/api/chat-home/greetings/g1/seen");
    expect(localStorage.getItem(CHAT_HOME_SHOWN_KEY)).toBe("2026-10-23");
    await userEvent.click(screen.getByTestId("greeting-skip"));
    await waitFor(() => expect(screen.queryByTestId("greeting-modal")).toBeNull());
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
    // leaving and coming back in the same app open does not pop it again
    act(() => goTo("/practice"));
    act(() => goTo("/chat"));
    await screen.findByTestId("message-list");
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
    expect(messagePosts(mock)).toHaveLength(0);
  });

  it("never pops on a deep link, even the one for today's own conversation, and keeps the marker for /chat", async () => {
    const mock = setup("/chat/c-today", { "POST /api/chat-home/today": () => json(FIRST_VIEW) });
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
    act(() => goTo("/chat"));
    expect(await screen.findByTestId("greeting-modal")).toBeInTheDocument();
  });

  it("daily: firstView=false does not pop", async () => {
    const mock = setup("/chat", { "POST /api/chat-home/today": () => json(todayWith({ first_view: false })) });
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("daily: a device that already showed today does not pop again, and retries a missed seen once, silently", async () => {
    localStorage.setItem(CHAT_HOME_SHOWN_KEY, "2026-10-23");
    const mock = setup("/chat", { "POST /api/chat-home/today": () => json(FIRST_VIEW) });
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
  });

  it("every open: pops even when it was seen, calls seen, and appends no message", async () => {
    const mock = setup("/chat", { ...prefs("every_open"), "POST /api/chat-home/today": () => json(todayWith({ first_view: false })) });
    await requestToday(mock.api, { open: true });
    expect(await screen.findByTestId("greeting-modal")).toBeInTheDocument();
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(messagePosts(mock)).toHaveLength(0);
    expect(screen.getAllByTestId("chat-greeting-line")).toHaveLength(3); // the chat still has exactly the stored three
  });

  it("off: no popup (the chat is still today's)", async () => {
    const mock = setup("/chat", { ...prefs("off"), "POST /api/chat-home/today": () => json(FIRST_VIEW) });
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("a greeting that is not exactly three lines is treated as no greeting", async () => {
    const mock = setup("/chat", { "POST /api/chat-home/today": () => json(todayWith({ lines: FIRST_VIEW.greeting.lines.slice(0, 2) })) });
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    expect(screen.queryByTestId("greeting-modal")).toBeNull();
  });

  it("a failing seen request is silent and the modal still shows", async () => {
    const mock = setup("/chat", { "POST /api/chat-home/today": () => json(FIRST_VIEW), "POST /api/chat-home/greetings/g1/seen": () => new Response("boom", { status: 500 }) });
    await requestToday(mock.api, { open: true });
    expect(await screen.findByTestId("greeting-modal")).toBeInTheDocument();
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replay: opens the same lines from the settings sheet without /today, seen or any message write; absent for other conversations", async () => {
    const mock = setup("/chat");
    await requestToday(mock.api, { open: true });
    await screen.findByTestId("message-list");
    mock.calls.length = 0;
    await userEvent.click(screen.getByTestId("chat-settings-open"));
    await userEvent.click(await screen.findByTestId("chat-greeting-replay"));
    const modal = await screen.findByTestId("greeting-modal");
    expect(modal).toHaveAttribute("data-mode", "replay");
    expect(screen.getAllByTestId("greeting-line")).toHaveLength(3);
    expect(mock.calls.filter((c) => c.url.pathname.includes("/today") || c.url.pathname.endsWith("/seen") || c.method === "POST")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("greeting-skip"));
    await waitFor(() => expect(screen.queryByTestId("greeting-modal")).toBeNull());
    expect(screen.getAllByTestId("chat-greeting-line")).toHaveLength(3); // message count unchanged

    act(() => goTo("/chat/c1"));
    await screen.findByText("Where to?");
    await userEvent.click(screen.getByTestId("chat-settings-open"));
    await screen.findByTestId("chat-settings-sheet");
    expect(screen.queryByTestId("chat-greeting-replay")).toBeNull();
  });

  it("deleting today's chat from the drawer rebuilds it: DELETE then POST /today once each, no popup, new chat with its three greeting bubbles", async () => {
    let deleted = false; // the response depends on the DELETE having happened, not on how many POSTs came first (a call counter made the outcome depend on request order)
    const NEW_ID = "c-rebuilt";
    const rebuilt = { ...SEEN_TODAY, conversation: { ...SEEN_TODAY.conversation, id: NEW_ID }, greeting: { ...SEEN_TODAY.greeting, id: "g2", message_ids: ["n1", "n2", "n3"], first_view: true } };
    const mock = setup("/chat", {
      "POST /api/chat-home/today": () => json(deleted ? rebuilt : SEEN_TODAY),
      "DELETE /api/conversations/c-today": () => { deleted = true; return json({ id: "c-today" }); },
      [`GET /api/conversations/${NEW_ID}`]: () => json(rebuilt.conversation),
      [`GET /api/conversations/${NEW_ID}/messages`]: () => json({ messages: ["n1", "n2", "n3"].map((id, i) => ({ id, conversation_id: NEW_ID, role: "assistant", content: `${rebuilt.greeting.lines[i].en.replace(/\*/g, "")}\n\n${rebuilt.greeting.lines[i].zh.replace(/\*/g, "")}`, created_at: "2026-10-23T00:42:10Z" })) }),
    });
    await screen.findAllByTestId("chat-greeting-line"); // the route itself POSTs /today once on mount
    await userEvent.click(screen.getByTestId("chat-history-open"));
    await userEvent.click(await screen.findByTestId("chat-history-today-delete"));
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(callsTo(mock, "GET", `/api/conversations/${NEW_ID}/messages`).length).toBeGreaterThan(0));
    expect(callsTo(mock, "DELETE", "/api/conversations/c-today")).toHaveLength(1);
    expect(callsTo(mock, "POST", "/api/chat-home/today")).toHaveLength(2);
    expect(screen.queryByTestId("greeting-modal")).toBeNull(); // a rebuild is not an app open, even though firstView is true
    expect(seenCalls(mock)).toHaveLength(0);
    await waitFor(() => expect(screen.getAllByTestId("chat-greeting-line")).toHaveLength(3));
    expect(messagePosts(mock)).toHaveLength(0);
  });
});
