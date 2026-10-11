import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import type { TurnHandlers } from "./turn-stream";
import type { AgentTurnRequest, AgentTurnResult, LiveTrace } from "./types";

/** 命令式入口(对话页用):解析器与文案按需加载,主包只多这几行(R-W2)。 */
export async function runAgentTurn(api: ApiClient, req: AgentTurnRequest, handlers?: TurnHandlers, signal?: AbortSignal): Promise<AgentTurnResult> {
  const { streamAgentTurn } = await import("./turn-stream");
  return streamAgentTurn(api, req, handlers, signal);
}

export interface AgentTurnState {
  status: "idle" | "running" | "done" | "error";
  live: LiveTrace | null;
  text: string;
  result: AgentTurnResult | null;
  error: unknown;
}
const IDLE: AgentTurnState = { status: "idle", live: null, text: "", result: null, error: null };

/**
 * 有状态的封装(导师条、房间私有面板等):同一时刻只跑一个回合;卸载即中止;
 * retry() 按 R-W10 决定是否沿用上一次的 client_turn_id(错误对象的 retryId)。
 */
export function useAgentTurn(api: ApiClient) {
  const [state, setState] = useState<AgentTurnState>(IDLE);
  const ctl = useRef<AbortController | null>(null);
  const last = useRef<{ req: AgentTurnRequest; retryId?: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ctl.current?.abort();
    };
  }, []);
  const exec = useCallback(async (req: AgentTurnRequest, handlers: TurnHandlers = {}) => {
    if (ctl.current) return null;
    const controller = new AbortController();
    ctl.current = controller;
    last.current = { req };
    const set = (patch: Partial<AgentTurnState>) => {
      if (mounted.current && ctl.current === controller) setState((s) => ({ ...s, ...patch }));
    };
    setState({ ...IDLE, status: "running" });
    try {
      const result = await runAgentTurn(api, req, {
        onDelta: (full, piece) => { set({ text: full }); handlers.onDelta?.(full, piece); },
        onTrace: (live) => { set({ live }); handlers.onTrace?.(live); },
        onMeta: handlers.onMeta,
      }, controller.signal);
      set({ status: "done", result, text: result.text });
      return result;
    } catch (error) {
      last.current = { req, retryId: (error as { retryId?: string } | null)?.retryId };
      set({ status: controller.signal.aborted ? "idle" : "error", error });
      return null;
    } finally {
      if (ctl.current === controller) ctl.current = null;
    }
  }, [api]);
  const run = useCallback((req: Omit<AgentTurnRequest, "clientTurnId">, handlers?: TurnHandlers) => exec({ ...req }, handlers), [exec]);
  const retry = useCallback((handlers?: TurnHandlers) => {
    const prev = last.current;
    return prev ? exec({ ...prev.req, clientTurnId: prev.retryId }, handlers) : Promise.resolve(null);
  }, [exec]);
  const abort = useCallback(() => ctl.current?.abort(), []);
  return { ...state, run, retry, abort } as const;
}
