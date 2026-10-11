import camelcaseKeys from "camelcase-keys";
import { normalizeTrace, toStep, toThought } from "./trace";
import type { TurnErrorCode, TurnEvent, TurnMeta } from "./types";

/** 一个 SSE 块:event 名 + 合并后的 data。 */
export interface RawSseEvent {
  event: string;
  data: string;
}

const BOUNDARY = /\r?\n\r?\n/;

/**
 * R-W11:保留 `event:` 名;多行 `data:` 以 \n 合并;`:` 开头的注释(心跳)与没有 data 的块忽略;CRLF 与任意分块位置都可。
 */
export function createAgentSseParser(onEvent: (e: RawSseEvent) => void) {
  let buffer = "";
  const emit = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const at = line.indexOf(":");
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) onEvent({ event, data: data.join("\n") });
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = BOUNDARY.exec(buffer))) {
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

const ERROR_CODES: readonly TurnErrorCode[] = ["disabled", "limit", "llm_unavailable", "bad_request", "busy"];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** 一个 SSE 块 → 回合事件;未知事件、坏 JSON、残缺字段返回 null(向前兼容)。 */
export function parseTurnEvent(raw: RawSseEvent): TurnEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.data);
  } catch {
    return null;
  }
  if (!isObj(payload)) return null;
  const d = camelcaseKeys(payload, { deep: true }) as Obj;
  switch (raw.event) {
    case "start":
      return typeof d.turnId === "string" ? { type: "start", turnId: d.turnId } : null;
    case "step": {
      const step = toStep(d);
      return step ? { type: "step", step } : null;
    }
    case "thought": {
      const thought = toThought(d);
      return thought ? { type: "thought", thought } : null;
    }
    case "delta":
      return typeof d.text === "string" ? { type: "delta", text: d.text } : null;
    case "meta": {
      if (typeof d.stepIndex !== "number" || typeof d.stepsTotal !== "number") return null;
      const { stepIndex, stepsTotal, verdict, kind, done } = d as unknown as TurnMeta;
      return { type: "meta", meta: { stepIndex, stepsTotal, ...(verdict ? { verdict } : {}), ...(kind ? { kind } : {}), ...(typeof done === "boolean" ? { done } : {}) } };
    }
    case "done": {
      const usage = isObj(d.usage) && typeof d.usage.in === "number" && typeof d.usage.out === "number" ? { in: d.usage.in, out: d.usage.out } : null;
      return { type: "done", usage, trace: normalizeTrace(d.trace), textLen: typeof d.textLen === "number" ? d.textLen : 0 };
    }
    case "error":
      return { type: "error", code: ERROR_CODES.includes(d.code as TurnErrorCode) ? (d.code as TurnErrorCode) : "llm_unavailable" };
    default:
      return null;
  }
}
