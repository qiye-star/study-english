import "./locales";
import { ApiError, type ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { markLatency } from "~/lib/latency";
import { createAgentSseParser, parseTurnEvent, type RawSseEvent } from "./sse";
import { reduceLive, startLive } from "./trace";
import type { AgentTurnRequest, AgentTurnResult, LiveTrace, TurnErrorCode, TurnMeta } from "./types";

export type AgentErrorCode = TurnErrorCode | "interrupted" | "timeout";
export const AGENTS_HISTORY_MAX = 20;
const DEFAULT_IDLE_MS = 60_000;

/**
 * 回合失败。message 只含错误码(不带用户文本或上游原文,spec §4.4);agentText 是已翻译的文案,对话页直接显示;
 * retryId 非空 = 重试时沿用这个 client_turn_id(R-W10)。
 */
export class AgentTurnError extends Error {
  readonly agentText: string;
  constructor(readonly code: AgentErrorCode, readonly retryId: string | undefined) {
    super(`agent turn failed: ${code}`);
    this.name = "AgentTurnError";
    this.agentText = i18n.t(`web.agents.errors.${code}`);
  }
}

export interface TurnHandlers {
  onDelta?(full: string, piece: string): void;
  onTrace?(live: LiveTrace): void;
  onMeta?(meta: TurnMeta): void;
}

/** RFC 4122 v4;没有 randomUUID 的旧 iOS 用 getRandomValues 拼。 */
export function newTurnId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 流开始之前的 HTTP 拒绝 → 错误码(按状态码,不依赖服务端英文文案)。 */
export function codeForStatus(status: number): AgentErrorCode | null {
  if (status === 403 || status === 404) return "disabled";
  if (status === 429) return "limit";
  if (status === 409) return "busy";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "llm_unavailable";
  return null;
}

/**
 * 一个回合:POST /api/agents/turn → 读 SSE(R-W11)。从不自动重试(R-W10)。
 * 用户中止 → ApiError(0, "Request aborted")(与 streamChatCompletion 一致,调用方据此静默);
 * 传输失败 → AgentTurnError(interrupted|timeout, 同一 id);服务端 error 事件 → AgentTurnError(code, busy 才带 id)。
 */
export async function streamAgentTurn(
  api: ApiClient,
  req: AgentTurnRequest,
  handlers: TurnHandlers = {},
  signal?: AbortSignal,
  opts: { idleMs?: number; now?: () => number } = {},
): Promise<AgentTurnResult> {
  const clientTurnId = req.clientTurnId ?? newTurnId();
  const now = opts.now ?? (() => Date.now());
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const body: AgentTurnRequest = { ...req, clientTurnId, history: req.history.slice(-AGENTS_HISTORY_MAX) };
  const controller = new AbortController();
  let idleFired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortOuter = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  const armIdle = () => {
    if (timer) clearTimeout(timer);
    if (idleMs > 0) timer = setTimeout(() => { idleFired = true; controller.abort(); }, idleMs);
  };
  // 传输层失败:服务端可能已经在跑或跑完这一回合,重试必须沿用同一个 id
  const transport = (): Error => (signal?.aborted ? new ApiError(0, "Request aborted") : new AgentTurnError(idleFired ? "timeout" : "interrupted", clientTurnId));
  // 用对象保存闭包里写入的结果:let 变量在回调里赋值后 TS 的收窄会出错
  const st: { live: LiveTrace; full: string; first: boolean; result: AgentTurnResult | null; failure: AgentTurnError | null } = {
    live: startLive(now()), full: "", first: true, result: null, failure: null,
  };
  const onEvent = (raw: RawSseEvent) => {
    if (st.result || st.failure) return;
    const event = parseTurnEvent(raw);
    if (!event) return;
    const next = reduceLive(st.live, event);
    if (next !== st.live) {
      st.live = next;
      handlers.onTrace?.(next);
    }
    if (event.type === "delta") {
      st.full += event.text;
      if (st.first) {
        st.first = false;
        markLatency("reply_first_delta");
      }
      handlers.onDelta?.(st.full, event.text);
    } else if (event.type === "meta") {
      handlers.onMeta?.(event.meta);
    } else if (event.type === "done") {
      st.result = { text: st.full, trace: event.trace, turnId: st.live.turnId, meta: st.live.meta, clientTurnId,
        noteZh: event.noteZh ?? event.trace?.noteZh ?? null };
    } else if (event.type === "error") {
      st.failure = new AgentTurnError(event.code, event.code === "busy" ? clientTurnId : undefined);
    }
  };
  try {
    armIdle();
    let response: Response;
    try {
      response = await api.request<Response>("POST", "/api/agents/turn", { json: body, as: "raw", signal: controller.signal });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) throw transport();
      const code = err instanceof ApiError ? codeForStatus(err.status) : null;
      if (code) throw new AgentTurnError(code, code === "busy" ? clientTurnId : undefined);
      throw err;
    }
    handlers.onTrace?.(st.live); // 请求已被接受:界面立刻显示「正在准备回复」
    const parser = createAgentSseParser(onEvent);
    if (!response.body) {
      parser.push(await response.text());
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(transport());
        if (controller.signal.aborted) fail();
        else controller.signal.addEventListener("abort", fail, { once: true });
      });
      aborted.catch((): void => undefined);
      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await Promise.race([reader.read(), aborted]);
          } catch (err) {
            if (err instanceof AgentTurnError || err instanceof ApiError) throw err;
            throw transport();
          }
          if (chunk.done) break;
          armIdle();
          parser.push(decoder.decode(chunk.value, { stream: true }));
          if (st.result || st.failure) break;
        }
      } catch (err) {
        await reader.cancel().catch((): void => undefined);
        throw err;
      }
      if (st.result || st.failure) await reader.cancel().catch((): void => undefined);
      parser.push(decoder.decode());
    }
    parser.flush();
    if (st.failure) throw st.failure;
    if (!st.result) throw transport();
    if (!st.result.text.trim()) throw new AgentTurnError("llm_unavailable", undefined);
    return st.result;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}
