import { LanguagesIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { Avatar } from "~/components/avatar";
import { ttsErrorMessage, useMessageTranslations, useTtsPlayer } from "~/features/chat";
import { cn } from "~/lib/cn";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { MessageActions } from "./extras/message-actions";
import { QuoteBlock } from "./extras/quote-block";
import { ReactionBar } from "./extras/reaction-bar";
import { TextTranslation } from "./extras/text-translation";
import { isMostlyNative, speakable } from "./extras/text-tools";
import type { ReactionKey, RoomMessage } from "./protocol";
import type { RoomState } from "./room-state";
import { VoiceBubble } from "./voice/voice-bubble";

const AT_AI = /^(\s*@(?:ai|助手))(?=$|[\s:：,，])/i;

/** 成员消息正文:开头的 @ai / @助手 用钴蓝半粗标出(视觉稿 M2 的 .at)。 */
function MessageText({ text }: { text: string }) {
  const m = AT_AI.exec(text);
  if (!m) return <span className="whitespace-pre-wrap break-words">{text}</span>;
  return (
    <span className="whitespace-pre-wrap break-words">
      <span className="font-semibold text-blue">{m[1].trim()}</span>{text.slice(m[1].length)}
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
      {en && <p className="mt-1.5 whitespace-pre-wrap break-words text-body leading-dialogue">{en}</p>}
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
  onTranslateVoice(seq: number): void; onRetryVoice(seq: number): void;
}

/**
 * 公共消息列表(视觉稿 M2 / rooms-v2):别人 = 中性气泡 + 名字;自己 = blue-tint;@ai 回答 = 中性卡片(AI 助手 + 引用提问);系统 = 居中 11px。
 * v2 插槽:语音消息 → VoiceBubble;有引用 → 气泡内先渲染 QuoteBlock(点按滚动到 data-seq 元素);气泡下方 ReactionBar;
 * 点消息选中 → MessageActions(取代 v1 的举报行)。每条消息的根元素带 data-seq。WE 车道在 F5 之后独占本文件。
 * 系统消息按 i18n 模板渲染(服务端只存 key + 参数)。
 */
export const RoomMessageList = memo(function RoomMessageList({
  state, roomId, reported, autoText, onLoadEarlier, onReport, onReact, onQuote, onTranslateVoice, onRetryVoice,
}: RoomMessageListProps) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const { api } = useAuth();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const meId = state.me?.userId ?? null;
  const bySeq = useMemo(() => new Map(state.messages.map((m) => [m.seq, m])), [state.messages]);
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
  const speak = (m: RoomMessage) => {
    const text = speakable(m);
    if (ai) {
      if (ai.defaultTts.model) void tts.play(m.id, text, ai.defaultTts.model, ai.defaultTts.voice);
      else toast.error(t("web.rooms.extras.speakUnavailable"));
      return;
    }
    tts.prime(); // iOS:在点击的同步阶段解锁播放器,取到配置后再播
    void loadAi().then((c) => {
      if (c?.defaultTts.model) void tts.play(m.id, text, c.defaultTts.model, c.defaultTts.voice);
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
        {hasReactions && <ReactionBar reactions={m.reactions} meId={meId} onToggle={(key, on) => onReact(m.seq, key, on)} />}
        {isSelected && (
          <div className="mt-1 max-w-full">
            <MessageActions message={m} mine={mine} meId={meId} canReport={!mine} reported={reported.has(m.id)}
              onReact={(key, on) => { onReact(m.seq, key, on); setSelected(null); }}
              onQuote={() => { onQuote(m); setSelected(null); }} onReport={() => onReport(m)}
              onTranslate={canTranslate ? () => translations.toggle(m.id, text) : undefined} translateOpen={open}
              onSpeak={text ? () => speak(m) : undefined} speakState={tts.states[m.id] ?? "idle"} />
          </div>
        )}
      </div>
    );
  };
  const toggle = (m: RoomMessage) => setSelected((cur) => (cur === m.id ? null : m.id));
  const selectable = (m: RoomMessage) => ({
    role: "button", tabIndex: 0, "aria-expanded": selected === m.id,
    onClick: (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a, audio")) toggle(m); },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) toggle(m); },
  });

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
          {t(`web.rooms.room.system.${m.text}`, { ...((m.meta ?? {}) as Record<string, string>), defaultValue: "" })}
        </p>
      );
    }
    if (m.kind === "ai_answer") {
      const question = m.replyTo !== null ? bySeq.get(m.replyTo) : undefined;
      return (
        <div key={m.id} data-seq={m.seq} className="flex max-w-full flex-col items-start self-start">
          <div data-testid="room-message" data-kind="ai_answer" {...selectable(m)}
            className="max-w-[92%] rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-label font-semibold uppercase tracking-eyebrow text-ink-2">{t("web.rooms.room.aiName")}</span>
            {question && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-hair pl-2 text-meta text-ink-2">{question.sender.name}: {question.text}</p>
            )}
            <AiAnswer text={m.text} />
          </div>
          {under(m, false, "start", false)}
        </div>
      );
    }
    const mine = meId !== null && m.sender.id === meId;
    const name = m.sender.name ?? "?";
    const voice = m.kind === "voice";
    return (
      <div key={m.id} data-seq={m.seq} className={cn("flex max-w-full flex-col", mine ? "items-end self-end" : "items-start self-start")}>
        <div className={cn("flex max-w-[88%] gap-2", mine && "flex-row-reverse")}>
          {!mine && <Avatar name={name} size="sm" className="mt-0.5" />}
          <div data-testid="room-message" data-kind={voice ? "voice" : "text"} data-mine={mine ? "true" : "false"} {...selectable(m)}
            className={cn("min-w-0 rounded-card px-3 py-2 text-body leading-dialogue tracking-[-0.005em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mine ? "rounded-tr-inline bg-blue-tint" : "rounded-tl-inline border-[0.5px] border-hair bg-surface")}>
            {!mine && <span className="block text-meta font-semibold text-ink-2">{name}</span>}
            {m.quote && <QuoteBlock quote={m.quote} onJump={jump} />}
            {voice ? (
              <VoiceBubble message={m} mine={mine} roomId={roomId} autoText={autoText} onTranslate={onTranslateVoice} onRetry={onRetryVoice} />
            ) : <MessageText text={m.text} />}
            {m.assisted && (
              <span className="mt-0.5 flex items-center gap-[3px] text-label font-semibold text-blue">
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
        </div>
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
        <div key={p.clientId} data-testid="room-pending" aria-busy="true"
          className="max-w-[88%] self-end rounded-card rounded-tr-inline bg-blue-tint px-3 py-2 text-body leading-dialogue opacity-60">
          <MessageText text={p.text} />
        </div>
      ))}
      {state.aiTyping.length > 0 && (
        <p role="status" className="self-start text-meta text-ink-2">{t("web.rooms.room.aiTyping")}</p>
      )}
    </div>
  );
});
