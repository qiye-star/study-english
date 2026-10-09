import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig } from "~/api/server-config";
import { toAssessmentWav } from "~/audio/convert";
import { useRecorder } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import { useTtsPlayer } from "~/features/chat";
import { initialMatchState, lastAiLine, matchReducer, type RetryStep } from "./match-machine";
import { abandonMatch, finishMatch, getMatch, RANK_SERVER_ERRORS, sendTurn } from "./rank-api";

/** 手势上限略短于录音上限:先由手势收尾(正常发送),录音自身的自动停止只是兜底。服务端每轮上限 30 秒。 */
export const MAX_HOLD_MS = 29_500;
const MAX_RECORD_MS = 31_000;

export interface MatchRecorder { start(): Promise<boolean>; stop(): Promise<Blob | null>; cancel(): void }
export interface MatchDeps {
  speak?: (key: string, text: string) => Promise<void>;
  recordWav?: () => MatchRecorder;
}

/** 真实的录音:useRecorder 录完转成 16 kHz 单声道 WAV(与跟读评测同一条转换)。 */
function useRealRecorder(): () => MatchRecorder {
  const recorder = useRecorder({ maxDurationMs: MAX_RECORD_MS });
  const ref = useRef(recorder);
  ref.current = recorder;
  return useCallback(() => ({
    start: () => ref.current.start(),
    stop: async () => {
      const result = await ref.current.stop();
      return result ? (await toAssessmentWav(result.blob)).wav : null;
    },
    cancel: () => ref.current.cancel(),
  }), []);
}

/** 晋级赛的副作用层:加载/续赛、播放考官台词、录音上传、评分、放弃。状态转移全在 match-machine。 */
export function useMatch(id: string, deps: MatchDeps = {}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(matchReducer, undefined, initialMatchState);
  const tts = useTtsPlayer(api);
  const realRecorder = useRealRecorder();
  const recorderRef = useRef<MatchRecorder>((deps.recordWav ?? realRecorder)());
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const tRef = useRef(t);
  tRef.current = t;
  // 同一句台词只播一次、同一场只评一次(StrictMode 下副作用会跑两遍)
  const spokenRef = useRef<string | null>(null);
  const finishingRef = useRef(false);

  // 稳定引用:deps 与 tts 每次渲染都是新对象,放进依赖会让"AI 说话"副作用反复触发
  const speak = useCallback(async (key: string, text: string) => {
    if (depsRef.current.speak) return depsRef.current.speak(key, text);
    const { defaultTts } = await loadServerAiConfig(api);
    await ttsRef.current.play(key, text, defaultTts.model, defaultTts.voice);
  }, [api]);
  const fail = useCallback((err: unknown, retry: RetryStep) =>
    dispatch({ type: "failed", error: translateServerError(tRef.current, err, RANK_SERVER_ERRORS), retry }), []);

  useEffect(() => () => {
    recorderRef.current.cancel();
    ttsRef.current.stop();
  }, []);

  useEffect(() => {
    if (state.phase !== "loading") return;
    const ctrl = new AbortController();
    getMatch(api, id, ctrl.signal).then((r) => dispatch({ type: "loaded", ...r }), (err) => { if (!ctrl.signal.aborted) fail(err, "load"); });
    return () => ctrl.abort();
  }, [api, id, state.phase, fail]);

  useEffect(() => {
    if (state.phase !== "ai_speaking" || !state.match) return;
    const key = `rank-${id}-${state.match.turns.length}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    void speak(key, lastAiLine(state.match)).catch((): void => undefined).finally(() => dispatch({ type: "ai_done" }));
  }, [state.phase, state.match, id, speak]);

  useEffect(() => {
    if (state.phase !== "grading" || finishingRef.current) return;
    finishingRef.current = true;
    finishMatch(api, id)
      .then((r) => dispatch({ type: "finished", ...r }), (err) => fail(err, "finish"))
      .finally(() => { finishingRef.current = false; });
  }, [api, id, state.phase, fail]);

  const press = useCallback(async () => {
    recorderRef.current = (depsRef.current.recordWav ?? realRecorder)();
    const ok = await recorderRef.current.start();
    if (ok) dispatch({ type: "press" });
    return ok;
  }, [realRecorder]);

  const release = useCallback(() => {
    dispatch({ type: "release" });
    void (async () => {
      try {
        const wav = await recorderRef.current.stop();
        if (!wav) return dispatch({ type: "failed", error: tRef.current("web.rank.errors.tooShort"), retry: "turn" });
        dispatch({ type: "turn_ok", result: await sendTurn(api, id, wav) });
      } catch (err) {
        fail(err, "turn");
      }
    })();
  }, [api, id, fail]);

  return {
    state,
    /** 开始:在点击的同步阶段预热播放(iOS),随后播第一句台词 */
    begin: () => { ttsRef.current.prime(); dispatch({ type: "begin" }); },
    press,
    release,
    /** 松手的同步阶段:预热播放,下一句台词才不会被 iOS 拦截 */
    prime: () => ttsRef.current.prime(),
    cancel: () => { recorderRef.current.cancel(); dispatch({ type: "cancel" }); },
    replay: () => { if (state.match) void speak(`rank-${id}-replay-${Date.now()}`, lastAiLine(state.match)).catch((): void => undefined); },
    toggleText: () => dispatch({ type: "toggle_text" }),
    retry: () => dispatch({ type: "retry" }),
    abandon: async () => {
      try {
        recorderRef.current.cancel();
        ttsRef.current.stop();
        dispatch({ type: "ended", match: await abandonMatch(api, id) });
      } catch (err) {
        fail(err, "load");
      }
    },
  };
}
