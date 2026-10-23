import "fake-indexeddb/auto";
import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { resetChatHomeStore } from "./chat-home-store";
import { factsLine, storedGreetingText } from "./greeting-group";
import { GREETING_MESSAGES, ChatRoutesHarness, TODAY, chatHomeRoutes } from "./test-routes";

configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});
beforeEach(() => { resetServerAiConfigCache(); resetChatHomeStore(); localStorage.clear(); });
afterEach(async () => { resetChatHomeStore(); localStorage.clear(); await i18n.changeLanguage("en"); });

function setup(extra: Record<string, Handler> = {}, language = "zh-CN") {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language })); // zh UI: translate buttons are shown
  const mock = createFetchMock(chatHomeRoutes(extra));
  renderWithProviders(<ChatRoutesHarness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat", path: "*" });
  return mock;
}

describe("greeting group in today's chat", () => {
  it("groups the three greeting messages with a heading, lead style, ordinals and a facts footer", async () => {
    setup();
    const lines = await screen.findAllByTestId("chat-greeting-line");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.getAttribute("data-gl"))).toEqual(["0", "1", "2"]);
    expect(lines.map((l) => l.getAttribute("data-greet-target"))).toEqual(["0", "1", "2"]);
    expect(screen.getAllByTestId("chat-greeting-group")).toHaveLength(1);
    expect(within(lines[0]).getByTestId("chat-greeting-group")).toHaveTextContent(/今日问候|Today's greeting/);
    expect(within(lines[0]).getByTestId("chat-greeting-text").className).toMatch(/text-\[17px\]/);
    expect(within(lines[1]).getByTestId("chat-greeting-text").className).not.toMatch(/text-\[17px\]/);
    // facts only after the last line, numbers only
    expect(within(lines[2]).getByTestId("chat-greeting-facts")).toHaveTextContent(/23/);
    expect(screen.getAllByTestId("chat-greeting-facts")).toHaveLength(1);
  });

  it("shows emphasis as <em> and the visible text carries no asterisks, English main with the Chinese line below", async () => {
    setup();
    const first = (await screen.findAllByTestId("chat-greeting-line"))[0];
    const em = first.querySelectorAll("em.greet-em");
    expect(em.length).toBeGreaterThan(0);
    const ctx = first.querySelector("[data-lookup-context]") as HTMLElement;
    expect(ctx.textContent).not.toContain("*");
    expect(ctx.textContent).toContain("23-day streak");
    expect(ctx.textContent).toContain("早上好");
  });

  it("keeps listen / translate / practice and lookup context on greeting bubbles; reading aloud sends the stored text without asterisks", async () => {
    let spoken = "";
    const mock = setup({ "POST /api/ai/audio/speech": (c) => { spoken = String(c.body); return new Response(new Uint8Array([1])); } });
    const first = (await screen.findAllByTestId("chat-greeting-line"))[0];
    for (const id of ["message-tts", "message-translate", "message-practice"]) expect(within(first).getByTestId(id), id).toBeInTheDocument();
    expect(first.querySelector("[data-lookup-context]")).not.toBeNull();
    await userEvent.click(within(first).getByTestId("message-tts"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));
    expect(spoken).toContain("23-day streak");
    expect(spoken).not.toContain("*");
  });

  it("falls back to the plain stored text when it no longer matches the greeting line", async () => {
    setup({ "GET /api/conversations/c-today/messages": () => json({ messages: GREETING_MESSAGES.map((m, i) => (i === 0 ? { ...m, content: "Edited elsewhere" } : m)) }) });
    const lines = await screen.findAllByTestId("chat-greeting-line");
    expect(within(lines[0]).queryByTestId("chat-greeting-text")).toBeNull();
    expect(lines[0]).toHaveTextContent("Edited elsewhere");
    expect(within(lines[1]).getByTestId("chat-greeting-text")).toBeInTheDocument();
  });

  it("a deleted greeting message leaves the others as they are and nothing breaks", async () => {
    setup({ "GET /api/conversations/c-today/messages": () => json({ messages: GREETING_MESSAGES.slice(1) }) });
    const lines = await screen.findAllByTestId("chat-greeting-line");
    expect(lines).toHaveLength(2);
    expect(screen.queryByTestId("chat-greeting-group")).toBeNull(); // the heading belongs to the first message
  });

  it("other messages and other conversations render as plain bubbles", async () => {
    setup({ "GET /api/conversations/c-today/messages": () => json({ messages: [...GREETING_MESSAGES, { id: "mx", conversation_id: "c-today", role: "assistant", content: "Plain **one**" }] }) });
    expect(await screen.findByText("one")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-greeting-line")).toHaveLength(3);
  });

  it("no group when the greeting is off / absent: the chat shows the empty state", async () => {
    setup({
      "POST /api/chat-home/today": () => json({ ...TODAY, status: "off", greeting: null }),
      "GET /api/conversations/c-today/messages": () => json({ messages: [] }),
    });
    expect(await screen.findByTestId("chat-empty-day")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-greeting-line")).toBeNull();
  });

  it("stored text and facts line helpers", () => {
    expect(storedGreetingText({ en: "Hi *you*", zh: "你好*你*" })).toBe("Hi you\n\n你好你");
    expect(storedGreetingText({ zh: "只有中文" })).toBe("只有中文");
    const t = i18n.getFixedT("en");
    expect(factsLine({}, t)).toBe("");
    expect(factsLine({ streak: 3, yesterdayMistakes: 0 }, t)).toMatch(/3/);
  });
});
