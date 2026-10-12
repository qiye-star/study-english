import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { TUTOR_SERVER_ERRORS, finishTutor, getTutor, hintTutor, skipTutor, type TutorSession } from "./tutor-api";
import { applyMeta, needsAgentTurn, parseTutorMeta } from "./tutor-model";

export interface UseTutorSessionOptions {
  api: ApiClient;
  /** 对话页进入导师模式时拿到的会话 id(开始面板的 onStarted) */
  sessionId: string;
  /** 对话页最近一次回合的 meta 事件(camel / snake 都接受;null = 还没有) */
  meta: unknown;
  /** 让智能体出题:对话页再跑一个 text = null 的导师回合(跳过后、「继续」) */
  onContinue(): void;
  onError(message: string): void;
}

/**
 * 一个进行中的带学会话:挂载时 GET 一次,之后由回合的 `meta` 事件推进本地副本(服务端已推进状态机,省一次 GET);
 * 提示 / 跳过 / 结束走 REST;最后一题答完(wrap_up)自动结束一次。从不自动重试。
 */
export function useTutorSession(options: UseTutorSessionOptions) {
  const { t } = useTranslation();
  const opts = useRef(options);
  opts.current = options;
  const [session, setSessionState] = useState<TutorSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHintState] = useState<string | null>(null);
  const [hintZh, setHintZh] = useState<string | null>(null);
  const setHint = useCallback((next: string | null, zh: string | null = null) => { setHintState(next); setHintZh(zh); }, []);
  const sessionRef = useRef<TutorSession | null>(null);
  const finishing = useRef<string | null>(null);

  const setSession = useCallback((next: TutorSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);
  const fail = useCallback((err: unknown) => opts.current.onError(translateServerError(t, err, TUTOR_SERVER_ERRORS)), [t]);

  const { api, sessionId, meta } = options;
  const load = useCallback((live: () => boolean, signal: AbortSignal) => {
    getTutor(api, sessionId, signal)
      .then((s) => { if (live()) setSession(s); })
      .catch((err) => { if (live()) fail(err); });
  }, [api, sessionId, fail, setSession]);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setSession(null);
    setHint(null);
    finishing.current = null;
    load(() => live, controller.signal);
    return () => { live = false; controller.abort(); };
  }, [sessionId, load, setSession]);

  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (!meta || handled.current === meta) return;
    handled.current = meta;
    const parsed = parseTutorMeta(meta);
    if (!parsed) return;
    const current = sessionRef.current;
    if (!current) {
      // 会话还没取回来:取回的就是服务端推进后的状态
      const controller = new AbortController();
      load(() => !controller.signal.aborted, controller.signal);
      return;
    }
    setHint(null);
    setSession(applyMeta(current, parsed));
  }, [meta, load, setSession]);

  const finish = useCallback(async (): Promise<TutorSession | null> => {
    const s = sessionRef.current;
    if (!s || finishing.current === s.id) return null;
    finishing.current = s.id;
    setBusy(true);
    try {
      const done = await finishTutor(opts.current.api, s.id);
      setSession(done);
      setHint(null);
      return done;
    } catch (err) {
      finishing.current = null;
      fail(err);
      return null;
    } finally {
      setBusy(false);
    }
  }, [fail, setSession]);

  useEffect(() => {
    if (session && session.status === "active" && session.phase === "wrap_up") void finish();
  }, [session, finish]);

  const skip = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setBusy(true);
    let next: TutorSession | null = null;
    try {
      next = await skipTutor(opts.current.api, s.id);
      setHint(null);
      setSession(next);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
    if (needsAgentTurn(next)) opts.current.onContinue();
  }, [fail, setSession]);

  const requestHint = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setBusy(true);
    try {
      const r = await hintTutor(opts.current.api, s.id);
      setSession(r.session);
      setHint(r.hint, typeof r.hintZh === "string" && r.hintZh.trim() ? r.hintZh.trim() : null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [fail, setSession]);

  const resume = useCallback(() => {
    if (needsAgentTurn(sessionRef.current)) opts.current.onContinue();
  }, []);

  return { session, busy, hint, hintZh, skip, requestHint, finish, resume } as const;
}
