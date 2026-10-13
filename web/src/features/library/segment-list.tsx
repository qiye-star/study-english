import { PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { borderGlowClass } from "./fx/border-glow";
import { motionAllowed } from "./fx/motion";
import { formatDuration } from "./format";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { SegmentText, ShadowPanel } from "./shadow-panel";
import { zhFor } from "./translation-state";
import type { PlayerHandle } from "./use-media-player";

/** 用户手动滚动后这么久内不自动滚到当前句(spec §11.4)。 */
export const MANUAL_SCROLL_GRACE_MS = 3000;

export interface SegmentListProps {
  itemId: string;
  segments: readonly LibrarySegment[];
  current: number;
  blind: boolean;
  durationMs: number;
  player: PlayerHandle | null;
  /** 母语码(`nativeLanguageCode`):译文只在语言一致时显示(E11) */
  native: string;
  /** 「译」是否打开(播放器已把「AI 开关 ∧ 有目标语言」算进去) */
  showTranslation: boolean;
  /** 正在取译文的句子序号(W2 的 use-translations 给):这些行显示骨架 */
  pending: ReadonlySet<number>;
  onSelect(idx: number): void;
  onSegmentSaved(next: LibrarySegment): void;
  now?: () => number;
}

/**
 * 句子列表(R-L17、R-L32):自带滚动容器(播放器是一个不滚动的 flex 列,文档与 <main> 都不滚,R-L33);当前句高亮 + 流动描边并滚到中间;
 * 盲听时文字与译文都不在 DOM 里;点句子文字或译文 = 跳到该句并播放(有文本选区时不跳,给查词让路)。
 */
export function SegmentList({
  itemId, segments, current, blind, durationMs, player, native, showTranslation, pending, onSelect, onSegmentSaved, now = Date.now,
}: SegmentListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLOListElement>(null);
  const manualAt = useRef(Number.NEGATIVE_INFINITY);
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    setRevealed(new Set());
  }, [blind]);

  useEffect(() => {
    if (current < 0 || now() - manualAt.current < MANUAL_SCROLL_GRACE_MS) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${current}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: motionAllowed() ? "smooth" : "auto" });
  }, [current, now]);

  const markManual = () => {
    manualAt.current = now();
  };
  const selectFromText = (idx: number) => {
    if (window.getSelection?.()?.toString()) return; // 有选区 = 用户在选词查词(R-L16)
    onSelect(idx);
  };

  return (
    <div data-testid="library-segments" onWheel={markManual} onTouchMove={markManual} className="lib-segments">
      {segments.length === 0 ? (
        <p className="px-6 py-10 text-center text-sub text-ink-2">{t("web.library.player.noSegments")}</p>
      ) : (
        <ol ref={listRef} className="flex flex-col">
          {segments.map((seg, i) => {
            const active = seg.idx === current;
            const hidden = blind && !revealed.has(seg.idx);
            const zh = showTranslation ? zhFor(seg, native) : null;
            return (
              <li key={seg.idx} data-idx={seg.idx} data-testid={`segment-${seg.idx}`} aria-current={active ? "true" : undefined}
                className={cn("lib-row", borderGlowClass(active))}>
                <div className="flex items-start gap-1.5">
                  <button type="button" onClick={() => onSelect(seg.idx)} aria-label={t("web.library.player.playSentence", { n: i + 1 })}
                    className="lib-row-play focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <PlayIcon aria-hidden className="h-4 w-4" />
                    <span className="num text-[11px] leading-none">{formatDuration(seg.startMs)}</span>
                  </button>
                  <div className="lib-seg-text" onClick={hidden ? undefined : () => selectFromText(seg.idx)}>
                    {hidden ? (
                      <button type="button" onClick={() => setRevealed((prev) => new Set(prev).add(seg.idx))}
                        className="min-h-tap rounded-button px-2 text-sub text-ink-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t("web.library.player.reveal")}
                      </button>
                    ) : (
                      <>
                        <div className={active ? "text-ink" : "text-ink-2"}><SegmentText segment={seg} active={active} /></div>
                        {showTranslation && zh ? (
                          <p lang={native} data-testid={`segment-zh-${seg.idx}`} className="lib-zh">{zh}</p>
                        ) : showTranslation && pending.has(seg.idx) ? (
                          <span aria-hidden data-testid={`segment-zh-skeleton-${seg.idx}`} className="lib-zh-skeleton" />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                <ShadowPanel itemId={itemId} segment={seg} active={active} durationMs={durationMs}
                  prevEndMs={segments[i - 1]?.endMs ?? null} nextStartMs={segments[i + 1]?.startMs ?? null}
                  player={player} onSegmentSaved={onSegmentSaved} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
