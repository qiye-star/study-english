import { LoaderIcon, SendIcon, Settings2Icon, SquareIcon, Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { streamChatCompletion } from "~/api/ai";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, listMessages, updateConversation,
  type Conversation, type ConversationConfig,
} from "./chat-api";
import { buildChatMessages, displayName, titleFrom, withConfigDefaults } from "./chat-request";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { MessageBubble, type UiMessage } from "./message-bubble";
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
    nearBottomRef.current = true; // 新会话加载完成后滚到底
    forceScrollRef.current = false;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        setConversation(c);
        setMessages(list.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ key: m.id, id: m.id, role: m.role as "user" | "assistant", content: m.content, status: "done" })));
      })
      .catch((err) => alive && setLoadError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS)));
    return () => {
      alive = false;
      // 离开页面或切换会话:中止进行中的流,之后不再 setState
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
    };
  }, [api, id]);

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
  }, [messages]);

  const config: ConversationConfig = withConfigDefaults(conversation?.config, ai);

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
  }, [api, config, conversation, t]);

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
          <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-settings"
            aria-label={t("web.chat.settings")} onClick={() => setSettingsOpen(true)}>
            <Settings2Icon className="h-5 w-5" />
          </Button>
        } />
      {loadError && <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>}
      <div ref={listRef} data-testid="message-list" onScroll={onListScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.key} message={m}
            actions={
              <Button variant="ghost" size="sm" data-testid="message-tts" data-state={tts.states[m.key] ?? "idle"}
                className="mt-1 h-11 px-2" aria-label={tts.states[m.key] === "playing" ? t("web.chat.stopSpeaking") : t("web.chat.speak")}
                onClick={() => void tts.play(m.key, m.content, config.ttsModel, config.ttsVoice)}>
                {tts.states[m.key] === "loading" ? <LoaderIcon className="h-4 w-4 animate-spin" />
                  : tts.states[m.key] === "playing" ? <SquareIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
              </Button>
            }
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
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
    </div>
  );
}
