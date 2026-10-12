import { AtSignIcon, KeyboardIcon, MicIcon, SendIcon, XIcon } from "lucide-react";
import "./agents/locales";
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import { cn } from "~/lib/cn";
import { applyMention, mentionOptions, mentionQuery, type MentionAgent, type MentionOption } from "./agents/mention-suggest";
import { mentionsAi, ROOM_LIMITS } from "./protocol";

const keyClass = "flex size-tap flex-none items-center justify-center rounded-button transition-colors duration-fast "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[21px]";
/** 视觉小于 44px 的键:::before 向四周扩到 44px 命中区 */
const smallKey = "relative before:absolute before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface RoomComposerProps {
  disabled: boolean; offline?: boolean; value: string; ai: boolean; banner?: ReactNode; onDismiss?(): void;
  onChange(v: string): void; onSend(): void;
  /** 左侧圆形助手入口(AssistEntry) */
  leading?: ReactNode;
  /** 发送目标:assist 时输入框左侧显示「问助手 ×」胶囊 */
  target: "group" | "assist"; onClearTarget(): void;
  /** 语音:available=false 时不显示切换键;mode=voice 时用 input 取代文本框 */
  voice: { available: boolean; mode: "text" | "voice"; onToggle(): void; input: ReactNode };
  /** 输入行之上的内容(引用条、正在输入行) */
  above?: ReactNode;
  /** `@` 补全候选(房间开了 AI 时由页面传入;agents 可为空,只剩「AI」别名);不传 = 没有补全,@ 键照旧插入「@ai 」 */
  mentions?: { agents: readonly MentionAgent[]; defaultName: string | null };
  /** 群聊占位文字(显示默认智能体名字,R-AW1);不传 = 原来的文案 */
  groupPlaceholder?: string;
}

/**
 * 房间输入条 v2(视觉稿 rooms-v2 V2–V5 的 .composer,玻璃 + 顶部发丝线):
 * [助手入口 44 圆] [话筒/键盘 44] [输入框 44(目标为助手时左内侧「问助手 ×」胶囊、蓝色描边;空且可 @ai 时右内侧 @ 小键)/ 语音长条] [发送 44]。
 * 语音模式时长条占满,发送键隐藏。banner 是连接状态 / 提示 / 已结束,在输入行之上;above(引用条、正在输入)在 banner 之下。
 * 停靠面板(z-29)在输入条(z-30)之下、贴着输入条上沿。WA 车道在 F5 之后独占本文件。
 */
export const RoomComposer = forwardRef<HTMLDivElement, RoomComposerProps>(function RoomComposer(
  { disabled, offline = false, value, ai, banner, onDismiss, onChange, onSend, leading, target, onClearTarget, voice, above, mentions, groupPlaceholder }, ref) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const mention = mentionsAi(value).ai || /^@ai\s/i.test(value);
  const assist = target === "assist";
  const voiceMode = voice.available && voice.mode === "voice";
  const placeholder = assist ? t("web.rooms.assist.placeholder") : groupPlaceholder ?? t("web.rooms.room.placeholder");
  // @ 补全(R-AW13):只在消息开头;组字中不拦截按键;选项按下不夺焦点
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const query = mentions && !assist && !voiceMode ? mentionQuery(value, caret) : null;
  const aliasLabel = mentions?.defaultName ? t("web.rooms.agents.mention.aliasOf", { name: mentions.defaultName }) : t("web.rooms.agents.mention.alias");
  const options: MentionOption[] = mentions && query !== null ? mentionOptions(mentions.agents, query, aliasLabel) : [];
  const open = focused && options.length > 0 && dismissed !== value;
  const current = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => { setActive(0); }, [query]);
  const pick = (option: MentionOption) => {
    const next = applyMention(value, caret, option);
    onChange(next.value);
    setCaret(next.caret);
    setDismissed(null);
    const input = inputRef.current;
    input?.focus();
    requestAnimationFrame(() => input?.setSelectionRange(next.caret, next.caret));
  };
  /** 「问助手 ×」胶囊:文字模式在输入框左内侧;语音模式在长条之上(松手会发给助手,不是群里,review m10) */
  const assistPill = assist ? (
    <span data-testid="room-target-assist"
      className={cn("inline-flex h-[26px] flex-none items-center gap-px rounded-[8px] bg-blue-tint pl-2 pr-0.5 text-meta font-semibold text-blue", voiceMode ? "mb-1 self-start" : "mr-2")}>
      {voiceMode ? t("web.rooms.room.voiceToAssist") : t("web.rooms.room.askAssist")}
      <button type="button" data-testid="room-target-clear" aria-label={t("web.rooms.room.backToGroup")}
        onClick={() => { onClearTarget(); inputRef.current?.focus(); }}
        className={cn(smallKey, "flex size-[22px] items-center justify-center rounded-full before:-inset-[11px] [&_svg]:size-3.5")}>
        <XIcon aria-hidden />
      </button>
    </span>
  ) : null;
  return (
    <div ref={ref} data-testid="room-composer" className="glass glass-edge-t absolute inset-x-0 bottom-0 z-30 px-2 pb-2 pt-2">
      {banner && (
        <div role="status" className="mx-1 mb-2 flex min-h-8 items-center gap-1 rounded-badge bg-surface-2 pl-3 text-sub text-ink">
          <span className="min-w-0 flex-1 py-1.5">{banner}</span>
          {onDismiss && (
            <IconButton label={t("web.rooms.room.dismiss")} className="h-8 text-ink-2 hit-expand [&_svg]:size-4" onClick={onDismiss}><XIcon /></IconButton>
          )}
        </div>
      )}
      {above}
      <div data-testid="room-composer-row" className="flex items-center gap-1.5">
        {leading}
        {voice.available && (
          <button type="button" data-testid="room-voice-toggle" disabled={disabled} onClick={voice.onToggle}
            aria-pressed={voiceMode} aria-label={voiceMode ? t("web.chat.composer.toKeyboard") : t("web.chat.composer.toVoice")}
            className={cn(keyClass, "text-ink-2 hover:bg-surface-2")}>{voiceMode ? <KeyboardIcon aria-hidden /> : <MicIcon aria-hidden />}</button>
        )}
        {voiceMode ? (
          <div data-testid="room-voice-box" className="flex min-w-0 flex-1 flex-col">{assistPill}{voice.input}</div>
        ) : (
          <div data-testid="room-input-box"
            className={cn("relative flex h-tap min-w-0 flex-1 items-center rounded-button bg-surface pr-1.5 transition-shadow duration-fast",
              assist ? "border border-blue/40 pl-1.5" : "border-[0.5px] border-hair pl-3",
              "focus-within:border-blue focus-within:ring-[3px] focus-within:ring-blue/15")}>
            {assistPill}
            <input ref={inputRef} data-testid="room-input" disabled={disabled} value={value} maxLength={ROOM_LIMITS.text} enterKeyHint="send"
              aria-label={placeholder} placeholder={placeholder}
              role={mentions ? "combobox" : undefined} aria-autocomplete={mentions ? "list" : undefined} aria-expanded={mentions ? open : undefined}
              aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${current}` : undefined}
              onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                // 输入法组字中(iOS / Android 的 keyCode 229、搜狗):回车与方向键属于输入法,一律不拦截
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (open) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => (Math.min(i, options.length - 1) + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[current]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setDismissed(value); return; }
                }
                if (e.key === "Enter") { e.preventDefault(); if (!offline) onSend(); }
              }}
              className="h-full min-w-0 flex-1 truncate bg-transparent text-base text-ink placeholder:text-ink-2 focus-visible:outline-none disabled:opacity-60" />
            {open && (
              <ul id={listId} role="listbox" aria-label={t("web.rooms.agents.mention.list")} data-testid="room-mention-list"
                className="absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface py-1 shadow-card dark:shadow-none">
                {options.map((o, i) => (
                  <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === current} data-testid="room-mention-option"
                    onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
                    className={cn("flex min-h-tap cursor-pointer items-center gap-2 px-3 text-body text-ink", i === current && "bg-surface-2")}>
                    <AtSignIcon aria-hidden className="size-4 flex-none text-ink-3" />
                    <span className="min-w-0 truncate">{o.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {ai && !assist && !value && (
              <button type="button" data-testid="room-at-ai" aria-label="@ai" aria-pressed={mention} disabled={disabled}
                onClick={() => {
                  if (mentions) { onChange("@"); setCaret(1); setDismissed(null); } // 有补全:插入 @ 并打开候选
                  else onChange(/^@ai\b/i.test(value) ? value : `@ai ${value}`);
                  inputRef.current?.focus();
                }}
                className={cn(smallKey, "flex size-8 flex-none items-center justify-center rounded-[8px] text-ink-3 before:-inset-1.5 hover:bg-surface-2 disabled:opacity-40 [&_svg]:size-[18px]")}>
                <AtSignIcon aria-hidden />
              </button>
            )}
          </div>
        )}
        {!voiceMode && (
          <button type="button" data-testid="room-send" aria-label={t("web.rooms.room.send")} disabled={disabled || offline || !value.trim()} onClick={onSend}
            className={cn(keyClass, "bg-blue text-on-blue active:bg-blue/90")}><SendIcon aria-hidden /></button>
        )}
      </div>
    </div>
  );
});
