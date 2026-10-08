import { markLatency } from "~/lib/latency";
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

export interface StreamOptions {
  /** Abort if no chunk arrives for this long (default 120 s; 0 disables). */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

export async function streamChatCompletion(
  api: ApiClient,
  req: ChatRequest,
  onDelta: (full: string, piece: string) => void,
  signal?: AbortSignal,
  options: StreamOptions = {},
): Promise<string> {
  const idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let first = true;
  const deltaWithMark = (full: string, piece: string) => {
    if (first) {
      first = false;
      markLatency("reply_first_delta");
    }
    onDelta(full, piece);
  };
  const controller = new AbortController();
  let idleFired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortOuter = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  const armIdle = () => {
    if (timer) clearTimeout(timer);
    if (idleMs > 0) {
      timer = setTimeout(() => {
        idleFired = true;
        controller.abort();
      }, idleMs);
    }
  };
  const abortError = () => (idleFired ? new ApiError(0, "AI response timed out") : new ApiError(0, "Request aborted"));
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  };
  try {
    armIdle();
    let response: Response;
    try {
      response = await api.request<Response>("POST", "/api/ai/chat/completions", {
        json: { ...chatBody(req), stream: true },
        as: "raw",
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0 && controller.signal.aborted) throw abortError();
      throw err;
    }
    const state = { full: "", failure: null as string | null, done: false };
    const parser = createSseParser((data) => {
      if (state.done || state.failure) return;
      const event = parseSseData(data);
      if (event.kind === "delta") {
        state.full += event.text;
        deltaWithMark(state.full, event.text);
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
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(abortError());
        if (controller.signal.aborted) fail();
        else controller.signal.addEventListener("abort", fail, { once: true });
      });
      aborted.catch((): void => undefined);
      try {
        for (;;) {
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await Promise.race([reader.read(), aborted]);
          } catch (err) {
            if (err instanceof ApiError) throw err;
            if (controller.signal.aborted) throw abortError();
            throw err;
          }
          if (result.done) break;
          armIdle();
          parser.push(decoder.decode(result.value, { stream: true }));
          if (state.done || state.failure) break;
        }
      } catch (err) {
        await reader.cancel().catch((): void => undefined);
        throw err;
      }
      if (state.done || state.failure) await reader.cancel().catch((): void => undefined);
      parser.push(decoder.decode());
    }
    parser.flush();
    if (state.failure) throw new ApiError(502, state.failure);
    if (!state.full) throw new ApiError(502, "Empty AI response");
    return state.full;
  } finally {
    cleanup();
  }
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

/**
 * 语音转文字(`/api/ai/audio/transcriptions`,上传 WAV)。聊天的语音消息与通话的"转文字"共用。
 * language 为 null 时不带语言提示,让转写逐字保留原语言(语音消息需要据此判断是否英文,R1)。
 */
export function transcribe(api: ApiClient, wav: Blob, language: string | null = "en", signal?: AbortSignal): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
  form.append("model", "whisper-1");
  if (language) form.append("language", language);
  form.append("response_format", "json");
  return api.request("POST", "/api/ai/audio/transcriptions", { form, timeoutMs: 300_000, signal });
}
