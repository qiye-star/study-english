import { useEffect, useRef } from "react";
import { loadAuth } from "~/api/auth-storage";
import { useAuth } from "~/auth/auth-context";
import { patchItem } from "./library-api";
import type { PlayerState } from "./use-media-player";

/** 播放中保存续播位置的最短间隔(spec §11.4)。 */
export const RESUME_INTERVAL_MS = 5000;

export interface ResumePoint { resumeMs: number; resumeIdx: number }

const same = (a: ResumePoint | null, b: ResumePoint | null) => !!a && !!b && a.resumeMs === b.resumeMs && a.resumeIdx === b.resumeIdx;

/** 节流的保存器:note 记录最新位置,距上次保存 ≥ 间隔才发;flush 立即发(位置没变则不发)。 */
export function createResumeSaver(
  save: (point: ResumePoint, keepalive: boolean) => void,
  opts: { now?: () => number; intervalMs?: number; initial?: ResumePoint } = {},
) {
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? RESUME_INTERVAL_MS;
  let latest: ResumePoint | null = null;
  let sent: ResumePoint | null = opts.initial ?? null;
  let lastAt = now();
  const send = (keepalive: boolean) => {
    if (!latest || same(latest, sent)) return;
    sent = latest;
    lastAt = now();
    save(latest, keepalive);
  };
  return {
    note(point: ResumePoint): void {
      latest = { resumeMs: Math.max(0, Math.round(point.resumeMs)), resumeIdx: Math.max(0, Math.round(point.resumeIdx)) };
      if (now() - lastAt >= interval) send(false);
    },
    flush(keepalive = false): void {
      send(keepalive);
    },
  };
}

/** 页面隐藏 / 离开时的保存:ApiClient 没有 keepalive,sendBeacon 带不了 Bearer,所以直接 fetch(R-L14)。 */
export function sendResumeKeepalive(itemId: string, point: ResumePoint, token: string | null, fetchImpl: typeof fetch = fetch): void {
  if (!token) return;
  try {
    void fetchImpl(`/api/library/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ resume_ms: point.resumeMs, resume_idx: point.resumeIdx }),
    }).catch(() => {});
  } catch {
    /* 离开页面时的尽力而为 */
  }
}

export type ResumeSource = { getState(): PlayerState; subscribe(fn: () => void): () => void; currentMs(): number };

/** 接线:每秒采样,播放中 ≥ 5 s 保存一次;暂停立即保存;隐藏 / pagehide / 卸载用 keepalive。 */
export function useResume(itemId: string, player: ResumeSource | null, opts: {
  initial?: ResumePoint; getToken?: () => string | null; fetchImpl?: typeof fetch; sampleMs?: number;
} = {}): void {
  const { api } = useAuth();
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    if (!player) return;
    const o = optsRef.current;
    const getToken = o.getToken ?? (() => loadAuth()?.token ?? null);
    const saver = createResumeSaver((point, keepalive) => {
      if (keepalive) sendResumeKeepalive(itemId, point, getToken(), o.fetchImpl);
      else void patchItem(api, itemId, point).catch(() => {});
    }, { initial: o.initial });
    const point = (): ResumePoint => ({ resumeMs: player.currentMs(), resumeIdx: Math.max(0, player.getState().index) });
    let wasPlaying = player.getState().playing;
    const unsubscribe = player.subscribe(() => {
      const playing = player.getState().playing;
      if (wasPlaying && !playing) {
        saver.note(point());
        saver.flush(false);
      }
      wasPlaying = playing;
    });
    const timer = setInterval(() => {
      if (player.getState().playing) saver.note(point());
    }, o.sampleMs ?? 1000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        saver.note(point());
        saver.flush(true);
      }
    };
    const onPageHide = () => {
      saver.note(point());
      saver.flush(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      saver.note(point());
      saver.flush(true);
    };
  }, [api, itemId, player]);
}
