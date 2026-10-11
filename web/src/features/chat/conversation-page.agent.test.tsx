import "fake-indexeddb/auto";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetAgentsCaches } from "~/features/agents/use-agents-data";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { COMPOSER_MODE_KEY } from "./composer-mode";
import { ConversationPage } from "./conversation-page";
import { sharedTtsCache } from "./tts";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
};
const STEP = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "give up" }, ms: 90, private: false };
const TRACE = { v: 1, ms: 3200, steps: [STEP], thought: null as null };
const HAPPY = [ev("start", { turn_id: "t1" }), ev("step", { ...STEP, status: "run" }), ev("step", STEP), ev("delta", { text: "Hello " }),
  ev("delta", { text: "there!" }), ev("done", { trace: TRACE, text_len: 12 })];
const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };
const AGENTS = { enabled: true, available: true, tutor: true, memory: true, rooms: true, tools_mode: "prefetch",
  limits: { personas_max: 10, prompt_max_chars: 800, history_max: 20, text_max_chars: 2000 }, levels: ["A2", "B1", "B2", "C1"],
  styles: ["friendly", "strict", "humor", "concise"], tools: ["lookup", "learned_words", "weak_words", "due_words", "memory"] };
const PERSONAS = { personas: [{ id: "builtin:coach", builtin: true, mine: false, name: "Emma", intro: "Coach", prompt: null as string | null, level: "B1", style: "friendly",
  voice: null as string | null, tools: ["lookup"], prompt_public: true, deep_think: false, disabled: false, created_at: null as string | null, updated_at: null as string | null }] };

function routes(extra: Record<string, Handler> = {}, agentConfig: Record<string, unknown> = { ...CONFIG, agent_persona_id: "builtin:coach" }): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: agentConfig }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier reply" }] }),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    "GET /api/agents/config": () => json(AGENTS),
    "GET /api/agents/personas": () => json(PERSONAS),
    "GET /api/agents/settings": () => json({ error: "Not Found" }, 404),
    "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
    "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
    "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: agentConfig }),
    ...extra,
  };
}
function setup(r: Record<string, Handler>) {
  const mock = createFetchMock(r);
  renderWithProviders(<ConversationPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "/chat/:id" });
  return mock;
}
const callsTo = (mock: ReturnType<typeof createFetchMock>, method: string, path: string) => mock.calls.filter((c) => c.method === method && c.url.pathname === path);
const bodyOf = (call: { body: BodyInit | null | undefined }) => JSON.parse(String(call.body));
async function say(text: string) {
  await userEvent.type(await screen.findByTestId("chat-input"), text);
  await userEvent.click(screen.getByTestId("chat-send"));
}

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

describe("ConversationPage with a persona (spec §9.3, R-W12)", () => {
  beforeEach(() => { sharedTtsCache.clear(); resetServerAiConfigCache(); resetAgentsCaches(); localStorage.removeItem(COMPOSER_MODE_KEY); });

  it("streams the reply from /api/agents/turn, never the old completions path, and saves the trace with the assistant message", async () => {
    const mock = setup(routes({ "POST /api/agents/turn": () => sse(HAPPY) }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
    const turn = callsTo(mock, "POST", "/api/agents/turn")[0];
    expect(turn.url.search).toBe("");
    expect(bodyOf(turn)).toMatchObject({
      persona_id: "builtin:coach", conversation_id: "c1", text: "Hi", mode: "chat", tutor_session_id: null,
      history: [{ role: "assistant", content: "Earlier reply" }],
    });
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0])).toEqual({ messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there!", agent_trace: { v: 1, ms: 3200, steps: [STEP], thought: null } },
    ] });
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Thought for 3s · used 1 tool");
    expect(await screen.findByTestId("agent-source")).toHaveTextContent("Dictionary · give up");
  });

  it("feeds the same deltas into auto-speak: the finished sentence is spoken", async () => {
    const mock = setup(routes({ "POST /api/agents/turn": () => sse(HAPPY) }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/audio/speech").length).toBeGreaterThan(0));
  });

  it("shows the translated error and retries a server error as a new turn, a dropped stream with the same id", async () => {
    let n = 0;
    const mock = setup(routes({ "POST /api/agents/turn": () => {
      n += 1;
      if (n === 1) return sse([ev("error", { code: "limit" })]);
      if (n === 2) return sse([ev("start", { turn_id: "t2" }), ev("delta", { text: "Hel" })]);
      return sse(HAPPY);
    } }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    expect(await screen.findByText("You have reached today's agent limit. Try again tomorrow.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("message-retry"));
    expect(await screen.findByText("The connection dropped before the reply finished. Retry to get it.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    const ids = callsTo(mock, "POST", "/api/agents/turn").map((c) => bodyOf(c).client_turn_id);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ids[2]).toBe(ids[1]);
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
  });

  it("renders the collapsed capsule from a stored trace after reload", async () => {
    setup(routes({
      "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m9", conversation_id: "c1", role: "assistant", content: "Stored", agent_trace: TRACE }] }),
    }));
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Thought for 3s · used 1 tool");
  });

  it("leaves a conversation without a persona on the old path: same request, same saved bodies, no agent DOM", async () => {
    const mock = setup(routes({
      "POST /api/ai/chat/completions": () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`),
    }, CONFIG));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
    expect(callsTo(mock, "POST", "/api/agents/turn")).toHaveLength(0);
    expect(bodyOf(callsTo(mock, "POST", "/api/ai/chat/completions")[0])).toEqual({
      messages: [{ role: "system", content: "SYS" }, { role: "assistant", content: "Earlier reply" }, { role: "user", content: "Hi" }],
      model: "gpt-4o", temperature: 0.7, stream: true,
    });
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0])).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "OK" }] });
    expect(screen.queryByTestId("agent-capsule")).toBeNull();
  });

  it("picks a persona for an old conversation by writing only agent_persona_id", async () => {
    const mock = setup(routes({}, CONFIG));
    await userEvent.click(await screen.findByTestId("agent-persona-chip"));
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:coach"));
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "PATCH", "/api/conversations/c1")[0]).config).toEqual({ ...CONFIG, agent_persona_id: "builtin:coach" });
  });

  it("removing the persona deletes only the agent_persona_id key", async () => {
    const mock = setup(routes());
    await waitFor(() => expect(screen.getByTestId("agent-persona-chip")).toHaveTextContent("Emma"));
    await userEvent.click(screen.getByTestId("agent-persona-chip"));
    await userEvent.click(await screen.findByTestId("agent-persona-none"));
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "PATCH", "/api/conversations/c1")[0]).config).toEqual(CONFIG);
  });

  it("explains in the settings sheet that the persona decides prompt, scenario and level", async () => {
    setup(routes());
    await waitFor(() => expect(screen.getAllByTestId("message-assistant")[0]).toHaveTextContent("Earlier reply"));
    await waitFor(() => expect(screen.getByTestId("agent-persona-chip")).toHaveTextContent("Emma"));
    await userEvent.click(screen.getByTestId("conversation-options"));
    await userEvent.click(screen.getByTestId("conversation-settings"));
    expect(await screen.findByTestId("settings-persona-note")).toBeInTheDocument();
  });

  it("old conversations show no persona note in the settings sheet", async () => {
    setup(routes({}, CONFIG));
    await screen.findByText("Earlier reply");
    await userEvent.click(screen.getByTestId("conversation-options"));
    await userEvent.click(screen.getByTestId("conversation-settings"));
    await screen.findByTestId("settings-save");
    expect(screen.queryByTestId("settings-persona-note")).toBeNull();
  });
});
