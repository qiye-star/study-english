import { describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient } from "./client";
import { completeChat, createSseParser, parseSseData, streamChatCompletion } from "./ai";

const chunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

function streamOf(parts: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("SSE parsing", () => {
  it("handles events split across chunks and CRLF", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.push("data: {\"a\"");
    parser.push(":1}\r\n\r\ndata: [DO");
    parser.push("NE]\n\n: comment\n\n");
    parser.flush();
    expect(seen).toEqual(['{"a":1}', "[DONE]"]);
  });
  it("classifies payloads", () => {
    expect(parseSseData("[DONE]")).toEqual({ kind: "done" });
    expect(parseSseData('{"error": "Upstream unavailable"}')).toEqual({ kind: "error", message: "Upstream unavailable" });
    expect(parseSseData('{"error": {"message": "bad"}}')).toEqual({ kind: "error", message: "bad" });
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }))).toEqual({ kind: "delta", text: "Hi" });
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { role: "assistant" } }] }))).toEqual({ kind: "ignore" });
    expect(parseSseData("not json")).toEqual({ kind: "ignore" });
  });
});

describe("streamChatCompletion", () => {
  it("accumulates deltas and posts a stream request", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => streamOf([chunk("Hel"), chunk("lo"), "data: [DONE]\n\n"]) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const onDelta = vi.fn();
    const text = await streamChatCompletion(api, { messages: [{ role: "user", content: "hi" }], model: "", temperature: 0.7 }, onDelta);
    expect(text).toBe("Hello");
    expect(onDelta).toHaveBeenLastCalledWith("Hello", "lo");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ messages: [{ role: "user", content: "hi" }], temperature: 0.7, stream: true });
  });
  it("throws when the relay reports an error", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => streamOf([chunk("Hi"), 'data: {"error": "Upstream unavailable"}\n\n']) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(streamChatCompletion(api, { messages: [] }, () => {})).rejects.toMatchObject({ status: 502, message: "Upstream unavailable" });
  });
  it("surfaces HTTP errors before streaming", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ error: "LLM upstream is not configured" }, 503) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(streamChatCompletion(api, { messages: [] }, () => {})).rejects.toMatchObject({ status: 503 });
  });
});

describe("completeChat", () => {
  it("requests JSON mode and returns the message content", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"x"}' } }] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const out = await completeChat(api, { messages: [{ role: "system", content: "s" }], temperature: 0, model: "gpt-4o", jsonMode: true });
    expect(out).toBe('{"word":"x"}');
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({
      messages: [{ role: "system", content: "s" }], model: "gpt-4o", temperature: 0, stream: false, response_format: { type: "json_object" },
    });
  });
  it("rejects empty responses", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(completeChat(api, { messages: [] })).rejects.toMatchObject({ status: 502, message: "Empty AI response" });
  });
});
