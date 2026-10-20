import { useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { getGrammarPrompt } from "./grammar-prompt-api";

export type GrammarPromptStatus = "custom" | "default";

/**
 * 「我的」→ 语法检查规则 行的状态:读的是同一个 GET /api/me/grammar-prompt(prompt 为 null 即默认)。
 * 未加载或失败时返回 null,行上不显示状态,不影响跳转。
 */
export function useGrammarPromptStatus(): GrammarPromptStatus | null {
  const { api } = useAuth();
  const [status, setStatus] = useState<GrammarPromptStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getGrammarPrompt(api, controller.signal).then(
      (s) => { if (!controller.signal.aborted) setStatus(s.prompt != null ? "custom" : "default"); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api]);
  return status;
}
