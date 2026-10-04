import { ApiClient, ApiError } from "./client";

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessageInput[];
  model?: string;
  temperature?: number;
}

export type SseEvent =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "ignore" };

const EVENT_BOUNDARY = /\r?\n\r?\n/;

export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  const emit = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = EVENT_BOUNDARY.exec(buffer))) {
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = "";
    },
  };
}

export function parseSseData(data: string): SseEvent {
  if (data.trim() === "[DONE]") return { kind: "done" };
  let payload: any;
  try {
    payload = JSON.parse(data);
  } catch {
    return { kind: "ignore" };
  }
  if (typeof payload?.error === "string") return { kind: "error", message: payload.error };
  if (typeof payload?.error?.message === "string") return { kind: "error", message: payload.error.message };
  const text = payload?.choices?.[0]?.delta?.content;
  return typeof text === "string" && text ? { kind: "delta", text } : { kind: "ignore" };
}

function chatBody(req: ChatRequest) {
  return {
    messages: req.messages,
    ...(req.model ? { model: req.model } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
}

export async function streamChatCompletion(
  api: ApiClient,
  req: ChatRequest,
  onDelta: (full: string, piece: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const response = await api.request<Response>("POST", "/api/ai/chat/completions", {
    json: { ...chatBody(req), stream: true },
    as: "raw",
    signal,
  });
  const state = { full: "", failure: null as string | null, done: false };
  const parser = createSseParser((data) => {
    if (state.done || state.failure) return;
    const event = parseSseData(data);
    if (event.kind === "delta") {
      state.full += event.text;
      onDelta(state.full, event.text);
    } else if (event.kind === "done") {
      state.done = true;
    } else if (event.kind === "error") {
      state.failure = event.message;
    }
  });
  if (!response.body) {
    parser.push(await response.text());
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (state.done || state.failure) {
        await reader.cancel().catch((): void => undefined);
        break;
      }
    }
    parser.push(decoder.decode());
  }
  parser.flush();
  if (state.failure) throw new ApiError(502, state.failure);
  return state.full;
}

export async function completeChat(
  api: ApiClient,
  req: ChatRequest & { jsonMode?: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const response = await api.request<{ choices?: Array<{ message?: { content?: string } }> }>(
    "POST",
    "/api/ai/chat/completions",
    {
      json: { ...chatBody(req), stream: false, ...(req.jsonMode ? { responseFormat: { type: "json_object" } } : {}) },
      signal,
    },
  );
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new ApiError(502, "Empty AI response");
  return content;
}
