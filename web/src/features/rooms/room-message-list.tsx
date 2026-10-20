import "./agents/locales";
import { LanguagesIcon, MoreHorizontalIcon } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import { ZhNoteFold } from "~/components/zh-note-fold";
import { ttsErrorMessage, useMessageTranslations, useTtsPlayer } from "~/features/chat";
import { cn } from "~/lib/cn";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { resolveTtsVoice } from "~/settings/tts-voice-pref";
import { AgentName, AnsweredFor, HandoffLine, PrivateProcess } from "./agents/agent-answer";
import { agentOf } from "./agents/agent-meta";
import { mentionsAgent } from "./agents/mentions";
import { MessageActions } from "./extras/message-actions";
import { QuoteBlock } from "./extras/quote-block";
import { ReactionBar } from "./extras/reaction-bar";
import { TextTranslation } from "./extras/text-translation";
import { isMostlyNative, speakable, spokenText } from "./extras/text-tools";
import { lookupContext } from "~/lib/lookup-context";
import type { ReactionKey, RoomMessage } from "./protocol";
import type { RoomState } from "./room-state";
import { TranslateQueue } from "./voice/translate-queue";
import { VoiceBubble } from "./voice/voice-bubble";
import { describeSettingsChanges } from "./create/settings-message";
import { fetchRoomsConfig, type RoomsConfig } from "./rooms-api";
import { LQ_TILE } from "~/components/liquid";

/** 操作行的 id(「更多操作」的 aria-controls) */
const actionsId = (messageId: string) => `room-actions-${messageId}`;
/** 回应切换等回音的最长时间 */
const REACT_PENDING_MS = 5000;
const MORE_CLASS = "relative flex size-7 flex-none items-center justify-center self-end rounded-full text-ink-3 transition-colors duration-fast "
  + "before:absolute before:-inset-2 before:content-[''] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4";

const AT_AI = /^(\s*@(?:ai|助手))(?=$|[\s:：,，])/i;

/** 成员消息正文:开头的 @ai / @助手 用钴蓝半粗标出(视觉稿 M2 的 .at)。 */
function MessageText({ text }: { text: string }) {
  const m = AT_AI.exec(text);
  if (!m) return <span {...lookupContext} className="whitespace-pre-wrap break-words">{text}</span>;
  return (
    <span {...lookupContext} className="whitespace-pre-wrap break-words">
      <span className="font-semibold text-blue liquid:text-ink">{m[1].trim()}</span>{text.slice(m[1].length)}
    </span>
  );
}

/** AI 回答:英文在前;以「中文:」开头的行作为 13px 次要色的中文说明。 */
function AiAnswer({ text }: { text: string }) {
  const lines = text.split("\n");
  const zhAt = lines.findIndex((l) => /^\s*中文[:：]/.test(l));
  const en = (zhAt < 0 ? lines : lines.slice(0, zhAt)).join("\n").trim();
  const zh = zhAt < 0 ? "" : lines.slice(zhAt).join("\n").trim();
  return (
    <>
      {en && <p {...lookupContext} className="mt-1.5 whitespace-pre-wrap break-words text-body leading-dialogue">{en}</p>}
      {zh && <p className="mt-1 whitespace-pre-wrap break-words text-sub leading-dialogue text-ink-2">{zh}</p>}
    </>
  );
}

export interface RoomMessageListProps {
  state: RoomState; roomId: string; reported: ReadonlySet<string>;
  /** 「联机语音自动转文字」偏好(传给 VoiceBubble) */
  autoText: boolean;
  onLoadEarlier(): void; onReport(message: RoomMessage): void;
  onReact(seq: number, key: ReactionKey, on: boolean): void; onQuote(message: RoomMessage): void;
  /** 返回 false = 没有连接,没发出去 */
  onTranslateVoice(seq: number): boolean; onRetryVoice(seq: number): void;
  /** 联机智能体(plan 2026-10-12-agents-rooms):本房角色名(推出「Emma 正在回答…」)与点角色名打开角色信息 */
  agentNames?: string[];
  onOpenAgent?(personaId: string): void;
}

/**
 * 公共消息列表(视觉稿 M2 / rooms-v2):别人 = 中性气泡 + 名字;自己 = blue-tint;@ai 回答 = 中性卡片(AI 助手 + 引用提问);系统 = 居中 11px。
 * v2 插槽:语音消息 → VoiceBubble;有引用 → 气泡内先渲染 QuoteBlock(点按滚动到 data-seq 元素);气泡下方 ReactionBar;
 * 点消息选中 → MessageActions(取代 v1 的举报行)。每条消息的根元素带 data-seq。WE 车道在 F5 之后独占本文件。
 * 系统消息按 i18n 模板渲染(服务端只存 key + 参数)。
 */
export const RoomMessageList = memo(function RoomMessageList({
  state, roomId, reported, autoText, onLoadEarlier, onReport, onReact, onQuote, onTranslateVoice, onRetryVoice, agentNames, onOpenAgent,
}: RoomMessageListProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { api } = useAuth();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 打开的操作行:Esc 或点别处关闭(review M7);打开后滚到可见(review M6,列表的 scroll-padding 让开输入条)
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    const onDown = (e: PointerEvent) => {
      const own = [...(rootRef.current?.querySelectorAll("[data-message-id]") ?? [])].find((el) => el.getAttribute("data-message-id") === selected);
      // 行占满列表宽:点到行本身(气泡旁的空白)也算「点别处」
      if (!own || own === e.target || !own.contains(e.target as Node)) setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [selected]);
  useLayoutEffect(() => {
    if (selected === null) return;
    document.getElementById(actionsId(selected))?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  // 回应:同一条同一表情的上一次切换还没回音时忽略新的点按(快速连点不会发两次 on,review m6)
  const reacting = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reactOnce = useCallback((seq: number, key: ReactionKey, on: boolean) => {
    const id = `${seq}:${key}`;
    if (reacting.current.has(id)) return;
    reacting.current.set(id, setTimeout(() => reacting.current.delete(id), REACT_PENDING_MS));
    onReact(seq, key, on);
  }, [onReact]);
  const reactionsKey = state.messages.map((m) => `${m.seq}:${(m.reactions ?? []).map((r) => `${r.key}${r.userIds.join(".")}`).join(",")}`).join("|");
  useEffect(() => { // 回应事件到了:放开所有等待中的切换
    for (const [id, timer] of reacting.current) {
      clearTimeout(timer);
      reacting.current.delete(id);
    }
  }, [reactionsKey]);
  const meId = state.me?.userId ?? null;
  // 自动翻译共用一个队列:限速在服务端 20 次/分钟之下,只为进入视野的语音请求(review M3)
  const translateRef = useRef(onTranslateVoice);
  translateRef.current = onTranslateVoice;
  const translateQueue = useMemo(() => new TranslateQueue((seq) => translateRef.current(seq)), []);
  const bySeq = useMemo(() => new Map(state.messages.map((m) => [m.seq, m])), [state.messages]);
  const names = agentNames ?? [];
  /** 「正在输入」:被回复的是 @角色 的提问时显示角色名(ai_typing 不带角色字段,R-RA9) */
  const typingLabel = () => {
    const q = bySeq.get(state.aiTyping[state.aiTyping.length - 1]);
    const index = q && q.kind === "text" ? mentionsAgent(q.text, names).index : null;
    return index !== null ? t("web.rooms.agents.typing", { name: names[index] }) : t("web.rooms.room.aiTyping");
  };
  const jump = useCallback((seq: number) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, []);

  // 文本消息的「译」「朗读」(spec §6.2 / R2-14):与对话页同一套 hook,按收听者各自请求、命中本地缓存不再调用
  const translations = useMessageTranslations(api, native);
  const tts = useTtsPlayer(api, { onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)) });
  // 默认音色:第一次打开操作行时才取(进房不多发请求);模块级缓存
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const aiRef = useRef<Promise<ServerAiConfig | null> | null>(null);
  const loadAi = useCallback(() => {
    aiRef.current ??= loadServerAiConfig(api).then((c): ServerAiConfig => { setAi(c); return c; }, (): null => { aiRef.current = null; return null; });
    return aiRef.current;
  }, [api]);
  useEffect(() => { if (selected !== null) void loadAi(); }, [selected, loadAi]);
  // 「settings」系统消息逐项描述(WC 的 describeSettingsChanges);改了场景时才取 /api/rooms/config 换成场景名
  const [scenarios, setScenarios] = useState<RoomsConfig["scenarios"] | undefined>(undefined);
  const needsScenarios = useMemo(() => state.messages.some((m) => m.kind === "system" && m.text === "settings"
    && Array.isArray((m.meta as { changes?: unknown } | null)?.changes)
    && ((m.meta as { changes: { field?: unknown }[] }).changes).some((c) => c?.field === "scenario")), [state.messages]);
  useEffect(() => {
    if (!needsScenarios || scenarios) return;
    const ctrl = new AbortController();
    fetchRoomsConfig(api, ctrl.signal).then((c) => setScenarios(c.scenarios), (): void => undefined); // 取不到就显示场景 key
    return () => ctrl.abort();
  }, [api, needsScenarios, scenarios]);
  const speak = (m: RoomMessage) => {
    const text = spokenText(m); // the only text that reaches TTS: body only, no Chinese (R-AW9)
    if (ai) {
      const voice = resolveTtsVoice("message", ai);
      if (voice.model) void tts.play(m.id, text, voice.model, voice.voice);
      else toast.error(t("web.rooms.extras.speakUnavailable"));
      return;
    }
    tts.prime(); // iOS:在点击的同步阶段解锁播放器,取到配置后再播
    void loadAi().then((c) => {
      const voice = resolveTtsVoice("message", c ?? null);
      if (voice.model) void tts.play(m.id, text, voice.model, voice.voice);
      else toast.error(tRef.current("web.rooms.extras.speakUnavailable"));
    });
  };
  const textual = (m: RoomMessage) => (m.kind === "text" || m.kind === "ai_answer") && !m.hidden && speakable(m) !== "";

  /** 气泡下方:译文(.trans)、回应片(.rx)、选中时的操作行(.actpop);别人的消息与气泡对齐(头像 30 + 间距 8 = 38px 缩进) */
  const under = (m: RoomMessage, mine: boolean, align: "start" | "end", indent: boolean) => {
    const text = textual(m) ? speakable(m) : "";
    const open = !!translations.open[m.id] && text !== "";
    const hasReactions = !!m.reactions?.some((r) => r.userIds.length > 0);
    const isSelected = selected === m.id;
    if (!open && !hasReactions && !isSelected) return null;
    const canTranslate = text !== "" && !isMostlyNative(text, native);
    return (
      <div className={cn("flex max-w-full flex-col", align === "end" ? "items-end" : "items-start", indent && "pl-[38px]")}>
        {open && <TextTranslation state={translations.states[m.id]} onRetry={() => translations.retry(m.id, text)} />}
        {hasReactions && <ReactionBar reactions={m.reactions} meId={meId} onToggle={(key, on) => reactOnce(m.seq, key, on)} />}
        {isSelected && (
          <div id={actionsId(m.id)} className="mt-1 max-w-full">
            <MessageActions message={m} mine={mine} meId={meId} canReport={!mine} reported={reported.has(m.id)}
              onReact={(key, on) => { reactOnce(m.seq, key, on); setSelected(null); }}
              onQuote={() => { onQuote(m); setSelected(null); }} onReport={() => onReport(m)}
              onTranslate={canTranslate ? () => translations.toggle(m.id, text) : undefined} translateOpen={open}
              onSpeak={spokenText(m) ? () => speak(m) : undefined} speakState={tts.states[m.id] ?? "idle"} />
          </div>
        )}
      </div>
    );
  };
  const toggle = (m: RoomMessage) => setSelected((cur) => (cur === m.id ? null : m.id));
  /** 点气泡 = 指针的快捷方式(不是 role=button:气泡里的播放、转文字、翻译、引用都要单独给读屏,review M7) */
  const selectable = (m: RoomMessage) => ({
    onClick: (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a, audio")) toggle(m); },
  });
  /** 气泡旁的「更多操作」:键盘与读屏打开操作行的入口;视觉 28px,命中区扩到 44px */
  const moreButton = (m: RoomMessage) => (
    <button type="button" data-testid="room-message-more" aria-label={t("web.rooms.extras.moreActions")}
      aria-expanded={selected === m.id} aria-controls={actionsId(m.id)} onClick={() => toggle(m)}
      className={MORE_CLASS}>
      <MoreHorizontalIcon aria-hidden />
    </button>
  );

  const render = (m: RoomMessage) => {
    if (m.hidden) {
      // 管理员隐藏的消息:保留位置,只显示占位(正文、语音、回应都不再下发)
      return (
        <p key={m.id} data-seq={m.seq} data-testid="room-message" data-kind="hidden" className="self-center text-meta italic text-ink-2">
          {t("web.rooms.room.hidden")}
        </p>
      );
    }
    if (m.kind === "system") {
      return (
        <p key={m.id} data-seq={m.seq} data-testid="room-message" data-kind="system" className="text-center text-label font-medium tracking-[0.02em] text-ink-2">
          {(m.text === "settings" && describeSettingsChanges(t, m.meta, scenarios, language))
            || t(`web.rooms.room.system.${m.text}`, { ...((m.meta ?? {}) as Record<string, string>), defaultValue: "" })}
        </p>
      );
    }
    if (m.kind === "ai_answer") {
      const question = m.replyTo !== null ? bySeq.get(m.replyTo) : undefined;
      const agent = agentOf(m);
      // 过程只属于提问者:别人只看到「已回答 · 对 X」(数据本来就不会发给他们,这里不依赖它)
      const askedByMe = !!agent?.asker && agent.asker.id === meId;
      const trace = askedByMe ? state.agentTraces[m.seq] : undefined;
      const run = askedByMe && m.replyTo !== null ? state.agentRuns[m.replyTo] : undefined;
      return (
        <div key={m.id} data-seq={m.seq} data-message-id={m.id} className="flex w-full flex-col items-start">
          {agent?.handoffFrom && <HandoffLine from={agent.handoffFrom.name} to={agent.agent.name} />}
          <div className="flex max-w-[92%] gap-1">
          <div data-testid="room-message" data-kind="ai_answer" {...selectable(m)}
            className={`min-w-0 rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 ${LQ_TILE}`}>
            {agent ? <AgentName agent={agent.agent} onOpen={onOpenAgent} />
              : <span className="block text-label font-semibold uppercase tracking-eyebrow text-ink-2">{t("web.rooms.room.aiName")}</span>}
            {agent?.asker && !askedByMe && <AnsweredFor name={agent.agent.name} asker={agent.asker.name} />}
            {question && (
              <p {...lookupContext} className="mt-1.5 line-clamp-2 border-l-2 border-hair pl-2 text-meta text-ink-2">{question.sender.name}: {question.text}</p>
            )}
            <AiAnswer text={m.text} />
            {agent?.noteZh && (
              <ZhNoteFold text={agent.noteZh} showLabel={t("web.rooms.agents.note.show")} hideLabel={t("web.rooms.agents.note.hide")}
                testId="room-agent-note" className="mt-1" />
            )}
          </div>
          {moreButton(m)}
          </div>
          {askedByMe && (trace || run) && <PrivateProcess name={agent!.agent.name} run={run} trace={trace} generating={false} align="start" />}
          {under(m, false, "start", false)}
        </div>
      );
    }
    const mine = meId !== null && m.sender.id === meId;
    const name = m.sender.name ?? "?";
    const voice = m.kind === "voice";
    return (
      // 行占满列表宽(w-full),气泡的 max-w-[88%] 才按列表宽算;行若随内容收缩(self-end),百分比按气泡自身宽度算,短消息会被逐字折行
      <div key={m.id} data-seq={m.seq} data-message-id={m.id} className={cn("flex w-full flex-col", mine ? "items-end" : "items-start")}>
        <div className={cn("flex max-w-[88%] gap-2", mine && "flex-row-reverse")}>
          {!mine && <Avatar name={name} size="sm" className="mt-0.5" src={m.sender.avatarUrl} />}
          <div data-testid="room-message" data-kind={voice ? "voice" : "text"} data-mine={mine ? "true" : "false"} {...selectable(m)}
            className={cn("min-w-0 rounded-card px-3 py-2 text-body leading-dialogue tracking-[-0.005em]",
              mine ? "rounded-tr-inline bg-blue-tint liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite liquid:[&_.text-ink-2]:text-on-graphite/75 liquid:[&_.text-blue]:text-on-graphite"
                : "rounded-tl-inline border-[0.5px] border-hair bg-surface mat-surface liquid:rounded-tile liquid:rounded-tl-tail")}>
            {!mine && <span className="block text-meta font-semibold text-ink-2">{name}</span>}
            {m.quote && <QuoteBlock quote={m.quote} onJump={jump} />}
            {voice ? (
              <VoiceBubble message={m} mine={mine} roomId={roomId} autoText={autoText} onTranslate={onTranslateVoice} onRetry={onRetryVoice} queue={translateQueue} />
            ) : <MessageText text={m.text} />}
            {m.assisted && (
              <span className="mt-0.5 flex items-center gap-[3px] text-label font-semibold text-blue liquid:text-ink">
                <LanguagesIcon aria-hidden className="size-[13px]" />{t("web.rooms.room.assisted")}
              </span>
            )}
            {m.aiStatus === "pending" && !state.aiTyping.includes(m.seq) && state.status !== "closed" && (
              <span className="mt-0.5 block text-label text-ink-2">{t("web.rooms.room.aiPending")}</span>
            )}
            {(m.aiStatus === "failed" || (m.aiStatus === "pending" && state.status === "closed")) && (
              <span className="mt-0.5 block text-label text-ink-2">{t("web.rooms.room.aiFailed")}</span>
            )}
          </div>
          {moreButton(m)}
        </div>
        {mine && m.aiStatus === "pending" && state.agentRuns[m.seq]?.answerSeq === null && (
          <PrivateProcess name={names[mentionsAgent(m.text, names).index ?? -1] ?? ""} run={state.agentRuns[m.seq]} generating align="end" />
        )}
        {under(m, mine, mine ? "end" : "start", !mine)}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {state.truncated && state.messages.length > 0 && (
        <button type="button" data-testid="room-load-earlier" onClick={onLoadEarlier}
          className="tap-link self-center !my-0 text-sub font-medium text-blue">{t("web.rooms.room.loadEarlier")}</button>
      )}
      {state.messages.map(render)}
      {state.pending.map((p) => (
        // 与确认后的自己消息同一行结构(含「更多操作」的占位),ack 到达时气泡不重新折行、不跳动
        <div key={p.clientId} className="flex w-full flex-col items-end">
          <div className="flex max-w-[88%] flex-row-reverse gap-2">
            <div data-testid="room-pending" aria-busy="true"
              className="min-w-0 rounded-card rounded-tr-inline bg-blue-tint px-3 py-2 text-body leading-dialogue tracking-[-0.005em] opacity-60 liquid:rounded-tile liquid:rounded-tr-tail liquid:bg-graphite liquid:text-on-graphite">
              <MessageText text={p.text} />
            </div>
            <span data-testid="room-pending-slot" aria-hidden="true" className="size-7 flex-none" />
          </div>
        </div>
      ))}
      {state.aiTyping.length > 0 && (
        <p role="status" className="self-start text-meta text-ink-2">{typingLabel()}</p>
      )}
    </div>
  );
});
