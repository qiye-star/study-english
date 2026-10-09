import { ChevronDownIcon, ChevronUpIcon, LanguagesIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import type { AssistEntry } from "../room-state";
import { assistMeta } from "./assist-meta";
import { DOCK_ROW_PX, dragHeight, nearestSnap, snapHeights, stepSnap, type DockSnap } from "./dock-snap";
import { SuggestionCard } from "./suggestion-card";

export type { DockSnap } from "./dock-snap";

/**
 * 助手停靠面板(spec 2026-10-10 §5,视觉稿 V2/V3/V13):输入条之上、实色 surface + 顶部发丝线 + 阴影,不模糊、不是弹层
 * (没有遮罩,不吞触摸;面板以上的聊天照常可见可滚动)。三档吸附 row(52px)/ mid(视口 28%)/ max(视口 40%);
 * 软键盘弹出时收成一行,键盘收起后回到原档(档位本身不变,只是高度按 keyboardOpen 取 52)。
 * 面板高度经 onHeight 报给房间页(列表底部内边距);面板贴在输入条上沿:量紧随其后的兄弟元素(房间页里的 RoomComposer)。
 * 「发送」后面板保持打开(R2-11);「改一改」= onEdit 并聚焦输入框(房间页把目标切回群聊、收成一行)。
 * 提问走输入条(目标「问助手」),面板里只有失败请求的「重试」用 onAsk。
 */
export interface AssistDockProps {
  open: boolean; snap: DockSnap; keyboardOpen: boolean; entries: AssistEntry[]; disabled: boolean; offline: boolean;
  onSnap(snap: DockSnap): void; onClose(): void; onAsk(text: string): boolean;
  onSend(text: string, assistId: string): void; onEdit(text: string): void; onHeight(px: number): void;
}

const iconKey = "flex size-tap flex-none items-center justify-center rounded-button text-ink-2 transition-colors duration-fast hover:bg-surface-2 "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[19px]";

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

export function AssistDock({ open, snap, keyboardOpen, entries, disabled, offline, onSnap, onClose, onAsk, onSend, onEdit, onHeight }: AssistDockProps): JSX.Element | null {
  const { t } = useTranslation();
  const viewport = useViewportHeight();
  const heights = snapHeights(viewport);
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startY: number; startHeight: number; moved: boolean } | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [bottom, setBottom] = useState(0);
  /** 本次会话里发到群里的建议:回复 id → 句子(一个 assist_id 只能用一次) */
  const [sent, setSent] = useState<Readonly<Record<string, string>>>({});
  const lastExpanded = useRef<DockSnap>(snap === "row" ? "mid" : snap);
  useEffect(() => { if (snap !== "row") lastExpanded.current = snap; }, [snap]);

  const effective: DockSnap = keyboardOpen ? "row" : snap;
  const row = effective === "row";
  const height = keyboardOpen ? DOCK_ROW_PX : dragged ?? heights[snap];
  useEffect(() => { onHeight(open ? height : 0); }, [open, height, onHeight]);

  // 贴住输入条上沿:输入条高度会随横幅、引用条、正在输入行变化
  useLayoutEffect(() => {
    const composer = open ? rootRef.current?.nextElementSibling : null;
    if (!(composer instanceof HTMLElement)) return;
    const measure = () => setBottom(composer.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(composer);
    return () => ro.disconnect();
  }, [open]);

  // 「N 条新建议」:面板收成一行时到达的回复;打开或展开即视为已看
  const replyIds = entries.flatMap((e) => (e.reply ? [e.reply.id] : []));
  const idsKey = replyIds.join(",");
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(replyIds));
  const wasOpen = useRef(false);
  useEffect(() => {
    if ((open && !wasOpen.current) || (open && !row)) setSeen(new Set(idsKey ? idsKey.split(",") : []));
    wasOpen.current = open;
  }, [open, row, idsKey]);
  const parsed = useMemo(() => entries.map((e) => (e.reply ? assistMeta(e.reply.meta) : null)), [entries]);
  const newCount = entries.reduce((n, e, i) => (e.reply && !seen.has(e.reply.id) ? n + (parsed[i]?.suggestions.length ?? 0) : n), 0);

  const last = entries.at(-1);
  const lastRef = useRef<HTMLDivElement>(null);
  // 新请求或新回复:把最新一条的开头(我的草稿)滚到面板顶部,读的顺序与视觉稿一致
  useEffect(() => {
    const body = bodyRef.current;
    const item = lastRef.current;
    if (body && item) body.scrollTop = Math.max(0, item.offsetTop - body.offsetTop);
  }, [open, row, entries.length, last?.status]);

  if (!open) return null;

  const lastMeta = parsed.at(-1);
  const summary = last?.status === "waiting" ? t("web.rooms.assist.waiting")
    : last?.status === "failed" ? t(`web.rooms.errors.assist_${last.error ?? "upstream"}`)
      : lastMeta?.suggestions[0]?.en ?? t("web.rooms.dock.rowHint");

  const toggle = () => {
    if (row) {
      if (keyboardOpen && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onSnap(snap === "row" ? lastExpanded.current : snap);
    } else {
      onSnap("row");
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      onSnap(stepSnap(effective, e.key === "ArrowUp" ? 1 : -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button > 0) return;
    drag.current = { id: e.pointerId, startY: e.clientY, startHeight: height, moved: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* 合成事件或不支持时无所谓 */
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    setDragged(dragHeight(d.startHeight, dy, viewport));
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      if (keyboardOpen && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onSnap(nearestSnap(dragHeight(d.startHeight, e.clientY - d.startY, viewport), viewport));
    }
    setDragged(null);
  };
  const edit = (text: string) => {
    onEdit(text);
    // 聚焦输入条的输入框(仍在这次点击里,iOS 才会弹出键盘)
    const composer = rootRef.current?.nextElementSibling;
    composer?.querySelector<HTMLInputElement>("[data-testid='room-input']")?.focus();
  };

  return (
    <section ref={rootRef} data-testid="assist-dock" aria-label={`${t("web.rooms.dock.name")} · ${t("web.rooms.dock.private")}`}
      style={{ height, bottom }}
      className={cn("absolute inset-x-0 z-[29] flex flex-col overflow-hidden rounded-t-[16px] bg-surface",
        "shadow-[inset_0_0.5px_0_var(--hair),0_-10px_28px_-18px_rgba(17,19,24,.35)] dark:shadow-[inset_0_0.5px_0_var(--hair),0_-10px_28px_-18px_rgba(0,0,0,.8)]",
        dragged === null && "transition-[height] duration-fast ease-standard motion-reduce:transition-none")}>
      {/* 抓手:盖住标题行左侧(不含右边两个键),44px 高;拖动、↑/↓、Enter 与双击都可以 */}
      <div role="separator" aria-orientation="horizontal" aria-label={t("web.rooms.dock.resize")} tabIndex={0}
        aria-valuemin={heights.row} aria-valuemax={heights.max} aria-valuenow={height}
        onKeyDown={onKeyDown} onDoubleClick={toggle}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
        className="absolute left-0 right-[92px] top-0 z-10 h-tap cursor-row-resize touch-none rounded-tl-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
      {!row && <div aria-hidden className="mx-auto mt-1.5 h-[5px] w-9 flex-none rounded-full bg-hair" />}
      <div className={cn("flex flex-none items-center gap-2 pl-3.5 pr-1", row ? "h-[52px]" : "h-11")}>
        <span aria-hidden className="inline-flex size-[26px] flex-none items-center justify-center rounded-[8px] bg-blue-tint text-blue [&_svg]:size-4">
          <LanguagesIcon />
        </span>
        {row ? (
          <p className="min-w-0 flex-1 truncate text-sub text-ink">
            <b className="font-semibold">{t("web.rooms.dock.name")}</b>{" · "}<span data-testid="assist-dock-summary">{summary}</span>
          </p>
        ) : (
          <>
            <b className="flex-none text-body font-semibold tracking-[-0.01em] text-ink">{t("web.rooms.dock.name")}</b>
            <small className="min-w-0 flex-1 truncate text-meta font-medium text-ink-2">{t("web.rooms.dock.private")}</small>
          </>
        )}
        {newCount > 0 && (
          <span className="inline-flex h-5 flex-none items-center whitespace-nowrap rounded-[7px] bg-amber-tint px-[7px] text-label font-semibold text-amber">
            {t("web.rooms.dock.newSuggestions", { count: newCount })}
          </span>
        )}
        <button type="button" data-testid="assist-dock-toggle" aria-label={row ? t("web.rooms.dock.expand") : t("web.rooms.dock.collapse")}
          aria-expanded={!row} onClick={toggle} className={iconKey}>{row ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}</button>
        <button type="button" data-testid="assist-dock-close" aria-label={t("web.rooms.dock.close")} onClick={onClose} className={iconKey}>
          <XIcon aria-hidden />
        </button>
      </div>
      {!row && (
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3.5 pb-2.5 [mask-image:linear-gradient(#000_calc(100%-18px),transparent)]">
          {entries.length === 0 && <p className="text-sub leading-dialogue text-ink-2">{t("web.rooms.dock.empty")}</p>}
          {entries.map((entry, i) => {
            const meta = parsed[i];
            const replyId = entry.reply?.id ?? null;
            const sentText = replyId ? sent[replyId] : undefined;
            const spent = !!meta?.used || sentText !== undefined;
            return (
              <div key={entry.requestId ?? replyId ?? `h${i}`} ref={i === entries.length - 1 ? lastRef : undefined} className="flex flex-col gap-2">
                {entry.request && (
                  <p className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-button rounded-tr-[6px] bg-blue-tint px-3 py-[7px] text-body text-ink">{entry.request}</p>
                )}
                {entry.status === "waiting" && <p role="status" className="text-meta text-ink-2">{t("web.rooms.assist.waiting")}</p>}
                {entry.status === "failed" && (
                  <div className="flex items-center gap-2">
                    <p role="alert" className="min-w-0 flex-1 text-meta text-ink-2">{t(`web.rooms.errors.assist_${entry.error ?? "upstream"}`)}</p>
                    {entry.request && (
                      <button type="button" disabled={disabled || offline} onClick={() => onAsk(entry.request)}
                        className="hit-expand inline-flex h-9 flex-none items-center gap-1 rounded-badge px-2.5 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 [&_svg]:size-4">
                        <RotateCwIcon aria-hidden />{t("web.rooms.dock.retry")}
                      </button>
                    )}
                  </div>
                )}
                {meta && (
                  <>
                    {meta.replyZh && <p className="text-sub leading-dialogue text-ink">{meta.replyZh}</p>}
                    {meta.glossary.length > 0 && (
                      <p className="flex flex-wrap gap-1.5">
                        {meta.glossary.map((g) => (
                          <span key={`${g.src}-${g.en}`} className="rounded-inline bg-surface-2 px-2 py-[3px] text-meta text-ink">{`${g.src} → ${g.en}`}</span>
                        ))}
                      </p>
                    )}
                    {meta.suggestions.map((s, j) => (
                      <SuggestionCard key={`${j}-${s.en}`} en={s.en} note={s.noteZh} used={sentText === s.en}
                        disabled={disabled || offline || !replyId || spent}
                        onSend={() => {
                          if (!replyId) return;
                          onSend(s.en, replyId);
                          setSent((cur) => ({ ...cur, [replyId]: s.en }));
                        }}
                        onEdit={() => edit(s.en)} />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
