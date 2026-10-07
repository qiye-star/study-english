import { LanguagesIcon, LightbulbIcon, ListChecksIcon, LoaderIcon, SendIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { streamChatCompletion } from "~/api/ai";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, voicesFor, type ServerAiConfig } from "~/api/server-config";
import { browserCaptureEnv } from "~/audio/capture";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { formatClock } from "~/features/practice/practice-page";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import { fetchRealtimeConfig, type RealtimeConfig } from "~/features/realtime/realtime-api";
import type { CallEnding, RealtimeEnv } from "~/features/realtime/realtime-call";
import { RealtimeCallDialog, prepareCallAudio } from "~/features/realtime/realtime-call-screen";
import { AddVocabularyButton } from "~/features/vocabulary/add-vocabulary-button";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import {
  CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createMessages, getConversation, isAmbiguousSaveError, listMessages, updateConversation,
  type ChatMessage, type Conversation, type ConversationConfig, type MessageResultFields,
} from "./chat-api";
import { claimAudio, releaseAudio } from "./audio-focus";
import { coachCandidates, coachNote } from "./coach";
import { HISTORY_LIMIT, buildChatMessages, chatOptions, displayName, effectiveSystemPrompt, titleFrom, withConfigDefaults } from "./chat-request";
import { dropFailedTails, lastAssistantText } from "./chat-turns";
import { GrammarDetails } from "./grammar-details";
import { HintsSheet, hintKey } from "./hints-sheet";
import type { DiscardReason } from "./hold-to-talk";
import { HoldToTalkButton } from "./hold-to-talk-button";
import { ConversationHeaderActions } from "./conversation-header-actions";
import { ConversationSettingsSheet } from "./conversation-settings-sheet";
import { SentencePracticeSheet } from "./sentence-practice-sheet";
import { MessageBubble } from "./message-bubble";
import { normalizeScenario, scenarioLabel } from "./scenarios";
import { readStoredRecap } from "./recap";
import { RecapSheet } from "./recap-sheet";
import { fromServerMessage, hasResultFooter, type UiMessage, type VoiceView } from "./ui-message";
import { MessageTranslation } from "./message-translation";
import { GrammarBadge, PronunciationBadge } from "./result-badges";
import { TurnDetailSheet } from "./turn-detail-sheet";
import { TurnResults, type TurnChange } from "./turn-results";
import { useAutoSpeak } from "./use-auto-speak";
import { useHints } from "./use-hints";
import { useMessageTranslations } from "./use-message-translations";
import { sharedAutoplayAudio, ttsErrorMessage, useTtsPlayer } from "./use-tts-player";
import { VOICE_MAX_MS, useVoiceTurn, type VoiceClip, type VoiceDraftEvent, type VoiceTurnState } from "./use-voice-turn";

/**
 * 通话结束后(review F4 I-1):等服务端关闭套接字(它先存完被打断的回复,`HANGUP_CLOSE_WAIT_MS` 封顶)→ 重新加载 →
 * 再过这么久按 id 补取一次(服务端在关闭之后才链接的发音评测)。
 */
export const POST_CALL_FOLLOW_UP_MS = 2000;
/** 从关闭通话起,输入与麦克风最多禁用这么久;到点还没补取完就放弃补取。 */
export const POST_CALL_SETTLE_MAX_MS = 6000;

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

/** 按住说话被丢弃时提示条的文案(R11) */
const HOLD_HINTS: Record<DiscardReason, string> = {
  short: "web.chat.hold.tooShort", "not-ready": "web.chat.hold.notReady", slide: "web.chat.hold.cancelled", cancel: "web.chat.hold.cancelled",
};

/**
 * 实时通话的音色。通话只用服务端的火山 TTS(REALTIME_TTS_MODEL = volcengine/…,服务端 volc_tts_stream):
 * 会话用别家模型朗读时(例如 openai 的 alloy),那个音色在火山上不存在,每句都会合成失败——改用服务端的火山音色
 * (默认预设是火山时用它的音色,否则取火山的第一个英文音色);服务端 AI 配置没加载到时无从得知火山音色,
 * 返回 null,页面直接以 invalidVoice 拒绝(不把 alloy 之类送去必然失败的通话)。
 */
function callVoice(config: ConversationConfig, ai: ServerAiConfig | null): string | null {
  if (config.ttsModel.startsWith("volcengine/")) return config.ttsVoice;
  if (!ai) return null;
  if (ai.defaultTts.model.startsWith("volcengine/") && ai.defaultTts.voice) return ai.defaultTts.voice;
  const volc = ai.ttsModels.find((m) => m.startsWith("volcengine/"));
  return (volc && voicesFor(ai, volc)[0]?.value) || config.ttsVoice;
}

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

export function ConversationPage({ recorderEnv, realtimeEnv }: { recorderEnv?: RecorderEnv; realtimeEnv?: RealtimeEnv }) {
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
  /** 服务端 AI 配置已有结果(成功或失败):通话入口等它,点击时才知道该用哪个音色 */
  const [aiSettled, setAiSettled] = useState(false);
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
  const [recapOpen, setRecapOpen] = useState(false);
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
  /** 排队待保存的消息对的个数(界面用:有未保存的一对时不能开始通话) */
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
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
  // 契约:prime/stop/play/playQueue 来自同一个、本页唯一驱动 sharedAutoplayAudio() 的播放器 tts。
  // 流被中止而不调用 complete 的路径(切换会话/卸载)由加载 effect 的清理先 stopTts(),开着的句子队列不会悬空
  // 开关保存期间的本地乐观值:关闭立刻生效,不等 PATCH 返回;保存结束(成功或失败)后清除
  const autoSpeakOverrideRef = useRef<boolean | null>(null);
  // 实时通话进行中:页面不自动朗读(通话占着音频焦点,背后的页面是 inert 的)
  const callActiveRef = useRef(false);
  const autoSpeak = useAutoSpeak({
    isEnabled: () => !callActiveRef.current && (autoSpeakOverrideRef.current ?? chatOptions(conversationRef.current?.config).autoSpeak),
    voiceIdle: () => voiceStateRef.current === "idle",
    hasVoice: () => !!configRef.current?.ttsModel,
    prime: tts.prime,
    stop: tts.stop,
    speak: (key, text, onError) => tts.play(key, text, configRef.current?.ttsModel ?? "", configRef.current?.ttsVoice ?? "", { onError, quietIfEmpty: true }),
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    // R8:按句流水线朗读,与 prime/stop/play 同一个 tts 实例
    speakQueue: (key, onError) => tts.playQueue(key, configRef.current?.ttsModel ?? "", configRef.current?.ttsVoice ?? "", { onError }),
  });
  const resetAutoSpeak = autoSpeak.reset;
  const { begin: autoSpeakBegin, complete: autoSpeakComplete, progress: autoSpeakProgress } = autoSpeak;
  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;
  const nearBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const syncPendingSaves = useCallback(() => {
    if (mountedRef.current) setPendingSaveCount(pendingSavesRef.current.length);
  }, []);
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
    onTranscribedText: (text) => onVoiceFill(text),
  });
  voiceStateRef.current = voice.state;
  const resetVoice = voice.reset;
  const discardVoice = voice.discard;

  // 实时通话(Task 4.11):服务端开启且浏览器有 AudioContext 才显示入口;结束后重新加载会话(reloadKey)
  const [realtimeConfig, setRealtimeConfig] = useState<RealtimeConfig | null>(null);
  const [call, setCall] = useState<{ context: AudioContext; voice: string } | null>(null);
  callActiveRef.current = !!call;
  const [reloadKey, setReloadKey] = useState(0);
  /** 通话刚结束、还在等服务端写完并补取(输入、麦克风、提示、通话都禁用;有上限) */
  const [settling, setSettling] = useState(false);
  const settlingRef = useRef(false);
  const settleTimerRef = useRef<number | undefined>(undefined);
  /** 还在等服务端关闭的通话套接字:切换会话/卸载时 drop */
  const endingRef = useRef<CallEnding | null>(null);
  /**
   * 通话结束后把焦点还给通话按钮(review F2 m12):打开通话的同一次提交里按钮就被禁用了,对话框记下的原焦点多半是 body,
   * 收尾期间按钮也一直禁用。所以等按钮重新可用时再还;用户在这期间把焦点放到了别处(例如输入框)就不动它。
   */
  const callButtonRef = useRef<HTMLButtonElement>(null);
  const refocusCallRef = useRef(false);
  /** 下一次加载是通话后的重新加载:加载完再补取一次 */
  const followUpRef = useRef(false);
  const stopSettling = useCallback(() => {
    window.clearTimeout(settleTimerRef.current);
    settlingRef.current = false;
    followUpRef.current = false;
    if (mountedRef.current) setSettling(false);
  }, []);
  // 切换会话或离开页面:不再等上一通的套接字,也不再补取
  useEffect(() => () => {
    endingRef.current?.drop();
    endingRef.current = null;
    stopSettling();
  }, [id, stopSettling]);
  /** 本次通话里服务端保存了几句用户话语(0 句不必重新加载) */
  const callTurnsRef = useRef(0);
  /**
   * 通话里各句的语法检查(R14)。key 就是服务端消息 id:关闭通话后重新加载的气泡 key 也是这个 id(fromServerMessage),
   * 所以晚到的结果直接补到重新加载的气泡上,不必等语法再加载。views 记下每句的最新结果,
   * 结果落在"清空列表 → 加载完成"之间时由加载补上。独立于每次加载新建的 resultsRef:重新加载不影响它。
   */
  const callResultsRef = useRef<{ conversationId: string; results: TurnResults; views: Map<string, TurnChange> } | null>(null);
  const callAudioSupported = useMemo(() => !!(realtimeEnv?.capture ?? browserCaptureEnv()).createAudioContext, [realtimeEnv]);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    fetchRealtimeConfig(api, controller.signal).then(
      (c) => { if (alive) setRealtimeConfig(c); },
      () => { if (alive) setRealtimeConfig(null); }, // 旧服务端没有这个接口:不显示入口
    );
    return () => { alive = false; controller.abort(); };
  }, [api]);

  useEffect(() => {
    let alive = true;
    let followUpTimer: number | undefined;
    const followUp = followUpRef.current;
    followUpRef.current = false;
    resetAutoSpeak();
    const results = new TurnResults(api, patchByKey);
    resultsRef.current = results;
    genRef.current += 1;
    pendingSavesRef.current = [];
    setPendingSaveCount(0);
    knownTailRef.current = undefined;
    renamingRef.current = false;
    heldRef.current.clear();
    // 切换会话 / 通话后重新加载:没有通话在进行(切换时卸载对话框 = 挂断),上一通的统计作废
    setCall(null);
    callTurnsRef.current = 0;
    setConversation(null);
    setSending(false);
    setMessages([]);
    setLoadError(null);
    setPracticeText(null);
    setDetailKey(null);
    setOpeningKey(null);
    setHintsOpen(false);
    setRecapOpen(false);
    resetHints(); // 切换会话:中止进行中的提示请求
    resetTranslations();
    nearBottomRef.current = true; // 新会话加载完成后滚到底
    forceScrollRef.current = false;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => undefined)
      .finally(() => { if (alive) setAiSettled(true); });
    /** 服务端消息 → 气泡,叠上通话里各句晚到的语法结果(加载途中到达的那些也在这里补上) */
    const toUi = (list: ChatMessage[]) => {
      const book = callResultsRef.current;
      const views = book?.conversationId === id ? book.views : null;
      return list.filter((m) => m.role !== "system").map(fromServerMessage).map((m) => {
        const view = views?.get(m.key);
        return view ? { ...m, ...view } : m;
      });
    };
    /**
     * 通话后的补取:按服务端顺序重建,已有的气泡按 id 合并(新到的评测、语法补上),新 id 加进来;
     * 没有服务端 id 的本地气泡原样留在末尾(收尾期间输入是禁用的,正常不会有)。
     */
    const followUpFetch = () => {
      listMessages(api, id)
        .then((list) => {
          if (!alive || !settlingRef.current) return; // 到了上限已放弃:结果不再采用
          knownTailRef.current = list.messages.at(-1)?.id ?? null;
          const fresh = toUi(list.messages);
          setMessages((prev) => {
            const byKey = new Map(prev.map((m) => [m.key, m]));
            const keys = new Set(fresh.map((m) => m.key));
            return [...fresh.map((m) => ({ ...byKey.get(m.key), ...m })), ...prev.filter((m) => !m.id && !keys.has(m.key))];
          });
        })
        .catch((): void => undefined) // 补取失败:保留重新加载的结果
        .finally(() => { if (alive) stopSettling(); });
    };
    Promise.all([getConversation(api, id), listMessages(api, id)])
      .then(([c, list]) => {
        if (!alive) return;
        knownTailRef.current = list.messages.at(-1)?.id ?? null;
        setConversation(c);
        setMessages(toUi(list.messages));
        if (followUp && settlingRef.current) followUpTimer = window.setTimeout(followUpFetch, POST_CALL_FOLLOW_UP_MS);
        const wanted = speakOpeningRef.current;
        if (wanted) {
          const visible = list.messages.filter((m) => m.role !== "system");
          if (visible.length === 1 && visible[0].id === wanted && visible[0].role === "assistant") setOpeningKey(wanted);
          navigateRef.current(`/chat/${encodeURIComponent(id)}`, { replace: true, state: null }); // 刷新不再读
        }
      })
      .catch((err) => {
        if (!alive) return;
        setLoadError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS));
        if (followUp) stopSettling();
      });
    return () => {
      alive = false;
      window.clearTimeout(followUpTimer);
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
  }, [api, id, reloadKey, resetTranslations, resetHints, patchByKey, resetVoice, resetAutoSpeak, stopTts, stopSettling]);

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
        // 只采用新名字:config 以本地最新(config 写入链的响应)为准,晚到的改名响应不得带回旧 config
        if (mountedRef.current && genRef.current === gen && renamed.id === idRef.current) {
          setConversation((c) => (c && c.id === renamed.id ? { ...renamed, config: c.config } : renamed));
        }
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
    const run = saveChainRef.current.then(() => drainSaves()).finally(syncPendingSaves);
    saveChainRef.current = run.catch((): void => undefined);
    return run;
  }, [drainSaves, syncPendingSaves]);

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
        (full) => { patch(botKey, { content: full }); if (live()) autoSpeakProgress(botKey, full); }, controller.signal);
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
    syncPendingSaves();
    const outcome = await flushSaves();
    if (!entry.saved && !entry.dropped && outcome === "failed" && live()) toastNotSaved();
  }, [api, config, conversation, flushSaves, syncPendingSaves, showTranslation, toastNotSaved, autoSpeakBegin, autoSpeakComplete, autoSpeakProgress]);

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
    if (!conversation || busyRef.current || voice.state !== "idle" || settlingRef.current) return;
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
    if (busyRef.current || voiceBusy || !conversation || settlingRef.current || !text.trim()) return;
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

  // 所有 config 写入(设置面板、双语、自动朗读、复盘)走同一条链:服务端 PATCH 整体替换 config,
  // 每次写入在真正执行时才以最新已知配置(上一次 PATCH 的响应)为底,只叠加自己的键,互不覆盖
  const configChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveSettings = useCallback((changes: Partial<ConversationConfig>): Promise<void> => {
    const target = conversationRef.current;
    if (!target) { // 会话未加载:绝不 PATCH(否则会用空底整体替换已存配置)
      toast.error(tRef.current("web.chat.notSaved"));
      return Promise.reject(new Error("Conversation not loaded"));
    }
    if (Object.keys(changes).length === 0) return Promise.resolve(); // 没有改动:不发空 PATCH
    const gen = genRef.current;
    const current = () => gen === genRef.current && mountedRef.current;
    const run = configChainRef.current.then(async () => {
      const latest = conversationRef.current;
      if (!current() || latest?.id !== target.id) throw new Error("Conversation changed");
      const updated = await updateConversation(api, target.id, { config: { ...latest.config, ...changes } as ConversationConfig });
      if (!current()) return;
      conversationRef.current = updated; // 排在后面的写入立刻以它为底,不等重新渲染
      setConversation(updated);
    }).catch((err: unknown) => {
      if (current()) toast.error(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS));
      throw err;
    });
    configChainRef.current = run.catch((): void => undefined); // 失败不阻塞后面的写入
    return run;
  }, [api]);

  const [bilingualSaving, setBilingualSaving] = useState(false);
  const bilingualBusyRef = useRef(false);
  const toggleBilingual = () => {
    if (bilingualBusyRef.current || !conversation) return;
    bilingualBusyRef.current = true;
    setBilingualSaving(true);
    // 只写这个键;底由 saveSettings 在执行时取已存配置,避免把 ai 未加载时的空默认值固化下来
    void saveSettings({ bilingual: !options.bilingual })
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
    // 与双语开关同一规则:只写这个键
    void saveSettings({ autoSpeak: next })
      .catch((): void => undefined)
      .finally(() => {
        autoSpeakBusyRef.current = false;
        // 成功:conversationRef 已是 PATCH 响应(新值);失败:回退到已存值
        autoSpeakOverrideRef.current = null;
        if (mountedRef.current) { setAutoSpeakSaving(false); setAutoSpeakOptimistic(null); }
      });
  };

  // R11 转文字:转写结果放进输入框,不发送。已有文字时用一个空格接在后面;输入框在转写期间是禁用的,
  // 等它恢复可用再把焦点放进去
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusInputRef = useRef(false);
  function onVoiceFill(text: string) {
    if (!mountedRef.current) return;
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    focusInputRef.current = true;
  }
  useEffect(() => {
    if (!focusInputRef.current || voice.blocksTyping) return;
    focusInputRef.current = false;
    inputRef.current?.focus();
  });

  // 按住说话的提示条(太短 / 麦克风刚就绪 / 已取消):role="status",2 秒后消失。
  // n 每次加一:同样的文字再出现一次(连点两下太短)也重新计时
  const [holdHint, setHoldHint] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (!holdHint) return;
    const timer = window.setTimeout(() => setHoldHint(null), 2000);
    return () => window.clearTimeout(timer);
  }, [holdHint]);

  /**
   * 未发送的本地状态:等待 Retry 的未保存的一对、失败/保留的尾部(回复失败、语音草稿、held 转写)、进行中的发送/流式/录音。
   * 通话结束后的重新加载会清掉本地状态(并 abandonOpen 删除未保存轮次的评测),所以有这些时不能开始通话(I-3)。
   * 同步读 ref:与点击同一帧里刚发生的变化也算。
   */
  const hasUnsentState = () => busyRef.current || voiceStateRef.current !== "idle" || pendingSavesRef.current.length > 0
    || heldRef.current.size > 0 || messagesRef.current.some((m) => m.status !== "done");
  /** 同一条件的渲染值(按钮的提示) */
  const unsentShown = pendingSaveCount > 0 || messages.some((m) => m.status !== "done");

  /**
   * 打开通话。整个函数是同步的(iOS:AudioContext 必须在点击的同步阶段、任何 await 之前解锁,R31):
   * 拒绝条件(未发送的状态、无法确定通话音色)→ 停止朗读 → 取页面级共享 AudioContext 并解锁
   * (`prepareCallAudio`,所有权不交给通话)→ 挂上对话框。
   */
  const startCall = () => {
    if (!conversation || !realtimeConfig?.enabled || call || settlingRef.current) return;
    if (hasUnsentState()) {
      toast.error(t("web.chat.callBlocked.unsent"));
      // 等待 Retry 的保存:提示条可能已被关掉,这一下就当作 Retry(成功后按钮恢复,再点即可通话)
      if (pendingSavesRef.current.length > 0 && !busyRef.current) {
        void flushSaves().then((o) => { if (o === "failed" && mountedRef.current) toastNotSaved(); });
      }
      return;
    }
    const voiceName = callVoice(config, ai);
    if (!voiceName) {
      toast.error(t("web.realtime.errors.invalidVoice"));
      return;
    }
    stopTts(); // 通话期间不得有其他播放(通话自己也会 claimAudio)
    const audio = prepareCallAudio(realtimeEnv?.capture);
    if (!audio) {
      toast.error(t("web.realtime.errors.unsupported"));
      return;
    }
    callTurnsRef.current = 0;
    setCall({ context: audio.context, voice: voiceName });
  };

  /** R14:服务端保存了一句通话里的用户话语 → 按会话设置做语法检查并补写到这条消息(key = 消息 id,失败静默)。 */
  const onCallUserMessage = (messageId: string, text: string, context?: string) => {
    callTurnsRef.current += 1;
    const conversationId = conversationRef.current?.id;
    if (!conversationId) return;
    let book = callResultsRef.current;
    if (!book || book.conversationId !== conversationId) {
      const views = new Map<string, TurnChange>();
      book = {
        conversationId,
        views,
        results: new TurnResults(api, (key, change) => {
          views.set(key, { ...views.get(key), ...change });
          patchByKey(key, change);
        }),
      };
      callResultsRef.current = book;
    }
    void book.results.checkSaved(messageId, messageId, {
      text,
      // 第一句之前通话里还没有回复:用页面上(通话前)最后一条回复
      grammar: { enabled: optionsRef.current.grammarCheck, context: context ?? lastAssistantText(messagesRef.current) },
    });
  };

  /**
   * 关闭通话界面(挂断或看完结束原因)。重新加载会话,复盘/进度/词汇本才看得到通话里的消息(R13),但要等服务端写完
   * (review F4 I-1):挂断后服务端才存被打断的回复、关闭之后才链接评测。所以先等套接字关闭(`ending.closed`,
   * 服务端存完回复才关;最多 HANGUP_CLOSE_WAIT_MS),再重新加载,加载完 POST_CALL_FOLLOW_UP_MS 后按 id 补取一次;
   * 这期间输入与麦克风禁用(从关闭起最多 POST_CALL_SETTLE_MAX_MS)。麦克风、VAD、播放器在挂断时已立即释放。
   * 不等语法检查:晚到的结果按消息 id 补到重新加载的气泡上。开始通话时已确保没有未发送的本地状态(I-3),
   * 通话期间页面是 inert 的、收尾期间输入禁用,所以这次重新加载不会丢掉、也不会 abandonOpen 任何未保存的轮次。
   * 没有连上(票据被拒等)且没有保存过话语:不重新加载。
   */
  const closeCall = (ending: CallEnding | null) => {
    setCall(null);
    refocusCallRef.current = true;
    if (!ending) {
      const turns = callTurnsRef.current;
      callTurnsRef.current = 0;
      if (turns) setReloadKey((k) => k + 1);
      return;
    }
    window.clearTimeout(settleTimerRef.current);
    settlingRef.current = true;
    setSettling(true);
    settleTimerRef.current = window.setTimeout(stopSettling, POST_CALL_SETTLE_MAX_MS);
    endingRef.current = ending;
    const gen = genRef.current;
    void ending.closed.then(() => {
      if (endingRef.current === ending) endingRef.current = null;
      // 等待期间切换了会话或离开了页面(drop 也会兑现 closed):什么都不做
      if (!mountedRef.current || gen !== genRef.current || !settlingRef.current) return;
      const turns = callTurnsRef.current; // 包括挂断后、关闭前服务端才保存的话语
      callTurnsRef.current = 0;
      if (!turns && !ending.opened) {
        stopSettling();
        return;
      }
      followUpRef.current = true;
      setReloadKey((k) => k + 1);
    });
  };

  useEffect(() => {
    const button = callButtonRef.current;
    if (!refocusCallRef.current || call || settling || !button || button.disabled) return;
    refocusCallRef.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) button.focus();
  });

  const recording = voice.state === "recording" || voice.state === "starting";
  const lastKey = messages[messages.length - 1]?.key;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={conversation ? displayName(conversation, t("web.chat.untitled")) : t("web.common.loading")} back="/chat"
        actions={
          <ConversationHeaderActions canTranslate={canTranslate} bilingual={options.bilingual} autoSpeak={autoSpeakOptimistic ?? options.autoSpeak}
            loaded={!!conversation} bilingualSaving={bilingualSaving} autoSpeakSaving={autoSpeakSaving}
            onToggleBilingual={toggleBilingual} onToggleAutoSpeak={toggleAutoSpeak} onOpenSettings={() => setSettingsOpen(true)}
            onOpenRecap={() => setRecapOpen(true)}
            canCall={!!realtimeConfig?.enabled && callAudioSupported && aiSettled} callDisabled={!conversation || sending || voiceBusy || !!call || settling}
            callBlockedReason={unsentShown ? t("web.chat.callBlocked.unsent") : undefined}
            onCall={startCall} callButtonRef={callButtonRef} />
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
                  <PronunciationBadge view={m.assessment} transcript={m.content} onOpen={() => setDetailKey(m.key)} />
                  <GrammarBadge view={m.grammar} onOpen={() => setDetailKey(m.key)} onRetry={() => {
                    resultsRef.current?.retryGrammar(m.key);
                    callResultsRef.current?.results.retryGrammar(m.key); // 通话里的一句(key = 消息 id)
                  }} />
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
      {holdHint && (
        <div data-testid="hold-hint" role="status" className="border-t bg-muted px-3 py-1 text-sm">{holdHint.text}</div>
      )}
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
        <HoldToTalkButton voiceState={voice.state}
          disabled={voice.state === "processing" || (voice.state === "idle" && (sending || !conversation || !!call || settling))}
          onStart={() => {
            // 按下的同步阶段(iOS:getUserMedia 要在手势里调用)。录音期间不得有其他播放:
            // 正在进行的朗读(含按句流水线的自动朗读)先停下,再占用音频焦点
            stopTts();
            claimAudio(micFocus);
            return voice.start();
          }}
          onRelease={() => autoSpeak.prime()} // R5:松手这一下解锁,转写 + 回复完成后接着播
          onFinish={(deliver) => { void voice.stop(deliver); }}
          onDiscard={(reason) => {
            // 丢弃:权限弹窗还开着(starting)时也会在麦克风到手后立刻释放;不上传、不留草稿
            void voice.stop("discard");
            const text = tRef.current(HOLD_HINTS[reason]);
            if (mountedRef.current) setHoldHint((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
          }} />
        {recording ? (
          <div data-testid="voice-recording" className="flex h-11 flex-1 items-center gap-2 rounded-md border px-3 text-base">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            <span className="sr-only">{t("web.chat.voice.recording")}</span>
            <span data-testid="voice-timer" className="font-mono tabular-nums">{formatClock(voice.elapsedMs)} / {formatClock(VOICE_MAX_MS)}</span>
          </div>
        ) : (
          <Textarea ref={inputRef} data-testid="chat-input" rows={1} maxLength={20000} value={input} placeholder={t("web.chat.placeholder")}
            disabled={voice.blocksTyping} className="max-h-40 min-h-11 flex-1 resize-none text-base" onChange={(e) => setInput(e.target.value)} />
        )}
        {voiceBusy && (
          <Button type="button" data-testid="chat-mic-cancel" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
            aria-label={t("web.chat.voice.cancel")} onClick={voice.cancel}>
            <XIcon className="h-5 w-5" />
          </Button>
        )}
        <Button type="button" data-testid="chat-hints" variant="ghost" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.hints.button")} disabled={!conversation || sending || voiceBusy || !!call || settling} onClick={openHints}>
          <LightbulbIcon className="h-5 w-5" />
        </Button>
        <Button type="submit" data-testid="chat-send" size="icon" className="h-11 w-11 shrink-0"
          aria-label={t("web.chat.send")} disabled={!input.trim() || sending || !conversation || voiceBusy || !!call || settling}>
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
      {/* key={id}:切换会话时面板状态整体重置;saveSettings 以已存配置为底只叠加 recap,失败时它负责 toast 并抛出 */}
      <RecapSheet key={id} open={recapOpen} onOpenChange={setRecapOpen} messages={messages}
        stored={readStoredRecap(conversation?.config.recap)} level={options.level}
        scenarioId={normalizeScenario(conversation?.config.scenario)?.id ?? null}
        onSave={(recap) => saveSettings({ recap })}
        onSpeak={(key, text) => void tts.play(key, text, config.ttsModel, config.ttsVoice)}
        speakStates={tts.states}
        extraActions={{
          expression: (text, zh) => <AddVocabularyButton testId="recap-expression-vocab" label={`${t("web.vocabulary.add")}: ${text}`} input={{ word: text, meaning: zh, source: "recap" }} />,
          poorWord: (word) => <AddVocabularyButton testId="recap-poor-word-vocab" label={`${t("web.vocabulary.add")}: ${word}`} input={{ word, source: "recap" }} />,
        }} />
      <ConversationSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} config={config} ai={ai} onSave={saveSettings} />
      {/* 通话界面渲染到 body 下并把整页设为 inert:通话期间页面不可操作(按住说话、朗读、查词都不可用) */}
      {call && conversation && realtimeConfig && (
        <RealtimeCallDialog api={api} conversationId={conversation.id} context={call.context} ownsContext={false}
          sampleRateOut={realtimeConfig.sampleRateOut} env={realtimeEnv}
          start={{ systemPrompt: effectiveSystemPrompt(config), model: config.model, temperature: config.temperature, voice: call.voice, saveRecordings: true }}
          onUserMessage={onCallUserMessage} onClose={closeCall} />
      )}
    </div>
  );
}
