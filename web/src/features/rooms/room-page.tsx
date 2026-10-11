import { ChevronLeftIcon, CopyIcon, SlidersHorizontalIcon, UserPlusIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { AssistDock, type DockSnap } from "./assist/assist-dock";
import { AssistEntry } from "./assist/assist-entry";
import { useSoftKeyboard } from "./assist/use-soft-keyboard";
import { agentOf } from "./agents/agent-meta";
import { PersonaSheet } from "./agents/persona-sheet";
import { TutorBar } from "./agents/tutor-bar";
import { useRoomAgents } from "./agents/use-room-agents";
import { JoinRequestBanner } from "./create/join-requests";
import { ActivityLine } from "./extras/activity-line";
import { InviteSheet } from "./extras/invite-sheet";
import { QuoteBar } from "./extras/quote-block";
import { canReopen, ReopenBar } from "./extras/reopen-bar";
import { SummaryCard } from "./extras/summary-card";
import { useTypingEmitter } from "./extras/use-typing-emitter";
import { ROOM_PROTOCOL_VERSION, type QuoteInfo, type RoomMessage } from "./protocol";
import { RoomComposer } from "./room-composer";
import { RoomMessageList } from "./room-message-list";
import { RoomSettingsSheet } from "./room-settings-sheet";
import type { RoomState } from "./room-state";
import { fetchRoomsConfig, reportMessage, ROOMS_SERVER_ERRORS, type RoomsConfig } from "./rooms-api";
import { ghostButton } from "./ui";
import { useRoom } from "./use-room";
import { useRoomVoiceAutoText } from "./voice/auto-text";
import { useRoomVoice } from "./voice/use-room-voice";
import { formatVoiceDuration } from "./voice/voice-bubble";
import { VoiceInput } from "./voice/voice-input";

const REPORT_REASONS = ["spam", "abuse", "other"] as const;
const CLOSE_KEYS: Record<string, string> = {
  kicked: "web.rooms.errors.kickedClose", not_found: "web.rooms.errors.notFound", ended: "web.rooms.room.closedNote",
  owner: "web.rooms.errors.closed_owner", idle: "web.rooms.errors.closed_idle", expired: "web.rooms.errors.closed_expired",
  disabled: "web.rooms.errors.closed_disabled", protocol: "web.rooms.errors.closed_protocol", admin: "web.rooms.errors.closed_admin",
};
const NOTICE_MS = 5000;
/** 在房间里亲眼看到的结束(收到 closed 事件):学习小结马上要开始生成(review M5) */
const LIVE_CLOSE = new Set(["owner", "idle", "expired", "admin"]);

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
  const [config, setConfig] = useState<RoomsConfig | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRoomsConfig(api, ctrl.signal).then((c) => {
      setConfig(c);
      setState(c.enabled ? "ready" : "disabled");
    }, () => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  if (state === "ready" && config) return <RoomView key={roomId} roomId={roomId} config={config} />;
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

const quoteOf = (m: RoomMessage): QuoteInfo => ({ seq: m.seq, name: m.kind === "ai_answer" ? null : m.sender.name, kind: m.kind, text: m.text });

/**
 * 房间群聊(视觉稿 rooms-v2):玻璃顶栏(房间名 + 房间号点按复制 + 在线人数,右侧邀请、成员与设置)、底部锚定的消息列表、
 * 助手停靠面板(在输入条之上,不遮挡聊天)、玻璃输入条。与对话页同构:顶栏与输入条浮在列表上,列表自己滚动。
 *
 * F5 之后本文件冻结(计划 2026-10-10 rooms-v2):各车道只替换 voice/ assist/ extras/ create/ 里的插槽实现,签名不变;
 * 需要改这里时在计划里写 Addendum,由 foundation 执行者改。
 */
function RoomView({ roomId, config }: { roomId: string; config: RoomsConfig }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const room = useRoom(roomId);
  const { state, dismiss, loadEarlier: loadMore } = room;

  // 管理员为本房关闭了 AI:助手入口与 @ 键都不显示(spec §5.2,review m9)
  const aiAvailable = config.aiAvailable && !state.room?.aiMuted;
  const [draft, setDraft] = useState("");
  const [settings, setSettings] = useState(false);
  const [reporting, setReporting] = useState<RoomMessage | null>(null);
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set());
  // v2 插槽状态
  const [target, setTarget] = useState<"group" | "assist">("group");
  const [quote, setQuote] = useState<RoomMessage | null>(null);
  const [voiceMode, setVoiceMode] = useState<"text" | "voice">("text");
  const [dockOpen, setDockOpen] = useState(false);
  const [dockSnap, setDockSnap] = useState<DockSnap>("mid");
  const [dockHeight, setDockHeight] = useState(0);
  const [unread, setUnread] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const keyboardOpen = useSoftKeyboard();
  const autoText = useRoomVoiceAutoText();
  const typingEmitter = useTypingEmitter(room.typing);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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
  const ended = closed || info?.status === "closed";
  const justClosed = closed && LIVE_CLOSE.has(state.closeReason ?? "") && !!config.summaryAvailable;
  const isOwner = state.me?.role === "owner" || info?.myRole === "owner";
  const voiceEnabled = !!config.voiceAvailable && !!info?.allowVoice && !closed;
  // 联机智能体(plan 2026-10-12-agents-rooms Addendum AR-1):角色名单、角色信息面板;带练条在输入条上方
  const agentIds = info?.agentIds ?? [];
  const { info: agentsInfo } = useRoomAgents(api, roomId, agentIds, agentIds.length > 0 && !ended);
  const agentNames = useMemo(() => (agentsInfo?.agents ?? []).map((a) => a.name), [agentsInfo]);
  const [agentSheet, setAgentSheet] = useState<string | null>(null);

  const voice = useRoomVoice({
    roomId, enabled: voiceEnabled, maxMs: config.maxVoiceMs, target, replyTo: quote?.seq ?? null,
    onFill: (text) => { setDraft(text); setVoiceMode("text"); },
    onAssistDraft: (text) => { room.ask(text); },
    onSent: (message) => { room.addMessage(message); setQuote(null); stick.current = true; },
    onActivity: (s) => { room.typing(s); },
  });

  // 新的助手回复到达而面板关闭或收成一行:入口亮未读点(welcome 带回的历史条目 requestId 为 null,不算新)
  // 「看得见」= 面板打开、没收成一行、键盘也没把它压成一行;看得见时清除未读(spec §5.2,review m3)
  const doneReplies = state.assist.filter((a) => a.status === "done" && a.requestId !== null).length;
  const seenReplies = useRef(doneReplies);
  const dockShowing = dockOpen && dockSnap !== "row" && !keyboardOpen;
  useEffect(() => {
    if (doneReplies > seenReplies.current && !dockShowing) setUnread(true);
    seenReplies.current = doneReplies;
  }, [doneReplies, dockShowing]);
  useEffect(() => { if (dockShowing) setUnread(false); }, [dockShowing]);
  const toggleDock = () => {
    if (dockOpen) {
      setDockOpen(false);
      setTarget("group");
    } else {
      setDockOpen(true);
      setTarget("assist");
      setUnread(false);
    }
  };
  const closeDock = useCallback(() => { setDockOpen(false); setTarget("group"); }, []);
  const joinRequests = useMemo(() => state.joinRequests.filter((r) => !decided.has(r.id)), [state.joinRequests, decided]);

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
  }, [state.messages.length, firstSeq, state.pending.length, state.aiTyping.length, composerHeight, dockHeight]);
  // 内容自己变高(点开最后一条的操作行、转写到达、回应出现、展开译文):在底部时继续贴底,不让它藏到输入条下面(review M6)
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const list = listRef.current;
      if (list && stick.current && prependFrom.current === null) list.scrollTop = list.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
    if (target === "assist") {
      if (room.ask(draft) !== null) setDraft("");
      return;
    }
    if (room.say(draft, null, quote?.seq ?? null)) {
      setDraft("");
      setQuote(null);
      typingEmitter.onSent();
      stick.current = true;
    }
  };
  const changeDraft = (text: string) => {
    setDraft(text);
    if (target === "group") typingEmitter.onDraft(text);
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
  const announced = state.announce;
  const announceText = !announced ? "" : announced.kind === "voice" && !announced.text
    ? t("web.rooms.voice.announce", { name: announced.sender.name ?? "?", duration: formatVoiceDuration(announced.voice?.durationMs ?? 0) })
    : `${announced.kind === "ai_answer" ? agentOf(announced)?.agent.name ?? t("web.rooms.room.aiName") : announced.sender.name ?? "?"}: ${announced.text}`;
  const listTop = "calc(52px + env(safe-area-inset-top) + 12px)";
  const listBottom = composerHeight + dockHeight + 14;
  const message = state.notice ? t(`web.rooms.notice.${state.notice}`) : state.error ? t(`web.rooms.errors.${state.error}`) : null;
  const newVersion = state.protocol > ROOM_PROTOCOL_VERSION ? t("web.rooms.room.newVersion") : null;
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
        title={info?.name || info?.topic || t("web.rooms.room.title")} subtitle={subtitle}
        leading={<IconButton label={t("web.common.back")} onClick={() => navigate("/rooms")}><ChevronLeftIcon /></IconButton>}
        actions={info ? (
          <>
            {!ended && (
              <IconButton data-testid="room-invite" label={t("web.rooms.room.invite")} onClick={() => setInviteOpen(true)}><UserPlusIcon /></IconButton>
            )}
            <IconButton label={t("web.rooms.settings.title")} onClick={() => setSettings(true)}><SlidersHorizontalIcon /></IconButton>
          </>
        ) : undefined} />
      {isOwner && !ended && joinRequests.length > 0 && (
        <div className="absolute inset-x-0 z-20 px-gutter" style={{ top: "calc(52px + env(safe-area-inset-top) + 4px)" }}>
          <JoinRequestBanner roomId={roomId} requests={joinRequests} onDecided={(id) => setDecided((cur) => new Set(cur).add(id))} />
        </div>
      )}
      {/* 读屏只播报实时到达的别人的消息;列表本身不是 live 区域(补发与「加载更早」不该被整页朗读) */}
      <div data-testid="room-announcer" role="log" aria-live="polite" className="sr-only">
        {announceText}
      </div>
      <div ref={listRef} data-testid="room-messages" onScroll={onScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-gutter"
        style={{ paddingTop: listTop, paddingBottom: listBottom, scrollPaddingTop: listTop, scrollPaddingBottom: listBottom }}>
        <div aria-hidden className="mt-auto" />
        <div ref={contentRef} className="flex flex-col">
        {ended && info && <SummaryCard roomId={roomId} justClosed={justClosed} />}
        {ended && canReopen(info, state.closeReason, isOwner) && <ReopenBar roomId={roomId} onReopened={room.reopened} />}
        {closed && state.room && state.messages.length === 0 && (
          <p className="py-8 text-center text-sub text-ink-2">{t("web.rooms.room.historyEmpty")}</p>
        )}
        <RoomMessageList state={state} roomId={roomId} reported={reported} autoText={autoText} onLoadEarlier={loadEarlier} onReport={setReporting}
          onReact={room.react} onQuote={(m) => { setQuote(m); setTarget("group"); }}
          onTranslateVoice={room.translateVoice} onRetryVoice={room.retryVoice} agentNames={agentNames} onOpenAgent={setAgentSheet} />
        </div>
      </div>
      <AssistDock open={dockOpen && aiAvailable} snap={dockSnap} keyboardOpen={keyboardOpen} entries={state.assist} disabled={closed} offline={offline}
        onSnap={setDockSnap} onClose={closeDock}
        onAsk={(text) => room.ask(text) !== null}
        onSend={(text, assistId) => { if (room.say(text, assistId)) stick.current = true; }}
        onEdit={(text) => {
          // 语音模式下也要有文本框可聚焦:同步渲染出来,AssistDock 随后在同一次点按里聚焦(iOS 才弹键盘,review M8)
          flushSync(() => { setDraft(text); setTarget("group"); setDockSnap("row"); setVoiceMode("text"); });
        }}
        onHeight={setDockHeight} />
      <RoomComposer ref={composerRef} disabled={closed} offline={offline} ai={aiAvailable} value={draft} onChange={changeDraft} onSend={send}
        leading={aiAvailable ? <AssistEntry open={dockOpen} unread={unread} disabled={closed} onToggle={toggleDock} /> : undefined}
        target={target} onClearTarget={() => setTarget("group")}
        voice={{ available: voiceEnabled, mode: voiceMode, onToggle: () => setVoiceMode((m) => (m === "voice" ? "text" : "voice")),
          input: <VoiceInput voice={voice} disabled={closed || offline} maxMs={config.maxVoiceMs} /> }}
        above={(
          <>
            {quote && <QuoteBar quote={quoteOf(quote)} onClear={() => setQuote(null)} />}
            <ActivityLine activity={state.activity} members={state.members} meId={state.me?.userId ?? null} />
            <TutorBar tutor={state.tutor} receivedAt={state.tutorAt} meId={state.me?.userId ?? null} isOwner={isOwner} roomId={roomId} disabled={closed || offline} />
          </>
        )}
        banner={status ?? message ?? newVersion ?? (state.status === "connecting" ? t("web.rooms.room.connecting") : null)}
        onDismiss={!status && message ? dismiss : undefined} />
      <RoomSettingsSheet open={settings} onOpenChange={setSettings} state={state} onChanged={room.applyRoom} />
      <PersonaSheet open={agentSheet !== null} onOpenChange={(v) => { if (!v) setAgentSheet(null); }} roomId={roomId}
        agent={agentsInfo?.agents.find((a) => a.id === agentSheet) ?? null} canAsk={!closed}
        onAsk={(name) => { setDraft(`@${name} `); setTarget("group"); setVoiceMode("text"); }} />
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
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} roomId={roomId} isOwner={isOwner} joinMode={info?.joinMode ?? "code"} />
    </div>
  );
}
