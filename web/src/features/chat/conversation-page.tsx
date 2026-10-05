import { LanguagesIcon, ListChecksIcon, LoaderIcon, SendIcon, Settings2Icon, SquareIcon, Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { Textarea } from "@renderer/components/ui/textarea";
import { streamChatCompletion } from "~/api/ai";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, listMessages, updateConversation,
  type Conversation, type ConversationConfig,
} from "./chat-api";
import { buildChatMessages, chatOptions, displayName, titleFrom, withConfigDefaults } from "./chat-request";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { SentencePracticeSheet } from "./sentence-practice-sheet";
import { MessageBubble, type UiMessage } from "./message-bubble";
import { fromServerMessage } from "./ui-message";
import { MessageTranslation } from "./message-translation";
import { PronunciationBadge } from "./result-badges";
import { TurnDetailSheet } from "./turn-detail-sheet";
import { useMessageTranslations } from "./use-message-translations";
import { ttsErrorMessage, useTtsPlayer } from "./use-tts-player";
import { VoiceInputButton } from "./voice-input-button";

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${++keySeq}`;

export function ConversationPage({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [practiceText, setPracticeText] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const canTranslate = native !== "en-US"; // R16:英文界面没有可译的目标语言
  const translations = useMessageTranslations(api, native);
  const resetTranslations = translations.reset;
  const showTranslation = translations.show;
  const tts = useTtsPlayer(api, {
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    onNothingToRead: () => toast.error(tRef.current("web.chat.nothingToRead")),
  });
  const stopTts = tts.stop;
  // 切换会话或离开页面时停止朗读
  useEffect(() => () => stopTts(), [id, stopTts]);
  const abortRef = useRef<AbortController | null>(null);
  // 同步发送锁:state 在同一帧的连续提交里仍是旧值
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const tRef = useRef(t);
  tRef.current = t;
  // 保存串行化:上一轮的保存未完成时,下一轮排队,保证服务端消息顺序
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const idRef = useRef(id);
  idRef.current = id;
  const nearBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setConversation(null);
    setSending(false);
    setMessages([]);
    setLoadError(null);
    setPracticeText(null);
    setDetailKey(null);
    resetTranslations();
    nearBottomRef.current = true; // 新会话加载完成后滚到底
    forceScrollRef.current = false;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        setConversation(c);
        setMessages(list.messages
          .filter((m) => m.role !== "system")
          .map(fromServerMessage));
      })
      .catch((err) => alive && setLoadError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS)));
    return () => {
      alive = false;
      // 离开页面或切换会话:中止进行中的流,之后不再 setState
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
    };
  }, [api, id, resetTranslations]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // 只在用户已在底部附近、或刚发送消息时自动滚动;向上翻阅的用户不会被流式输出拉回底部
  const onListScroll = () => {
    const el = listRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    const el = listRef.current;
    if (!el || !(forceScrollRef.current || nearBottomRef.current)) return;
    forceScrollRef.current = false;
    nearBottomRef.current = true;
    el.scrollTo?.({ top: el.scrollHeight });
  // 译文展开/到达也会改变列表高度;仍受 nearBottomRef 约束(向上翻阅的用户不会被拉回)
  }, [messages, translations.open, translations.states]);

  const config: ConversationConfig = withConfigDefaults(conversation?.config, ai);
  const options = chatOptions(config);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const canTranslateRef = useRef(canTranslate);
  canTranslateRef.current = canTranslate;

  const send = useCallback(async (text: string, base: UiMessage[]) => {
    const content = text.trim();
    if (!content || !conversation || busyRef.current) return;
    busyRef.current = true;
    const history = base.filter((m) => m.status === "done").map(({ role, content: c }) => ({ role, content: c }));
    const userKey = nextKey("u");
    const botKey = nextKey("a");
    const controller = new AbortController();
    abortRef.current = controller;
    const live = () => mountedRef.current && !controller.signal.aborted;
    const patch = (key: string, change: Partial<UiMessage>) => {
      if (live()) setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...change } : m)));
    };
    forceScrollRef.current = true;
    setMessages([...base, { key: userKey, role: "user", content, status: "done" },
      { key: botKey, role: "assistant", content: "", status: "streaming" }]);
    setSending(true);
    const finish = () => {
      // 不清空 abortRef:保存/改名阶段切换会话时,清理函数仍能让 live() 变 false
      if (abortRef.current === controller) busyRef.current = false;
      if (live()) setSending(false);
    };
    let reply = "";
    try {
      reply = await streamChatCompletion(api,
        { messages: buildChatMessages(config, history, content), model: config.model, temperature: config.temperature },
        (full) => patch(botKey, { content: full }), controller.signal);
      if (!reply.trim()) throw new ApiError(502, "Empty AI response");
      patch(botKey, { content: reply, status: "done" });
      if (optionsRef.current.bilingual && canTranslateRef.current && live()) showTranslation(botKey, reply);
    } catch (err) {
      // 离开页面/中止时 live() 为 false,patch 不生效,也不弹错误;
      // 流式失败:部分回复被错误气泡取代,且不保存
      patch(botKey, { status: "error", content: translateServerError(tRef.current, err, CHAT_SERVER_ERRORS) });
      finish();
      return;
    }
    finish();
    if (controller.signal.aborted) return;
    try {
      const run = saveChainRef.current.then(() =>
        createMessages(api, conversation.id, [{ role: "user", content }, { role: "assistant", content: reply }]));
      saveChainRef.current = run.catch((): void => undefined);
      const saved = await run;
      patch(userKey, { id: saved.messages[0]?.id });
      patch(botKey, { id: saved.messages[1]?.id });
    } catch {
      if (live()) toast.error(tRef.current("web.chat.notSaved"));
      return;
    }
    if (conversation.name === DEFAULT_CONVERSATION_NAME) {
      try {
        const renamed = await updateConversation(api, conversation.id, { name: titleFrom(content) });
        // 两轮重叠 + 切换会话时,上一个会话的改名结果不能覆盖当前会话
        if (mountedRef.current && !controller.signal.aborted && renamed.id === idRef.current) setConversation(renamed);
      } catch {
        // 改名失败不影响已保存的消息
      }
    }
  }, [api, config, conversation, t, showTranslation]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input;
    if (busyRef.current || !conversation || !text.trim()) return;
    setInput("");
    // 规则:失败的一轮(用户消息 + 错误气泡)从未保存。发送新消息时直接丢弃它,
    // 因此它既不进入后续历史,刷新后界面也与服务端一致;重试只对最后一个错误气泡开放。
    const last = messages[messages.length - 1];
    const base = last?.status === "error" ? messages.slice(0, -2) : messages;
    void send(text, base);
  };

  const retry = () => {
    if (busyRef.current) return;
    const last = messages[messages.length - 1];
    const user = messages[messages.length - 2];
    if (last?.status !== "error" || user?.role !== "user") return;
    void send(user.content, messages.slice(0, -2));
  };

  const [bilingualSaving, setBilingualSaving] = useState(false);
  const bilingualBusyRef = useRef(false);
  const toggleBilingual = () => {
    if (bilingualBusyRef.current || !conversation) return;
    bilingualBusyRef.current = true;
    setBilingualSaving(true);
    // 只写入服务端已存的配置 + 开关,避免把 ai 未加载时的空默认值固化下来
    void saveSettings({ ...conversation.config, bilingual: !options.bilingual })
      .catch((): void => undefined)
      .finally(() => { bilingualBusyRef.current = false; if (mountedRef.current) setBilingualSaving(false); });
  };

  const saveSettings = async (next: ConversationConfig) => {
    try {
      setConversation(await updateConversation(api, id, { config: next }));
    } catch (err) {
      toast.error(translateServerError(t, err, CHAT_SERVER_ERRORS));
      throw err;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={conversation ? displayName(conversation, t("web.chat.untitled")) : t("web.common.loading")} back="/chat"
        actions={
          <div className="flex">
            {canTranslate && (
              <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-bilingual"
                aria-pressed={options.bilingual} aria-label={t("web.chat.bilingual")} disabled={!conversation || bilingualSaving}
                onClick={toggleBilingual}>
                <LanguagesIcon className={cn("h-5 w-5", options.bilingual ? "text-primary" : "text-muted-foreground")} />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-settings"
              aria-label={t("web.chat.settings")} onClick={() => setSettingsOpen(true)}>
              <Settings2Icon className="h-5 w-5" />
            </Button>
          </div>
        } />
      {loadError && <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>}
      <div ref={listRef} data-testid="message-list" onScroll={onListScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.key} message={m}
            footer={m.assessment ? <PronunciationBadge view={m.assessment} onOpen={() => setDetailKey(m.key)} /> : null}
            actions={
              <div className="mt-1 flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" data-testid="message-tts" data-state={tts.states[m.key] ?? "idle"}
                  className="h-11 px-2" aria-label={tts.states[m.key] === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.speak")}
                  onClick={() => void tts.play(m.key, m.content, config.ttsModel, config.ttsVoice)}>
                  {tts.states[m.key] === "loading" ? <LoaderIcon className="h-4 w-4 animate-spin" />
                    : tts.states[m.key] === "playing" ? <SquareIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
                </Button>
                {canTranslate && (
                  <Button variant="ghost" size="sm" data-testid="message-translate" aria-pressed={!!translations.open[m.key]}
                    className="h-11 min-w-11 px-2" aria-label={t("web.chat.translate")}
                    onClick={() => translations.toggle(m.key, m.content)}>
                    <LanguagesIcon className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" data-testid="message-practice" className="h-11 min-w-11 px-2"
                  aria-label={t("web.chat.practice")} onClick={() => setPracticeText(m.content)}>
                  <ListChecksIcon className="h-4 w-4" />
                </Button>
              </div>
            }
            translation={translations.open[m.key]
              ? <MessageTranslation state={translations.states[m.key]} onRetry={() => translations.retry(m.key, m.content)} />
              : null}
            onRetry={m.status === "error" && !sending && m.key === messages[messages.length - 1]?.key ? retry : undefined} />
        ))}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-2">
        <VoiceInputButton recorderEnv={recorderEnv} disabled={sending}
          onText={(text) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))} />
        <Textarea data-testid="chat-input" rows={1} maxLength={20000} value={input} placeholder={t("web.chat.placeholder")}
          className="max-h-40 min-h-11 flex-1 resize-none text-base" onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" data-testid="chat-send" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.send")} disabled={!input.trim() || sending || !conversation}>
          <SendIcon className="h-5 w-5" />
        </Button>
      </form>
      <TurnDetailSheet message={messages.find((m) => m.key === detailKey) ?? null} onClose={() => setDetailKey(null)} />
      <SentencePracticeSheet text={practiceText} onClose={() => setPracticeText(null)} />
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
    </div>
  );
}
