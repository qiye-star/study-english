import { LanguagesIcon, ListChecksIcon, LoaderIcon, MicIcon, SendIcon, Settings2Icon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
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
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { formatClock } from "~/features/practice/practice-page";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, listMessages, updateConversation,
  type ChatMessage, type Conversation, type ConversationConfig, type MessageResultFields,
} from "./chat-api";
import { buildChatMessages, chatOptions, displayName, titleFrom, withConfigDefaults } from "./chat-request";
import { dropFailedTail } from "./chat-turns";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { SentencePracticeSheet } from "./sentence-practice-sheet";
import { MessageBubble } from "./message-bubble";
import { fromServerMessage, type UiMessage, type VoiceView } from "./ui-message";
import { MessageTranslation } from "./message-translation";
import { PronunciationBadge } from "./result-badges";
import { TurnDetailSheet } from "./turn-detail-sheet";
import { TurnResults } from "./turn-results";
import { useMessageTranslations } from "./use-message-translations";
import { ttsErrorMessage, useTtsPlayer } from "./use-tts-player";
import { VOICE_MAX_MS, useVoiceTurn, type VoiceClip, type VoiceDraftEvent } from "./use-voice-turn";

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${++keySeq}`;

interface TurnExtras {
  /** 复用已有的用户气泡(语音草稿、重试) */
  userKey?: string;
  voice?: VoiceView;
  /** 语音消息的 16 kHz WAV(只在首次发送时带上;重试回复不再评测) */
  wav?: Blob;
}

/** 一轮已出回复、等待(或重试)保存的消息对。队列保证服务端消息顺序与界面一致。 */
interface PendingSave {
  /** 会话代数:切换会话/卸载后过期,过期条目不再保存 */
  gen: number;
  results: TurnResults;
  conversationId: string;
  userKey: string;
  botKey: string;
  content: string;
  reply: string;
  saved: boolean;
}

/** 不会因重试而好转的失败(4xx,除超时/限流):丢弃这一轮的保存,不阻塞后面的轮次 */
const isPermanentSaveError = (err: unknown) =>
  err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;

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
  const pendingSavesRef = useRef<PendingSave[]>([]);
  const genRef = useRef(0);
  const idRef = useRef(id);
  idRef.current = id;
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;
  const nearBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 卸载后不再 setState(TurnResults 与保存队列的界面回调都走这里)
  const patchByKey = useCallback((key: string, change: Partial<UiMessage>) => {
    if (mountedRef.current) setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...change } : m)));
  }, []);
  // 评测结果的账本(R2–R4):每个会话一个实例,在 effect 里创建,StrictMode 重新挂载不会复用已 abandon 的实例
  const resultsRef = useRef<TurnResults | null>(null);

  const voice = useVoiceTurn({
    api,
    env: recorderEnv,
    newKey: () => nextKey("u"),
    onDraft: (event) => onVoiceDraft(event),
    onTranscribed: (clip, text) => onVoiceTranscribed(clip, text),
  });
  const resetVoice = voice.reset;
  const discardVoice = voice.discard;

  useEffect(() => {
    let alive = true;
    const results = new TurnResults(api, patchByKey);
    resultsRef.current = results;
    genRef.current += 1;
    pendingSavesRef.current = [];
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
      genRef.current += 1;
      pendingSavesRef.current = [];
      results.abandonOpen(); // R4:未保存的轮次不会再保存,清理其对话评测
      resetVoice(); // 取消录音、中止转写、回收 blob URL
    };
  }, [api, id, resetTranslations, patchByKey, resetVoice]);

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

  useEffect(() => {
    if (voice.error) toast.error(describeAudioError(t, voice.error));
  }, [voice.error, t]);

  const config: ConversationConfig = withConfigDefaults(conversation?.config, ai);
  const options = chatOptions(config);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const canTranslateRef = useRef(canTranslate);
  canTranslateRef.current = canTranslate;

  /** 被丢弃的未发送尾部:失败轮的评测要清理,语音草稿要释放(R4、R18)。 */
  const abandonDropped = useCallback((dropped: UiMessage[]) => {
    for (const m of dropped) {
      if (m.role !== "user") continue;
      resultsRef.current?.abandon(m.key);
      discardVoice(m.key);
    }
  }, [discardVoice]);

  /** 评测被 forget 后不会再来结果:界面上还在"评测中"的要结束。 */
  const settlePending = useCallback((userKey: string) => {
    const current = messagesRef.current.find((m) => m.key === userKey);
    if (current?.assessment?.status === "pending") patchByKey(userKey, { assessment: { status: "error" } });
  }, [patchByKey]);

  const finalizeSave = useCallback((entry: PendingSave, saved: Array<Pick<ChatMessage, "id"> | undefined>) => {
    entry.saved = true;
    const userId = saved[0]?.id;
    // saved() 需要用户消息 id;缺失时无法补写,停止跟踪这一轮(评测不删除)
    if (typeof userId === "string") void entry.results.saved(entry.userKey, userId);
    else {
      entry.results.forget(entry.userKey);
      settlePending(entry.userKey);
    }
    patchByKey(entry.userKey, { id: userId });
    patchByKey(entry.botKey, { id: saved[1]?.id });
  }, [patchByKey, settlePending]);

  /** 保存一对消息。返回 saved / failed(临时失败,保留重试)/ dropped(永久失败,已放弃)。 */
  const saveOne = useCallback(async (entry: PendingSave): Promise<"saved" | "failed" | "dropped"> => {
    const { results } = entry;
    const fields: MessageResultFields = results.fieldsForSave(entry.userKey); // R3:已到达的结果随消息一起保存
    const post = (f: MessageResultFields) => createMessages(api, entry.conversationId, [
      { role: "user", content: entry.content, ...f }, { role: "assistant", content: entry.reply }]);
    try {
      finalizeSave(entry, (await post(fields)).messages);
      return "saved";
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && fields.assessmentId) {
        // 上次保存其实成功了(响应丢失):不能 abandon(会删掉已链接的评测)。重新加载,认领已有消息,否则去掉评测重试
        try {
          const { messages: stored } = await listMessages(api, entry.conversationId);
          const at = stored.findIndex((m) => m.role === "user" && m.assessmentId === fields.assessmentId);
          if (at >= 0) {
            const reply = stored[at + 1];
            finalizeSave(entry, [stored[at], reply?.role === "assistant" ? reply : undefined]);
            return "saved";
          }
          const res = await post({});
          results.forget(entry.userKey);
          settlePending(entry.userKey);
          entry.saved = true;
          patchByKey(entry.userKey, { id: res.messages[0]?.id });
          patchByKey(entry.botKey, { id: res.messages[1]?.id });
          return "saved";
        } catch (inner) {
          err = inner;
        }
      }
      results.saveFailed(entry.userKey);
      if (isPermanentSaveError(err)) {
        results.abandon(entry.userKey);
        return "dropped";
      }
      return "failed";
    }
  }, [api, finalizeSave, patchByKey, settlePending]);

  /** 依次保存队列里的消息对;遇到临时失败就停下(留待下次重试,顺序不变)。 */
  const drainSaves = useCallback(async (): Promise<"ok" | "failed" | "dropped"> => {
    let outcome: "ok" | "failed" | "dropped" = "ok";
    for (;;) {
      const entry = pendingSavesRef.current[0];
      if (!entry) return outcome;
      const remove = () => {
        const queue = pendingSavesRef.current;
        const at = queue.indexOf(entry);
        if (at >= 0) queue.splice(at, 1);
      };
      if (entry.gen !== genRef.current) { // 会话已切换/卸载:不再保存
        entry.results.abandon(entry.userKey);
        remove();
        continue;
      }
      const result = await saveOne(entry);
      if (result === "failed") {
        if (entry.gen !== genRef.current) { // 失败时已切换/卸载:没有人会再重试
          entry.results.abandon(entry.userKey);
          remove();
        }
        return "failed";
      }
      remove();
      if (result === "dropped") outcome = "dropped";
    }
  }, [saveOne]);

  const flushSaves = useCallback(() => {
    const run = saveChainRef.current.then(() => drainSaves());
    saveChainRef.current = run.catch((): void => undefined);
    return run;
  }, [drainSaves]);

  const send = useCallback(async (text: string, base: UiMessage[], turn: TurnExtras = {}) => {
    const content = text.trim();
    const results = resultsRef.current;
    if (!content || !conversation || !results || busyRef.current) return;
    busyRef.current = true;
    const history = base.filter((m) => m.status === "done").map(({ role, content: c }) => ({ role, content: c }));
    const userKey = turn.userKey ?? nextKey("u");
    const botKey = nextKey("a");
    const baseKeys = new Set(base.map((m) => m.key));
    const controller = new AbortController();
    abortRef.current = controller;
    const live = () => mountedRef.current && !controller.signal.aborted;
    const patch = (key: string, change: Partial<UiMessage>) => {
      if (live()) setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...change } : m)));
    };
    forceScrollRef.current = true;
    // 函数式更新:保留同一帧里刚到达的结果补丁;重试时沿用原用户气泡(含语音与评测状态)
    setMessages((prev) => {
      const previous = prev.find((m) => m.key === userKey);
      const user: UiMessage = { ...previous, key: userKey, role: "user", content, status: "done", ...(turn.voice ? { voice: turn.voice } : {}) };
      return [...prev.filter((m) => baseKeys.has(m.key) && m.key !== userKey), user,
        { key: botKey, role: "assistant", content: "", status: "streaming" }];
    });
    setSending(true);
    results.start(userKey, { text: content, wav: turn.wav }); // R1:与回复并行;同一 key 只发起一次(重试不重复评测)
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
      // 流式失败:部分回复被错误气泡取代,且不保存;这一轮保持 open,等待重试或被丢弃
      patch(botKey, { status: "error", content: translateServerError(tRef.current, err, CHAT_SERVER_ERRORS) });
      finish();
      return;
    }
    finish();
    if (controller.signal.aborted) return;
    const entry: PendingSave = {
      gen: genRef.current, results, conversationId: conversation.id, userKey, botKey, content, reply, saved: false,
    };
    pendingSavesRef.current.push(entry);
    const outcome = await flushSaves();
    if (!entry.saved) {
      if (live() && outcome !== "ok") {
        toast.error(tRef.current("web.chat.notSaved"), {
          action: { label: tRef.current("web.common.retry"), onClick: () => { void flushSaves(); } },
        });
      }
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
  }, [api, config, conversation, flushSaves, showTranslation]);

  const voiceBusy = voice.state !== "idle";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input;
    if (busyRef.current || voiceBusy || !conversation || !text.trim()) return;
    setInput("");
    // 规则:失败的一轮(用户消息 + 错误气泡,或未发送的语音草稿)从未保存。发送新消息时直接丢弃它,
    // 因此它既不进入后续历史,刷新后界面也与服务端一致;重试只对最后一个错误气泡开放。
    const { kept, dropped } = dropFailedTail(messages);
    abandonDropped(dropped);
    void send(text, kept);
  };

  const retry = () => {
    if (busyRef.current) return;
    const last = messages[messages.length - 1];
    const user = messages[messages.length - 2];
    if (last?.status !== "error" || last.role !== "assistant" || user?.role !== "user") return;
    // R2:同一历史、同一用户气泡重发转写文本;不重录、不重传、不重新评测
    void send(user.content, messages.slice(0, -2), { userKey: user.key });
  };

  function onVoiceDraft(event: VoiceDraftEvent) {
    if (!mountedRef.current) return;
    if (event.kind === "discarded") {
      // cancel() 中止了这次转写:草稿气泡一并去掉
      setMessages((prev) => prev.filter((m) => m.key !== event.key));
      return;
    }
    if (event.kind === "failed") {
      setMessages((prev) => prev.map((m) => (m.key === event.key
        ? { ...m, status: "error", voice: { phase: "failed", durationMs: m.voice?.durationMs ?? 0, note: event.error } }
        : m)));
      return;
    }
    const view: VoiceView = event.kind === "kept"
      ? { phase: "kept", durationMs: event.durationMs, note: event.note }
      : { phase: "transcribing", durationMs: event.durationMs };
    const status: UiMessage["status"] = event.kind === "kept" ? "error" : "streaming";
    if (messagesRef.current.some((m) => m.key === event.key)) {
      patchByKey(event.key, { status, voice: view });
      return;
    }
    // 新草稿:与文字发送同一规则,先丢弃末尾未发送的失败轮
    const { dropped } = dropFailedTail(messagesRef.current);
    abandonDropped(dropped);
    const droppedKeys = new Set(dropped.map((m) => m.key));
    forceScrollRef.current = true;
    setMessages((prev) => [...prev.filter((m) => !droppedKeys.has(m.key)),
      { key: event.key, role: "user", content: "", status, voice: view }]);
  }

  function onVoiceTranscribed(clip: VoiceClip, text: string) {
    if (!mountedRef.current) return;
    const base = messagesRef.current.filter((m) => m.key !== clip.key);
    // 页面保留 (clip, text):回复失败时重试只重发转写文本,不重录、不重传
    void send(text, base, {
      userKey: clip.key,
      voice: { phase: "sent", durationMs: clip.durationMs, audioUrl: clip.audioUrl },
      wav: clip.wav,
    });
  }

  const discardDraft = (key: string) => {
    discardVoice(key);
    setMessages((prev) => prev.filter((m) => m.key !== key));
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

  const recording = voice.state === "recording" || voice.state === "starting";
  const lastKey = messages[messages.length - 1]?.key;

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
        {messages.map((m) => {
          const draft = m.voice?.phase === "failed" || m.voice?.phase === "kept";
          return (
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
              voiceDraft={draft ? { onRetry: () => voice.retry(m.key), onDiscard: () => discardDraft(m.key) } : undefined}
              onRetry={m.role === "assistant" && m.status === "error" && !sending && m.key === lastKey ? retry : undefined} />
          );
        })}
      </div>
      <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-2">
        <Button type="button" data-testid="chat-mic" data-state={voice.state} size="icon"
          variant={voice.state === "recording" ? "destructive" : "ghost"} className="h-11 w-11 shrink-0"
          disabled={voice.state === "starting" || voice.state === "processing" || (voice.state === "idle" && (sending || !conversation))}
          aria-label={voice.state === "recording" ? t("web.chat.voice.stopAndSend")
            : voice.state === "processing" ? t("web.chat.transcribing") : t("web.chat.mic")}
          onClick={() => void (voice.state === "recording" ? voice.stop() : voice.start())}>
          {voice.state === "processing" ? <LoaderIcon className="h-5 w-5 animate-spin" />
            : voice.state === "recording" ? <SquareIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
        </Button>
        {recording ? (
          <div data-testid="voice-recording" className="flex h-11 flex-1 items-center gap-2 rounded-md border px-3 text-base">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            <span className="sr-only">{t("web.chat.voice.recording")}</span>
            <span data-testid="voice-timer" className="font-mono tabular-nums">{formatClock(voice.elapsedMs)} / {formatClock(VOICE_MAX_MS)}</span>
          </div>
        ) : (
          <Textarea data-testid="chat-input" rows={1} maxLength={20000} value={input} placeholder={t("web.chat.placeholder")}
            disabled={voice.blocksTyping} className="max-h-40 min-h-11 flex-1 resize-none text-base" onChange={(e) => setInput(e.target.value)} />
        )}
        {voiceBusy && (
          <Button type="button" data-testid="chat-mic-cancel" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
            aria-label={t("web.chat.voice.cancel")} onClick={voice.cancel}>
            <XIcon className="h-5 w-5" />
          </Button>
        )}
        <Button type="submit" data-testid="chat-send" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.send")} disabled={!input.trim() || sending || !conversation || voiceBusy}>
          <SendIcon className="h-5 w-5" />
        </Button>
      </form>
      <TurnDetailSheet message={messages.find((m) => m.key === detailKey) ?? null} onClose={() => setDetailKey(null)} />
      <SentencePracticeSheet text={practiceText} onClose={() => setPracticeText(null)} />
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
    </div>
  );
}
