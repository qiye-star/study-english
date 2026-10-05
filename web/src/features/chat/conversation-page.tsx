import { LanguagesIcon, LightbulbIcon, ListChecksIcon, LoaderIcon, MicIcon, SendIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { streamChatCompletion } from "~/api/ai";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { formatClock } from "~/features/practice/practice-page";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, isAmbiguousSaveError, listMessages, updateConversation,
  type ChatMessage, type Conversation, type ConversationConfig, type MessageResultFields,
} from "./chat-api";
import { claimAudio, releaseAudio } from "./audio-focus";
import { coachCandidates, coachNote } from "./coach";
import { HISTORY_LIMIT, buildChatMessages, chatOptions, displayName, titleFrom, withConfigDefaults } from "./chat-request";
import { dropFailedTails, lastAssistantText } from "./chat-turns";
import { GrammarDetails } from "./grammar-details";
import { HintsSheet, hintKey } from "./hints-sheet";
import { ConversationHeaderActions } from "./conversation-header-actions";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { SentencePracticeSheet } from "./sentence-practice-sheet";
import { MessageBubble } from "./message-bubble";
import { normalizeScenario, scenarioLabel } from "./scenarios";
import { fromServerMessage, hasResultFooter, type UiMessage, type VoiceView } from "./ui-message";
import { MessageTranslation } from "./message-translation";
import { GrammarBadge, PronunciationBadge } from "./result-badges";
import { TurnDetailSheet } from "./turn-detail-sheet";
import { TurnResults } from "./turn-results";
import { useAutoSpeak } from "./use-auto-speak";
import { useHints } from "./use-hints";
import { useMessageTranslations } from "./use-message-translations";
import { sharedAutoplayAudio, ttsErrorMessage, useTtsPlayer } from "./use-tts-player";
import { VOICE_MAX_MS, useVoiceTurn, type VoiceClip, type VoiceDraftEvent, type VoiceTurnState } from "./use-voice-turn";

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
  /** 永久失败,已放弃 */
  dropped?: boolean;
  /** 曾发生"服务端可能已保存但响应丢了"的失败:重试前必须先核对服务端,避免重复 */
  ambiguous?: boolean;
  error?: unknown;
}

const isKnownServerError = (err: unknown) =>
  err instanceof ApiError && Object.prototype.hasOwnProperty.call(CHAT_SERVER_ERRORS, err.message);

/**
 * 不会因重试而好转的失败:明确的 4xx 拒绝,以及配额类 429(Message limit reached 等)。
 * 丢弃这一轮的保存,不阻塞后面的轮次。限流类 429 与 408 仍可重试。
 */
const isPermanentSaveError = (err: unknown) =>
  err instanceof ApiError
  && ((err.status === 429 && isKnownServerError(err))
    || (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429));


const sameText = (a: string, b: string) => a.trim() === b.trim();

/** 在已知已保存的末尾之后,查找与这一轮相同的消息对(用于认领"响应丢失"的保存)。 */
function findStoredPair(stored: ChatMessage[], entry: PendingSave, knownTail: string | null | undefined): [ChatMessage, ChatMessage] | null {
  if (knownTail === undefined) return null;
  let from = 0;
  if (knownTail !== null) {
    const at = stored.findIndex((m) => m.id === knownTail);
    if (at < 0) return null;
    from = at + 1;
  }
  for (let i = from; i + 1 < stored.length; i++) {
    if (stored[i].role === "user" && stored[i + 1].role === "assistant"
      && sameText(stored[i].content, entry.content) && sameText(stored[i + 1].content, entry.reply)) {
      return [stored[i], stored[i + 1]];
    }
  }
  return null;
}

export function ConversationPage({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // 加载 effect 经 ref 调用 navigate:navigate 的引用可能随位置变化,不能放进加载 effect 的依赖(否则会重新加载会话)
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // R10:从场景面板过来时,路由 state 带着开场白消息 id
  const speakOpeningRef = useRef<string | null>(null);
  const routeOpening = (location.state as { speakOpening?: unknown } | null)?.speakOpening;
  speakOpeningRef.current = typeof routeOpening === "string" && routeOpening ? routeOpening : null;
  const [openingKey, setOpeningKey] = useState<string | null>(null);
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
  const detailMessage = messages.find((m) => m.key === detailKey) ?? null;
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const canTranslate = native !== "en-US"; // R16:英文界面没有可译的目标语言
  const translations = useMessageTranslations(api, native);
  const resetTranslations = translations.reset;
  const showTranslation = translations.show;
  const hints = useHints(api);
  const resetHints = hints.reset;
  const [hintsOpen, setHintsOpen] = useState(false);
  const tts = useTtsPlayer(api, {
    createAudio: sharedAutoplayAudio,
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
  const conversationRef = useRef<Conversation | null>(null);
  conversationRef.current = conversation;
  /** 服务端已知已保存的最后一条消息 id(null:空会话;undefined:未知) */
  const knownTailRef = useRef<string | null | undefined>(undefined);
  const renamingRef = useRef(false);
  /** 转写已完成、但因页面正忙而未能发送的语音:等用户"发送这段"或丢弃 */
  const heldRef = useRef(new Map<string, { clip: VoiceClip; text: string }>());
  const idRef = useRef(id);
  idRef.current = id;
  // 自动朗读在异步回调里读取最新配置与录音状态(R4)
  const configRef = useRef<ConversationConfig | null>(null);
  const voiceStateRef = useRef<VoiceTurnState>("idle");
  // 契约:prime/stop/play 来自同一个、本页唯一驱动 sharedAutoplayAudio() 的播放器 tts
  // 开关保存期间的本地乐观值:关闭立刻生效,不等 PATCH 返回;保存结束(成功或失败)后清除
  const autoSpeakOverrideRef = useRef<boolean | null>(null);
  const autoSpeak = useAutoSpeak({
    isEnabled: () => autoSpeakOverrideRef.current ?? chatOptions(conversationRef.current?.config).autoSpeak,
    voiceIdle: () => voiceStateRef.current === "idle",
    hasVoice: () => !!configRef.current?.ttsModel,
    prime: tts.prime,
    stop: tts.stop,
    speak: (key, text, onError) => tts.play(key, text, configRef.current?.ttsModel ?? "", configRef.current?.ttsVoice ?? "", { onError, quietIfEmpty: true }),
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
  });
  const resetAutoSpeak = autoSpeak.reset;
  const { begin: autoSpeakBegin, complete: autoSpeakComplete } = autoSpeak;
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
  voiceStateRef.current = voice.state;
  const resetVoice = voice.reset;
  const discardVoice = voice.discard;

  useEffect(() => {
    let alive = true;
    resetAutoSpeak();
    const results = new TurnResults(api, patchByKey);
    resultsRef.current = results;
    genRef.current += 1;
    pendingSavesRef.current = [];
    knownTailRef.current = undefined;
    renamingRef.current = false;
    heldRef.current.clear();
    setConversation(null);
    setSending(false);
    setMessages([]);
    setLoadError(null);
    setPracticeText(null);
    setDetailKey(null);
    setOpeningKey(null);
    setHintsOpen(false);
    resetHints(); // 切换会话:中止进行中的提示请求
    resetTranslations();
    nearBottomRef.current = true; // 新会话加载完成后滚到底
    forceScrollRef.current = false;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined);
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        knownTailRef.current = list.messages.at(-1)?.id ?? null;
        setConversation(c);
        setMessages(list.messages
          .filter((m) => m.role !== "system")
          .map(fromServerMessage));
        const wanted = speakOpeningRef.current;
        if (wanted) {
          const visible = list.messages.filter((m) => m.role !== "system");
          if (visible.length === 1 && visible[0].id === wanted && visible[0].role === "assistant") setOpeningKey(wanted);
          navigateRef.current(`/chat/${encodeURIComponent(id)}`, { replace: true, state: null }); // 刷新不再读
        }
      })
      .catch((err) => alive && setLoadError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS)));
    return () => {
      alive = false;
      stopTts(); // 先停播放器,再让未读完的回复过期(切换会话/卸载)
      resetAutoSpeak();
      // 离开页面或切换会话:中止进行中的流,之后不再 setState
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
      genRef.current += 1;
      // 上次失败"可能已保存"的排队保存:服务端也许已把评测链接到消息,abandonOpen 的 DELETE 会误删,先 forget(不删除)
      for (const entry of pendingSavesRef.current) if (entry.ambiguous && !entry.saved) entry.results.forget(entry.userKey);
      pendingSavesRef.current = [];
      heldRef.current.clear();
      results.abandonOpen(); // R4:未保存的轮次不会再保存,清理其对话评测
      resetVoice(); // 取消录音、中止转写、回收 blob URL
    };
  }, [api, id, resetTranslations, resetHints, patchByKey, resetVoice, resetAutoSpeak, stopTts]);

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

  // 录音开始时占用全应用的音频焦点(先让回放/朗读停下,免得录进喇叭声);空闲时释放
  const micFocus = useRef<() => void>(() => undefined).current;
  useEffect(() => {
    if (voice.state === "idle") releaseAudio(micFocus);
  }, [voice.state, micFocus]);
  useEffect(() => () => releaseAudio(micFocus), [micFocus]);

  useEffect(() => {
    if (voice.error) toast.error(describeAudioError(t, voice.error));
  }, [voice.error, t]);

  const config: ConversationConfig = withConfigDefaults(conversation?.config, ai);
  configRef.current = config;
  const speakOpening = autoSpeak.speakOpening;
  // 等会话与服务端音色默认值都就绪(R2:新会话不存音色)再读开场白;经过 R4 的全部判断
  useEffect(() => {
    if (!openingKey || !conversation || !config.ttsModel) return;
    const opening = messagesRef.current.find((m) => m.key === openingKey);
    setOpeningKey(null);
    if (opening) speakOpening(opening.key, opening.content);
  }, [openingKey, conversation, config.ttsModel, speakOpening]);
  const scenario = normalizeScenario(conversation?.config.scenario);
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
      heldRef.current.delete(m.key);
      discardVoice(m.key);
    }
  }, [discardVoice]);

  /** 评测被 forget 后不会再来结果:界面上还在"评测中"的要结束。 */
  const settlePending = useCallback((userKey: string) => {
    const current = messagesRef.current.find((m) => m.key === userKey);
    if (current?.assessment?.status === "pending") patchByKey(userKey, { assessment: { status: "error" } });
  }, [patchByKey]);

  /** 会话还是默认名时,用第一对已保存消息自己的用户文字改名(不论是首次保存还是重试/排队保存)。 */
  const renameAfterSave = useCallback((entry: PendingSave) => {
    const current = conversationRef.current;
    if (entry.gen !== genRef.current || renamingRef.current || current?.id !== entry.conversationId
      || current.name !== DEFAULT_CONVERSATION_NAME) return;
    renamingRef.current = true;
    const gen = entry.gen;
    updateConversation(api, entry.conversationId, { name: titleFrom(entry.content) })
      .then((renamed) => {
        // 切换会话后,上一个会话的改名结果不能覆盖当前会话
        if (mountedRef.current && genRef.current === gen && renamed.id === idRef.current) setConversation(renamed);
      })
      .catch((): void => undefined) // 改名失败不影响已保存的消息
      .finally(() => { renamingRef.current = false; });
  }, [api]);

  const finalizeSave = useCallback((entry: PendingSave, saved: Array<Pick<ChatMessage, "id"> | undefined>, mode: "link" | "forget" = "link") => {
    entry.saved = true;
    const userId = saved[0]?.id;
    // saved() 需要用户消息 id;缺失(或评测已与别的消息脱钩)时停止跟踪这一轮(评测不删除)
    if (mode === "link" && typeof userId === "string") void entry.results.saved(entry.userKey, userId);
    else {
      entry.results.forget(entry.userKey);
      settlePending(entry.userKey);
    }
    const tail = saved[1]?.id ?? userId;
    // 旧会话晚到的保存不得覆盖新会话的已知尾部
    if (entry.gen === genRef.current) knownTailRef.current = typeof tail === "string" ? tail : undefined;
    patchByKey(entry.userKey, { id: userId });
    patchByKey(entry.botKey, { id: saved[1]?.id });
    renameAfterSave(entry);
  }, [patchByKey, settlePending, renameAfterSave]);

  /** 保存一对消息。返回 saved / failed(临时失败,保留重试)/ dropped(永久失败,已放弃)。 */
  const saveOne = useCallback(async (entry: PendingSave): Promise<"saved" | "failed" | "dropped"> => {
    const { results } = entry;
    const post = (f: MessageResultFields) => createMessages(api, entry.conversationId, [
      { role: "user", content: entry.content, ...f }, { role: "assistant", content: entry.reply }]);
    if (entry.ambiguous) {
      // 上次失败时服务端可能已经保存:先核对,已有就认领(晚到的评测之后补写),没有再重新保存,绝不重复
      try {
        const { messages: stored } = await listMessages(api, entry.conversationId);
        const pair = findStoredPair(stored, entry, knownTailRef.current);
        if (pair) {
          finalizeSave(entry, pair);
          return "saved";
        }
      } catch (err) {
        entry.error = err;
        return "failed";
      }
    }
    const fields: MessageResultFields = results.fieldsForSave(entry.userKey); // R3:已到达的结果随消息一起保存
    let failure: unknown;
    try {
      finalizeSave(entry, (await post(fields)).messages);
      return "saved";
    } catch (err) {
      failure = err;
    }
    if (failure instanceof ApiError && fields.assessmentId) {
      const lost = failure.status === 404 && failure.message === "Assessment not found";
      if (failure.status === 409 || lost) {
        // 409:上次保存其实成功了(响应丢失),不能 abandon(会删掉已链接的评测):重新加载,认领已有消息。
        // 都不是(或评测已不存在):去掉评测重新保存,并停止跟踪评测。
        try {
          if (failure.status === 409) {
            const { messages: stored } = await listMessages(api, entry.conversationId);
            const at = stored.findIndex((m) => m.role === "user" && m.assessmentId === fields.assessmentId);
            if (at >= 0) {
              const reply = stored[at + 1];
              finalizeSave(entry, [stored[at], reply?.role === "assistant" ? reply : undefined]);
              return "saved";
            }
          }
          finalizeSave(entry, (await post({})).messages, "forget");
          return "saved";
        } catch (inner) {
          failure = inner;
        }
      }
    }
    entry.error = failure;
    results.saveFailed(entry.userKey);
    if (isPermanentSaveError(failure)) {
      results.abandon(entry.userKey);
      entry.dropped = true;
      return "dropped";
    }
    if (isAmbiguousSaveError(failure)) entry.ambiguous = true;
    return "failed";
  }, [api, finalizeSave]);

  /** 永久失败:配额等已知文案用翻译后的原因,其余用通用"未保存"。 */
  const toastDropped = useCallback((entry: PendingSave) => {
    if (!mountedRef.current || entry.gen !== genRef.current) return;
    toast.error(isKnownServerError(entry.error)
      ? translateServerError(tRef.current, entry.error, CHAT_SERVER_ERRORS)
      : tRef.current("web.chat.notSaved"));
  }, []);

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
      if (result === "dropped") {
        outcome = "dropped";
        toastDropped(entry);
      }
    }
  }, [saveOne, toastDropped]);

  const flushSaves = useCallback(() => {
    const run = saveChainRef.current.then(() => drainSaves());
    saveChainRef.current = run.catch((): void => undefined);
    return run;
  }, [drainSaves]);

  /** 临时失败的提示:Retry 再失败时会再次提示,不会静默。 */
  const toastNotSaved: () => void = useCallback(() => {
    toast.error(tRef.current("web.chat.notSaved"), {
      action: {
        label: tRef.current("web.common.retry"),
        onClick: () => { void flushSaves().then((o) => { if (o === "failed" && mountedRef.current) toastNotSaved(); }); },
      },
    });
  }, [flushSaves]);

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
    autoSpeakBegin(botKey); // 之前的回复从此过期
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
    results.start(userKey, {
      text: content,
      wav: turn.wav,
      grammar: { enabled: optionsRef.current.grammarCheck, context: lastAssistantText(base) },
    }); // R1:与回复并行;同一 key 只发起一次(重试不重复评测)
    const finish = () => {
      // 不清空 abortRef:保存/改名阶段切换会话时,清理函数仍能让 live() 变 false
      if (abortRef.current === controller) busyRef.current = false;
      if (live()) setSending(false);
    };
    const current = messagesRef.current.find((m) => m.key === userKey);
    const coach = optionsRef.current.coachMode ? coachNote(coachCandidates(base, current)) : null;
    let reply = "";
    try {
      reply = await streamChatCompletion(api,
        { messages: buildChatMessages(config, history, content, HISTORY_LIMIT, coach), model: config.model, temperature: config.temperature },
        (full) => patch(botKey, { content: full }), controller.signal);
      if (!reply.trim()) throw new ApiError(502, "Empty AI response");
      patch(botKey, { content: reply, status: "done" });
      if (live()) autoSpeakComplete(botKey, reply, "done");
      if (optionsRef.current.bilingual && canTranslateRef.current && live()) showTranslation(botKey, reply);
    } catch (err) {
      // 离开页面/中止时 live() 为 false,patch 不生效,也不弹错误;
      // 流式失败:部分回复被错误气泡取代,且不保存;这一轮保持 open,等待重试或被丢弃
      patch(botKey, { status: "error", content: translateServerError(tRef.current, err, CHAT_SERVER_ERRORS) });
      if (live()) autoSpeakComplete(botKey, "", "error"); // 最终结果:这个 key 不再读
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
    if (!entry.saved && !entry.dropped && outcome === "failed" && live()) toastNotSaved();
  }, [api, config, conversation, flushSaves, showTranslation, toastNotSaved, autoSpeakBegin, autoSpeakComplete]);

  const voiceBusy = voice.state !== "idle";

  // 开始发送或录音后,提示所依据的那条回复就不再是最后一条:关闭面板并丢弃进行中的请求
  useEffect(() => {
    if (sending || voiceBusy) {
      setHintsOpen(false);
      resetHints();
    }
  }, [sending, voiceBusy, resetHints]);

  /** R12:基于最近已完成的消息(失败的尾部不算) */
  const openHints = () => {
    if (!conversation || busyRef.current || voice.state !== "idle") return;
    const done = dropFailedTails(messagesRef.current).kept.filter((m) => m.status === "done");
    const anchor = [...done].reverse().find((m) => m.role === "assistant");
    // 上一组提示还在朗读:停下,免得新一组同位置的条目显示成"播放中"
    if (Object.entries(tts.states).some(([key, state]) => key.startsWith("hint-") && state !== "idle" && state !== "error")) stopTts();
    hints.request({
      conversationId: conversation.id,
      anchor: anchor ? { id: anchor.id, key: anchor.key } : null,
      level: options.level,
      // 只传有界的场景 id(自定义场景是 "custom"),不把自定义文字放进提示请求
      scenarioId: normalizeScenario(conversation.config.scenario)?.id ?? null,
      messages: done.map(({ role, content }) => ({ role, content })),
    });
    setHintsOpen(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input;
    if (busyRef.current || voiceBusy || !conversation || !text.trim()) return;
    autoSpeak.prime(); // R5:点击的同步阶段解锁
    setInput("");
    // 规则:失败的一轮(用户消息 + 错误气泡,或未发送的语音草稿)从未保存。发送新消息时直接丢弃它,
    // 因此它既不进入后续历史,刷新后界面也与服务端一致;重试只对最后一个错误气泡开放。
    const { kept, dropped } = dropFailedTails(messages);
    abandonDropped(dropped);
    void send(text, kept);
  };

  const retry = () => {
    if (busyRef.current || voice.state !== "idle") return;
    const last = messages[messages.length - 1];
    const user = messages[messages.length - 2];
    if (last?.status !== "error" || last.role !== "assistant" || user?.role !== "user") return;
    autoSpeak.prime(); // R5:重试是一次点击
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
    const { dropped } = dropFailedTails(messagesRef.current);
    abandonDropped(dropped);
    const droppedKeys = new Set(dropped.map((m) => m.key));
    forceScrollRef.current = true;
    setMessages((prev) => [...prev.filter((m) => !droppedKeys.has(m.key)),
      { key: event.key, role: "user", content: "", status, voice: view }]);
  }

  function onVoiceTranscribed(clip: VoiceClip, text: string) {
    if (!mountedRef.current) return;
    if (busyRef.current || !conversation || !resultsRef.current) {
      // 页面正忙(例如同一帧里刚点了回复重试):转写不能丢,气泡变成可"发送这段"/丢弃的草稿
      heldRef.current.set(clip.key, { clip, text });
      patchByKey(clip.key, {
        content: text,
        status: "error",
        voice: { phase: "kept", durationMs: clip.durationMs, audioUrl: clip.audioUrl, note: tRef.current("web.chat.voice.heldBusy") },
      });
      return;
    }
    startVoiceSend(clip, text);
  }

  function startVoiceSend(clip: VoiceClip, text: string) {
    // 被 held 的草稿可能排在上一轮失败的一对之后:丢弃它们(失败的轮从未保存),与文字发送同一规则
    const { kept: base, dropped } = dropFailedTails(messagesRef.current.filter((m) => m.key !== clip.key));
    abandonDropped(dropped);
    // 页面保留 (clip, text):回复失败时重试只重发转写文本,不重录、不重传
    void send(text, base, {
      userKey: clip.key,
      voice: { phase: "sent", durationMs: clip.durationMs, audioUrl: clip.audioUrl },
      wav: clip.wav,
    });
  }

  const sendDraft = (key: string) => {
    const held = heldRef.current.get(key);
    if (!held) {
      voice.retry(key);
      return;
    }
    if (busyRef.current || voice.state !== "idle") return;
    autoSpeak.prime();
    heldRef.current.delete(key);
    startVoiceSend(held.clip, held.text);
  };

  const discardDraft = (key: string) => {
    heldRef.current.delete(key);
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

  const [autoSpeakSaving, setAutoSpeakSaving] = useState(false);
  const [autoSpeakOptimistic, setAutoSpeakOptimistic] = useState<boolean | null>(null);
  const autoSpeakBusyRef = useRef(false);
  const toggleAutoSpeak = () => {
    if (autoSpeakBusyRef.current || !conversation) return;
    autoSpeakBusyRef.current = true;
    setAutoSpeakSaving(true);
    const next = !(autoSpeakOverrideRef.current ?? options.autoSpeak);
    autoSpeakOverrideRef.current = next;
    setAutoSpeakOptimistic(next);
    if (!next) stopTts(); // 关掉时正在读的也停下
    // 与双语开关同一规则:只写入已存配置 + 这个键
    void saveSettings({ ...conversation.config, autoSpeak: next })
      .catch((): void => undefined)
      .finally(() => {
        autoSpeakBusyRef.current = false;
        autoSpeakOverrideRef.current = null; // 成功:已存配置已是新值;失败:回退
        if (mountedRef.current) { setAutoSpeakSaving(false); setAutoSpeakOptimistic(null); }
      });
  };

  // 服务端 PATCH 整体替换 config:始终以已存配置为底,只叠加用户改动的键,绝不写入带默认值的整份草稿
  const saveSettings = async (changes: Partial<ConversationConfig>) => {
    try {
      const stored = conversation?.config ?? {};
      setConversation(await updateConversation(api, id, { config: { ...stored, ...changes } as ConversationConfig }));
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
          <ConversationHeaderActions canTranslate={canTranslate} bilingual={options.bilingual} autoSpeak={autoSpeakOptimistic ?? options.autoSpeak}
            loaded={!!conversation} bilingualSaving={bilingualSaving} autoSpeakSaving={autoSpeakSaving}
            onToggleBilingual={toggleBilingual} onToggleAutoSpeak={toggleAutoSpeak} onOpenSettings={() => setSettingsOpen(true)} />
        } />
      {(scenario || options.level !== "auto") && (
        <div data-testid="conversation-scenario" className="flex items-center gap-2 border-b px-4 py-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{scenario ? scenarioLabel(t, scenario) : t("web.chat.scenarios.free.title")}</span>
          {options.level !== "auto" && <span data-testid="conversation-level" className="rounded bg-muted px-1.5 py-0.5">{options.level}</span>}
        </div>
      )}
      {loadError && <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>}
      <div ref={listRef} data-testid="message-list" onScroll={onListScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => {
          const draft = m.voice?.phase === "failed" || m.voice?.phase === "kept";
          return (
            <MessageBubble key={m.key} message={m} playbackDisabled={voiceBusy}
              footer={hasResultFooter(m) ? (
                <div data-testid="message-footer" className="mt-1 flex flex-wrap justify-end gap-1">
                  <PronunciationBadge view={m.assessment} onOpen={() => setDetailKey(m.key)} />
                  <GrammarBadge view={m.grammar} onOpen={() => setDetailKey(m.key)} onRetry={() => resultsRef.current?.retryGrammar(m.key)} />
                </div>
              ) : null}
              actions={
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" data-testid="message-tts" data-state={tts.states[m.key] ?? "idle"} disabled={voiceBusy}
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
              voiceDraft={draft ? { onRetry: () => sendDraft(m.key), onDiscard: () => discardDraft(m.key) } : undefined}
              onRetry={m.role === "assistant" && m.status === "error" && !sending && voice.state === "idle" && m.key === lastKey ? retry : undefined} />
          );
        })}
      </div>
      {autoSpeak.blocked && (
        <div data-testid="autospeak-blocked" role="status" className="flex items-center gap-2 border-t bg-muted px-3 py-1 text-sm">
          <span className="flex-1">{t("web.chat.autoSpeak.blocked")}</span>
          <Button size="sm" data-testid="autospeak-tap" className="h-11" onClick={autoSpeak.tapToRead}>
            <Volume2Icon className="mr-1 h-4 w-4" />{t("web.chat.autoSpeak.tapToRead")}
          </Button>
          <Button variant="ghost" size="icon" data-testid="autospeak-dismiss" className="h-11 w-11" aria-label={t("web.chat.autoSpeak.dismiss")}
            onClick={autoSpeak.dismissBlocked}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-end gap-2 border-t bg-background p-2">
        <Button type="button" data-testid="chat-mic" data-state={voice.state} size="icon"
          variant={voice.state === "recording" ? "destructive" : "ghost"} className="h-11 w-11 shrink-0"
          disabled={voice.state === "starting" || voice.state === "processing" || (voice.state === "idle" && (sending || !conversation))}
          aria-label={voice.state === "recording" ? t("web.chat.voice.stopAndSend")
            : voice.state === "processing" ? t("web.chat.transcribing") : t("web.chat.mic")}
          onClick={() => {
            if (voice.state === "recording") {
              void voice.stop();
              autoSpeak.prime(); // R5:结束录音这一下解锁,转写 + 回复完成后接着播
            } else {
              stopTts(); // 开始录音:正在进行的朗读(含自动朗读)停下
              claimAudio(micFocus);
              void voice.start();
            }
          }}>
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
        <Button type="button" data-testid="chat-hints" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.hints.button")} disabled={!conversation || sending || voiceBusy} onClick={openHints}>
          <LightbulbIcon className="h-5 w-5" />
        </Button>
        <Button type="submit" data-testid="chat-send" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.send")} disabled={!input.trim() || sending || !conversation || voiceBusy}>
          <SendIcon className="h-5 w-5" />
        </Button>
      </form>
      <TurnDetailSheet message={detailMessage} onClose={() => setDetailKey(null)}>
        {detailMessage?.grammar?.result && <GrammarDetails result={detailMessage.grammar.result} onClose={() => setDetailKey(null)} />}
      </TurnDetailSheet>
      <SentencePracticeSheet text={practiceText} onClose={() => setPracticeText(null)} />
      <HintsSheet open={hintsOpen} onOpenChange={setHintsOpen} state={hints.state} onRetry={hints.retry}
        onFill={(text) => { setInput(text); setHintsOpen(false); }}
        onSpeak={(i, text) => void tts.play(hintKey(i), text, config.ttsModel, config.ttsVoice)}
        speakStates={tts.states}
        onPractice={(text) => { setHintsOpen(false); goPractice(navigate, text); }}
        onSave={(text) => void savePracticeItem(api, t, text, "chat")} />
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
    </div>
  );
}
