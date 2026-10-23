import { configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetAgentsCaches } from "~/features/agents/use-agents-data";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CHAT_HOME_ROLE_HINT_KEY } from "./chat-home-cache";
import { resetChatHomeStore } from "./chat-home-store";
import { ChatRoutesHarness, chatHomeRoutes } from "./test-routes";

configure({ asyncUtilTimeout: 5000 });

const persona = (id: string, name: string, voice: string | null = null) => ({
  id, builtin: true, mine: false, name, intro: `${name} intro`, prompt: null as string | null, level: "B1", style: "friendly",
  voice, tools: [] as string[], prompt_public: true, deep_think: false, disabled: false, created_at: null as string | null, updated_at: null as string | null,
});
const AGENTS_ON = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 }, levels: ["B1"], styles: ["friendly"], tools: [] as string[] };
const CREATED = { id: "c-new", name: "New conversation", config: {}, created_at: "2026-10-23T01:00:00Z", updated_at: "2026-10-23T01:00:00Z" };

beforeEach(() => { resetChatHomeStore(); resetAgentsCaches(); resetServerAiConfigCache(); localStorage.removeItem(CHAT_HOME_ROLE_HINT_KEY); });
afterEach(() => { resetChatHomeStore(); localStorage.removeItem(CHAT_HOME_ROLE_HINT_KEY); });

function setup(agents: boolean, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock(chatHomeRoutes({
    "GET /api/agents/config": () => (agents ? json(AGENTS_ON) : json({ enabled: false })),
    "GET /api/agents/personas": () => json({ personas: [persona("builtin:partner", "Partner", "echo"), persona("builtin:coach", "Emma")] }),
    "POST /api/conversations": () => json(CREATED),
    "GET /api/conversations/c-new": () => json(CREATED),
    "GET /api/conversations/c-new/messages": () => json({ messages: [] }),
    ...extra,
  }));
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<ChatRoutesHarness />, { api, route: "/chat/new", path: "*" });
  return mock;
}
const created = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/conversations");

describe("new chat draft", () => {
  it("is local only: nothing is created until the user chooses", async () => {
    const mock = setup(true);
    await screen.findByTestId("chat-new-pick-role");
    expect(created(mock)).toHaveLength(0);
  });

  it("choosing a role creates the conversation with only the persona and its voice, then replaces the route", async () => {
    const mock = setup(true);
    await userEvent.click(await screen.findByTestId("chat-new-pick-role"));
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:partner"));
    await waitFor(() => expect(created(mock)).toHaveLength(1));
    const body = JSON.parse(String(created(mock)[0].body));
    expect(body.name).toBe("New conversation");
    expect(body.config).toEqual({ agent_persona_id: "builtin:partner", tts_model: "openai/tts-1", tts_voice: "echo" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c-new"));
    expect(await screen.findByTestId("message-list")).toBeInTheDocument();
  });

  it("start chatting creates a role-less conversation exactly like the old free chat", async () => {
    const mock = setup(true);
    await userEvent.click(await screen.findByTestId("chat-new-just-start"));
    await waitFor(() => expect(created(mock)).toHaveLength(1));
    expect(JSON.parse(String(created(mock)[0].body))).toEqual({ name: "New conversation", config: { scenario: { id: "free" }, level: "auto" } });
  });

  it("a double tap creates one conversation", async () => {
    const mock = setup(true);
    const button = await screen.findByTestId("chat-new-just-start");
    await userEvent.dblClick(button);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c-new"));
    expect(created(mock)).toHaveLength(1);
  });

  it("with agents off there is no role button and no settings button, only start and scenario", async () => {
    setup(false);
    await screen.findByTestId("chat-new-just-start");
    expect(screen.queryByTestId("chat-new-pick-role")).toBeNull();
    expect(screen.queryByTestId("chat-settings-open")).toBeNull();
    expect(screen.getByTestId("chat-new-scenario")).toBeInTheDocument();
  });

  it("start from a scenario opens the original scenario sheet", async () => {
    setup(true);
    await userEvent.click(await screen.findByTestId("chat-new-scenario"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows the first-use hint at the settings button and dismisses it for good", async () => {
    setup(true);
    expect(await screen.findByRole("note")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("chat-role-hint-dismiss"));
    expect(screen.queryByRole("note")).toBeNull();
    expect(localStorage.getItem(CHAT_HOME_ROLE_HINT_KEY)).toBe("1");
  });

  it("shows a creation failure and lets the user try again", async () => {
    let n = 0;
    const mock = setup(true, { "POST /api/conversations": () => (++n === 1 ? json({ error: "boom" }, 500) : json(CREATED)) });
    await userEvent.click(await screen.findByTestId("chat-new-just-start"));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("chat-new-just-start"));
    await waitFor(() => expect(created(mock)).toHaveLength(2));
  });
});
