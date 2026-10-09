import { ChevronLeftIcon, CopyIcon, SlidersHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { GlassTopBar, useScrolled } from "~/components/glass-top-bar";
import { IconButton } from "~/components/icon-button";
import { PageHeader } from "~/layout/page-header";
import { AssistTray } from "./assist-tray";
import type { RoomMessage } from "./protocol";
import { RoomComposer } from "./room-composer";
import { RoomMessageList } from "./room-message-list";
import { RoomSettingsSheet } from "./room-settings-sheet";
import type { RoomState } from "./room-state";
import { fetchRoomsConfig, reportMessage, ROOMS_SERVER_ERRORS } from "./rooms-api";
import { ghostButton } from "./ui";
import { useRoom } from "./use-room";

const REPORT_REASONS = ["spam", "abuse", "other"] as const;
const CLOSE_KEYS: Record<string, string> = {
  kicked: "web.rooms.errors.kickedClose", not_found: "web.rooms.errors.notFound", ended: "web.rooms.room.closedNote",
  owner: "web.rooms.errors.closed_owner", idle: "web.rooms.errors.closed_idle", expired: "web.rooms.errors.closed_expired",
  disabled: "web.rooms.errors.closed_disabled", protocol: "web.rooms.errors.closed_protocol", admin: "web.rooms.errors.closed_admin",
};
const NOTICE_MS = 5000;

/** 复制房间号:非 HTTPS(局域网部署)没有 navigator.clipboard,退回 execCommand;都不行时把号码直接告诉用户。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退回下面的办法 */
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** 房间 /rooms/r/:roomId:先确认功能已开,再连接。 */
export function RoomPage() {
  const { roomId = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>("loading");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRoomsConfig(api, ctrl.signal).then((c) => {
      setAiAvailable(c.aiAvailable);
      setState(c.enabled ? "ready" : "disabled");
    }, () => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  if (state === "ready") return <RoomView key={roomId} roomId={roomId} aiAvailable={aiAvailable} />;
  return (
    <>
      <PageHeader title={t("web.rooms.room.title")} back="/rooms" />
      <FeatureGate state={state} disabledText={t("web.rooms.disabled")} onRetry={() => setAttempt((n) => n + 1)}>{null}</FeatureGate>
    </>
  );
}

function bannerText(t: (key: string) => string, state: RoomState): string | null {
  if (state.status === "closed") return t(CLOSE_KEYS[state.closeReason ?? ""] ?? "web.rooms.room.closedNote");
  if (state.status === "reconnecting") return t("web.rooms.room.reconnecting");
  return null;
}

/**
 * 房间群聊(视觉稿 M2):玻璃顶栏(话题 + 房间号点按复制 + 在线人数,右侧成员与设置)、底部锚定的消息列表、玻璃输入条。
 * 与对话页同构:顶栏与输入条浮在列表上,列表自己滚动。
 */
function RoomView({ roomId, aiAvailable }: { roomId: string; aiAvailable: boolean }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const room = useRoom(roomId);
  const { state, dismiss, loadEarlier: loadMore } = room;
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [reporting, setReporting] = useState<RoomMessage | null>(null);
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(64);
  const scrolled = useScrolled(listRef);
  const stick = useRef(true);
  const prependFrom = useRef<number | null>(null);

  const closed = state.status === "closed";
  /** 没连上(连接中/重连中)时不能发送:输入保留,按钮禁用,横幅说明 */
  const offline = state.status !== "live";
  const info = state.room;
  const online = state.members.filter((m) => m.online).length;

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const measure = () => setComposerHeight(el.offsetHeight || 64);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 底部锚定:在底部附近时跟随新消息;加载更早的消息时保持当前位置
  const firstSeq = state.messages[0]?.seq;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.messages.length, firstSeq, state.pending.length, state.aiTyping.length, composerHeight]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const loadEarlier = useCallback(() => {
    prependFrom.current = listRef.current?.scrollHeight ?? null;
    loadMore().catch((err) => {
      prependFrom.current = null;
      toast.error(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    });
  }, [loadMore, t]);

  // 提示与错误 5 秒后自动消失
  useEffect(() => {
    if (!state.notice && !state.error) return;
    const timer = setTimeout(dismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice, state.error, dismiss]);

  const send = () => {
    if (room.say(draft)) {
      setDraft("");
      stick.current = true;
    }
  };
  async function report(reason: (typeof REPORT_REASONS)[number]) {
    const target = reporting;
    setReporting(null);
    if (!target) return;
    try {
      await reportMessage(api, roomId, target.id, reason);
      setReported((cur) => new Set(cur).add(target.id));
      toast.success(t("web.rooms.room.reported"));
    } catch (err) {
      toast.error(translateServerError(t, err, ROOMS_SERVER_ERRORS));
    }
  }

  const status = bannerText(t, state);
  const message = state.notice ? t(`web.rooms.notice.${state.notice}`) : state.error ? t(`web.rooms.errors.${state.error}`) : null;
  const code = info?.code;
  const subtitle = closed || info?.status === "closed" ? t("web.rooms.room.ended") : code ? (
    <button type="button" data-testid="room-code" className="hit-expand inline-flex max-w-full items-center gap-1 tabular-nums"
      onClick={() => void copyText(code).then((ok) => (ok ? toast.success(t("web.rooms.room.copied")) : toast(t("web.rooms.room.copyManual", { code }))))}>
      <span className="truncate">{t("web.rooms.room.code", { code: `${code.slice(0, 3)} ${code.slice(3)}` })} · {t("web.rooms.room.online", { count: online })}</span>
      <CopyIcon aria-hidden className="size-3 flex-none" />
    </button>
  ) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <GlassTopBar className="absolute inset-x-0 top-0" scrolled={scrolled}
        title={info?.topic || t("web.rooms.room.title")} subtitle={subtitle}
        leading={<IconButton label={t("web.common.back")} onClick={() => navigate("/rooms")}><ChevronLeftIcon /></IconButton>}
        actions={info ? <IconButton label={t("web.rooms.settings.title")} onClick={() => setSettings(true)}><SlidersHorizontalIcon /></IconButton> : undefined} />
      {/* 读屏只播报实时到达的别人的消息;列表本身不是 live 区域(补发与「加载更早」不该被整页朗读) */}
      <div data-testid="room-announcer" role="log" aria-live="polite" className="sr-only">
        {state.announce ? `${state.announce.kind === "ai_answer" ? t("web.rooms.room.aiName") : state.announce.sender.name ?? "?"}: ${state.announce.text}` : ""}
      </div>
      <div ref={listRef} data-testid="room-messages" onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-gutter"
        style={{ paddingTop: "calc(52px + env(safe-area-inset-top) + 12px)", paddingBottom: composerHeight + 14 }}>
        <div aria-hidden className="mt-auto" />
        {closed && state.room && state.messages.length === 0 && (
          <p className="py-8 text-center text-sub text-ink-2">{t("web.rooms.room.historyEmpty")}</p>
        )}
        <RoomMessageList state={state} reported={reported} onLoadEarlier={loadEarlier} onReport={setReporting} />
      </div>
      <RoomComposer ref={composerRef} disabled={closed} offline={offline} ai={aiAvailable} value={draft} onChange={setDraft} onSend={send}
        onOpenAssist={() => setAssistOpen(true)}
        banner={status ?? message ?? (state.status === "connecting" ? t("web.rooms.room.connecting") : null)}
        onDismiss={!status && message ? dismiss : undefined} />
      <RoomSettingsSheet open={settings} onOpenChange={setSettings} state={state} onChanged={room.applyRoom} />
      <BottomSheet open={!!reporting} onOpenChange={(v) => { if (!v) setReporting(null); }}>
        <BottomSheetContent>
          <BottomSheetHeader title={t("web.rooms.room.reportTitle")} description={t("web.rooms.room.reportHint")} srOnlyDescription />
          <div className="space-y-2">
            {REPORT_REASONS.map((reason) => (
              <button key={reason} type="button" className={ghostButton} onClick={() => void report(reason)}>
                {t(`web.rooms.room.reportReasons.${reason}`)}
              </button>
            ))}
          </div>
        </BottomSheetContent>
      </BottomSheet>
      <AssistTray open={assistOpen} onOpenChange={setAssistOpen} entries={state.assist} disabled={closed} offline={offline}
        onAsk={(text) => room.ask(text) !== null}
        onSend={(text, assistId) => { if (room.say(text, assistId)) { stick.current = true; setAssistOpen(false); } }}
        onEdit={(text) => { setDraft(text); setAssistOpen(false); }} />
    </div>
  );
}
