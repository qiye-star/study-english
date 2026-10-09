import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { getRoomSummary, retryRoomSummary, SUMMARY_SERVER_ERRORS, type RoomSummaryView } from "./summary-api";

/** 生成中每 3 秒轮询一次,最多 60 秒(spec §6.1);之后提示稍后再看。 */
export const SUMMARY_POLL_MS = 3_000;
export const SUMMARY_POLL_MAX_MS = 60_000;
/** 房间刚在眼前结束:服务端先广播 closed,再建小结行;这段时间内 "none" 也按「生成中」轮询(review M5) */
export const SUMMARY_START_WAIT_MS = 15_000;

export interface RoomSummaryState {
  summary: RoomSummaryView | null;
  /** 取小结失败(已翻译的文案;房间未结束、不是成员、网络等) */
  error: string | null;
  /** 轮询满 60 秒仍在生成 */
  timedOut: boolean;
  retrying: boolean;
  retry(): void;
  reload(): void;
}

/** 小结卡片与小结页共用:取一次;pending 时轮询;failed 时可重试(成功后若回到 pending 继续轮询)。卸载后不再 setState。 */
export function useRoomSummary(roomId: string, { waitForStart = false }: { waitForStart?: boolean } = {}): RoomSummaryState {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [summary, setSummary] = useState<RoomSummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [round, setRound] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    setTimedOut(false);
    const tick = () => {
      getRoomSummary(api, roomId, ctrl.signal).then((s) => {
        if (ctrl.signal.aborted) return;
        setError(null);
        const starting = waitForStart && s.status === "none" && Date.now() - started + SUMMARY_POLL_MS <= SUMMARY_START_WAIT_MS;
        setSummary(starting ? { ...s, status: "pending" } : s);
        if (starting) {
          timer = setTimeout(tick, SUMMARY_POLL_MS);
          return;
        }
        if (s.status !== "pending") return;
        if (Date.now() - started + SUMMARY_POLL_MS > SUMMARY_POLL_MAX_MS) setTimedOut(true);
        else timer = setTimeout(tick, SUMMARY_POLL_MS);
      }, (err) => {
        if (!ctrl.signal.aborted) setError(translateServerError(tRef.current, err, SUMMARY_SERVER_ERRORS));
      });
    };
    tick();
    return () => {
      ctrl.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [api, roomId, round, waitForStart]);

  const retry = useCallback(() => {
    setRetrying(true);
    retryRoomSummary(api, roomId).then((s) => {
      if (!alive.current) return;
      setSummary(s);
      if (s.status === "pending") setRound((n) => n + 1); // 重新开始轮询(60 秒上限重新计)
    }, (err) => {
      if (alive.current) toast.error(translateServerError(tRef.current, err, SUMMARY_SERVER_ERRORS));
    }).finally(() => { if (alive.current) setRetrying(false); });
  }, [api, roomId]);
  const reload = useCallback(() => setRound((n) => n + 1), []);

  return { summary, error, timedOut, retrying, retry, reload };
}
