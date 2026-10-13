import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { mediaTicket } from "./library-api";

/** 连续换票的上限(中间没有成功播放就停,R-L15)。 */
export const MAX_TICKET_REFRESHES = 2;

export type MediaSourceTarget = Pick<HTMLMediaElement, "currentTime" | "paused" | "play" | "addEventListener" | "removeEventListener">;

/**
 * 媒体地址 = 服务端签发的同源票据 URL(spec E4;`<video>` 发不了 Bearer)。媒体元素报 error(多半是票据过期)
 * 时重新取票,新地址加载出元数据后恢复时间与播放状态。票据 URL 只交给 src,不打印。
 */
export function useMediaSource(itemId: string, enabled: boolean, media: MediaSourceTarget | null) {
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refreshes = useRef(0);
  const pending = useRef<{ at: number; play: boolean } | null>(null);

  const fetchTicket = useCallback(async () => {
    try {
      const ticket = await mediaTicket(api, itemId);
      setError(null);
      setUrl(ticket.url);
    } catch (err) {
      setError(err);
    }
  }, [api, itemId]);

  useEffect(() => {
    if (enabled) void fetchTicket();
  }, [enabled, fetchTicket]);

  useEffect(() => {
    if (!media) return;
    const onError = () => {
      if (refreshes.current >= MAX_TICKET_REFRESHES) {
        setError(new Error("media"));
        return;
      }
      refreshes.current += 1;
      pending.current = { at: media.currentTime, play: !media.paused };
      void fetchTicket();
    };
    const onLoaded = () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      media.currentTime = p.at;
      if (p.play) void Promise.resolve(media.play()).catch(() => {});
    };
    const onPlaying = () => {
      refreshes.current = 0;
    };
    media.addEventListener("error", onError);
    media.addEventListener("loadedmetadata", onLoaded);
    media.addEventListener("playing", onPlaying);
    return () => {
      media.removeEventListener("error", onError);
      media.removeEventListener("loadedmetadata", onLoaded);
      media.removeEventListener("playing", onPlaying);
    };
  }, [media, fetchTicket]);

  const retry = useCallback(() => {
    refreshes.current = 0;
    setError(null);
    void fetchTicket();
  }, [fetchTicket]);

  return { url, error, retry };
}
