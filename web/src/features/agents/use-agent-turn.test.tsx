import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock } from "~/test/fetch-mock";
import { useAgentTurn } from "./use-agent-turn";
import type { AgentTurnRequest } from "./types";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }));
};
const REQ: Omit<AgentTurnRequest, "clientTurnId"> = { personaId: "builtin:coach", conversationId: "c1", text: "Hi", history: [], mode: "chat", tutorSessionId: null };

describe("useAgentTurn", () => {
  it("runs one turn, exposes live text and the result, and retries a transport failure with the same id", async () => {
    let n = 0;
    const mock = createFetchMock({
      "POST /api/agents/turn": () => (++n === 1 ? sse([ev("delta", { text: "Hel" })]) : sse([ev("delta", { text: "Hello" }), ev("done", { trace: null, text_len: 5 })])),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const { result } = renderHook(() => useAgentTurn(api));
    await act(async () => { await result.current.run(REQ); });
    expect(result.current.status).toBe("error");
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.text).toBe("Hello");
    const ids = mock.calls.map((c) => JSON.parse(String(c.body)).client_turn_id);
    expect(ids[1]).toBe(ids[0]);
  });

  it("aborts the request on unmount", async () => {
    const mock = createFetchMock({ "POST /api/agents/turn": () => new Promise<Response>(() => undefined) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const { result, unmount } = renderHook(() => useAgentTurn(api));
    act(() => { void result.current.run(REQ); });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    unmount();
    expect(mock.calls[0].signal?.aborted).toBe(true);
  });
});
