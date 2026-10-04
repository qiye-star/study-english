import { SendIcon, Settings2Icon } from "lucide-react";
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

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${++keySeq}`;

export function ConversationPage({ recorderEnv: _recorderEnv }: { recorderEnv?: RecorderEnv }) {
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
  const abortRef = useRef<AbortController | null>(null);
  // 同步发送锁:state 在同一帧的连续提交里仍是旧值
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setConversation(null);
    setSending(false);
    setMessages([]);
    setLoadError(null);
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        setConversation(c);
        setMessages(list.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ key: m.id, id: m.id, role: m.role as "user" | "assistant", content: m.content, status: "done" })));
      })
      .catch((err) => alive && setLoadError(translateServerError(t, err, CHAT_SERVER_ERRORS)));
    return () => {
      alive = false;
      // 离开页面或切换会话:中止进行中的流,之后不再 setState
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
    };
  }, [api, id, t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }); }, [messages]);

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
    setMessages([...base, { key: userKey, role: "user", content, status: "done" },
      { key: botKey, role: "assistant", content: "", status: "streaming" }]);
    setSending(true);
    const finish = () => {
      if (abortRef.current === controller) {
        abortRef.current = null;
        busyRef.current = false;
      }
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
      patch(botKey, { status: "error", content: translateServerError(t, err, CHAT_SERVER_ERRORS) });
      finish();
      return;
    }
    finish();
    if (controller.signal.aborted) return;
    try {
      const saved = await createMessages(api, conversation.id, [{ role: "user", content }, { role: "assistant", content: reply }]);
      patch(userKey, { id: saved.messages[0]?.id });
      patch(botKey, { id: saved.messages[1]?.id });
    } catch {
      if (mountedRef.current) toast.error(t("web.chat.notSaved"));
      return;
    }
    if (conversation.name === DEFAULT_CONVERSATION_NAME) {
      try {
        const renamed = await updateConversation(api, conversation.id, { name: titleFrom(content) });
        if (mountedRef.current && !controller.signal.aborted) setConversation(renamed);
      } catch {
        // 改名失败不影响已保存的消息
      }
    }
  }, [api, config, conversation, t]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const text = input;
    if (!text.trim()) return;
    setInput("");
    void send(text, messages);
  };

  const retry = (botKey: string) => {
    if (busyRef.current) return;
    const index = messages.findIndex((m) => m.key === botKey);
    const user = messages[index - 1];
    if (!user || user.role !== "user") return;
    void send(user.content, messages.slice(0, index - 1));
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
      <div ref={listRef} data-testid="message-list" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.key} message={m} onRetry={m.status === "error" && !sending ? () => retry(m.key) : undefined} />
        ))}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-2">
        <Textarea data-testid="chat-input" rows={1} value={input} placeholder={t("web.chat.placeholder")}
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
