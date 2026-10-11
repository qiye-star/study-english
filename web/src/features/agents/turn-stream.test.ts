import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { AgentTurnError, streamAgentTurn } from "./turn-stream";
import type { AgentTurnRequest, LiveTrace } from "./types";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[], close = true) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); if (close) c.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const STEP = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "give up" }, ms: 90, private: false };
const TRACE = {
  v: 1, tools: "prefetch", ms: { ctx: 5, ttft: 100, total: 3200 },
  steps: [{ key: "word_lookup", group: "tool", status: "done", ms: 90, private: false, label: "agents.step.word_lookup", params: { word: "give up" } }],
  thought: { source: "summary", text: "Synonym first.", chars: 14 },
};
const HAPPY = [ev("start", { turn_id: "t1" }), ev("step", { ...STEP, status: "run" }), ev("step", STEP), ev("delta", { text: "Hello " }),
  ev("delta", { text: "there!" }), ev("done", { usage: { in: 1, out: 2 }, trace: TRACE, text_len: 12 })];
const REQ: AgentTurnRequest = {
  personaId: "builtin:coach", conversationId: "c1", text: "Hi", history: [{ role: "assistant", content: "Earlier" }], mode: "chat", tutorSessionId: null,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function client(handler: Handler) {
  const mock = createFetchMock({ "POST /api/agents/turn": handler });
  return { mock, api: new ApiClient({ getToken: () => "secret-token", fetchImpl: mock.fetch }) };
}

describe("streamAgentTurn (spec §4.4, R-W10, R-W11)", () => {
  it("posts snake_case with a fresh v4 client_turn_id, keeps the token in the header only, streams deltas and the trace", async () => {
    const log = vi.spyOn(console, "log");
    const { mock, api } = client(() => sse(HAPPY));
    const fulls: string[] = [];
    const phases: LiveTrace["phase"][] = [];
    const result = await streamAgentTurn(api, REQ, { onDelta: (full) => fulls.push(full), onTrace: (l) => phases.push(l.phase) });
    const call = mock.calls[0];
    expect(call.url.pathname).toBe("/api/agents/turn");
    expect(call.url.search).toBe("");
    expect(call.headers.get("Authorization")).toBe("Bearer secret-token");
    const body = JSON.parse(String(call.body));
    expect(body).toEqual({
      persona_id: "builtin:coach", conversation_id: "c1", text: "Hi", history: [{ role: "assistant", content: "Earlier" }],
      mode: "chat", tutor_session_id: null, client_turn_id: expect.stringMatching(UUID),
    });
    expect(fulls).toEqual(["Hello ", "Hello there!"]);
    expect(phases[0]).toBe("prep");
    expect(phases.at(-1)).toBe("done");
    expect(result).toMatchObject({ text: "Hello there!", turnId: "t1", clientTurnId: body.client_turn_id });
    expect(result.trace?.ms).toBe(3200);
    expect(result.trace?.steps[0]).toMatchObject({ key: "word_lookup", labelKey: "agents.step.word_lookup", params: { word: "give up" } });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("sends at most the last 20 history entries and reuses a given client_turn_id", async () => {
    const { mock, api } = client(() => sse(HAPPY));
    const history = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    await streamAgentTurn(api, { ...REQ, history, clientTurnId: "11111111-1111-4111-8111-111111111111" });
    const body = JSON.parse(String(mock.calls[0].body));
    expect(body.history).toHaveLength(20);
    expect(body.history[0].content).toBe("m10");
    expect(body.client_turn_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("an error event throws its code with translated text and no retry id (the next try is a new turn)", async () => {
    const { api } = client(() => sse([ev("start", { turn_id: "t1" }), ev("error", { code: "limit" })]));
    const err = await streamAgentTurn(api, REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentTurnError);
    expect(err).toMatchObject({ code: "limit", retryId: undefined, agentText: i18n.getFixedT("en")("web.agents.errors.limit") });
    expect((err as Error).message).toBe("agent turn failed: limit");
  });

  it("busy keeps the same client_turn_id for the retry", async () => {
    const { api } = client(() => json({ error: "Turn in progress" }, 409));
    const err = (await streamAgentTurn(api, { ...REQ, clientTurnId: "id-1" }).catch((e: unknown) => e)) as AgentTurnError;
    expect(err).toMatchObject({ code: "busy", retryId: "id-1" });
  });

  it("an error{busy} event also keeps the same id", async () => {
    const { api } = client(() => sse([ev("start", { turn_id: "t1" }), ev("error", { code: "busy" })]));
    const err = (await streamAgentTurn(api, { ...REQ, clientTurnId: "id-3" }).catch((e: unknown) => e)) as AgentTurnError;
    expect(err).toMatchObject({ code: "busy", retryId: "id-3" });
  });

  it("a stream that ends without done is a transport failure that keeps the same id", async () => {
    const { mock, api } = client(() => sse([ev("start", { turn_id: "t1" }), ev("delta", { text: "Hel" })]));
    const err = (await streamAgentTurn(api, REQ).catch((e: unknown) => e)) as AgentTurnError;
    expect(err.code).toBe("interrupted");
    expect(err.retryId).toBe(JSON.parse(String(mock.calls[0].body)).client_turn_id);
  });

  it("a silent stream times out (idle) and keeps the id", async () => {
    const { api } = client(() => sse([ev("start", { turn_id: "t1" })], false));
    const err = (await streamAgentTurn(api, REQ, {}, undefined, { idleMs: 20 }).catch((e: unknown) => e)) as AgentTurnError;
    expect(err).toMatchObject({ code: "timeout", retryId: expect.stringMatching(UUID) });
  });

  it("a user abort rejects with the plain aborted error, never an agent error", async () => {
    const { api } = client(() => sse([ev("delta", { text: "Hi" })], false));
    const controller = new AbortController();
    const err = await streamAgentTurn(api, REQ, { onDelta: () => controller.abort() }, controller.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Request aborted");
  });

  it.each([[404, "disabled"], [403, "disabled"], [429, "limit"], [422, "bad_request"], [503, "llm_unavailable"]] as const)(
    "maps HTTP %i before the stream to %s", async (status, code) => {
      const { api } = client(() => json({ error: "whatever" }, status));
      await expect(streamAgentTurn(api, REQ)).rejects.toMatchObject({ code, retryId: undefined });
    });

  it("a network error before any response keeps the id (the server may have the turn)", async () => {
    const api = new ApiClient({ getToken: () => "t", fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(streamAgentTurn(api, { ...REQ, clientTurnId: "id-2" })).rejects.toMatchObject({ code: "interrupted", retryId: "id-2" });
  });

  it("reads the whole body when the response has no stream (old WebKit)", async () => {
    const text = HAPPY.join("");
    const api = new ApiClient({ getToken: () => "t", fetchImpl: (async () => ({ ok: true, status: 200, body: null, text: async () => text }) as unknown as Response) as typeof fetch });
    expect((await streamAgentTurn(api, REQ)).text).toBe("Hello there!");
  });

  it("an empty reply is llm_unavailable", async () => {
    const { api } = client(() => sse([ev("done", { trace: TRACE, text_len: 0 })]));
    await expect(streamAgentTurn(api, REQ)).rejects.toMatchObject({ code: "llm_unavailable" });
  });

  it("replays a recorded turn that arrives as a single chunk (server idempotency replay)", async () => {
    const { api } = client(() => sse([HAPPY.join("")]));
    expect((await streamAgentTurn(api, REQ)).text).toBe("Hello there!");
  });
});
