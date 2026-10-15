import { EarIcon, LanguagesIcon, MicIcon, MicOffIcon, PhoneOffIcon, SlidersHorizontalIcon, Volume2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { browserCaptureEnv, getPageAudioContext, unlockAudioContext, type CaptureEnv } from "~/audio/capture";
import type { ApiClient } from "~/api/client";
import type { CallModel, InputMode } from "./call-machine";
import { readAutoTranslate, writeAutoTranslate } from "./call-caption-translation";
import { CallCaptions } from "./call-captions";
import { cn } from "~/lib/cn";
import { CallHoldBar, CallModeSwitch, CallPttButton, CallTapToTalkButton, DockBarButton, DockKey, MicIndicator } from "./call-dock";
import { CallHeader, CallHero, LevelBar } from "./call-hero";
import { CallTextDraft, type CallTextDraftState } from "./call-text-draft";
import type { CallEnding, RealtimeCallOptions } from "./realtime-call";
import { transcribeHeldAudio } from "./realtime-api";
import { useRealtimeCall } from "./use-realtime-call";

/** 浮动控制台 / 结束卡:玻璃 + 发丝线 + 28px 圆角,左右 16px,底部 max(12px, 安全区)。 */
const DOCK = "glass relative z-30 mx-4 mb-[max(12px,env(safe-area-inset-bottom))] flex-none rounded-dock border-[0.5px] border-hair mat-float liquid:backdrop-filter-none liquid:rounded-float liquid:mx-2";

export interface RealtimeCallScreenProps {
  model: CallModel;
  /** 0..1 的电平,每帧读取(不触发重渲染)。 */
  level(): number;
  onHangup(): void;
  onMute(muted: boolean): void;
  /** 说话方式(自动 / 按住说话,互斥) */
  onInputMode(mode: InputMode): void;
  /** 免提 / 听筒 */
  onSpeaker(on: boolean): void;
  onPttDown(): void;
  onPttUp(): void;
  /** 按住说话长条上滑到"取消"松手(或按得太短、手势被取消):撤回这一句,什么都不发给 AI */
  onPttCancel(): void;
  /**
   * 上滑到"转文字"松手:同步撤回这一句并取走按住的音频,然后转写;resolve 转写文本("" = 没听到话)。
   * 同步部分必须在 `await` 之前完成(还在松手的事件里)。
   */
  onPttToText(signal: AbortSignal): Promise<string>;
  /** 把(编辑过的)文字作为用户这一轮发出;没连上时返回 false */
  onSendText(text: string): boolean;
  onClose(): void;
  /** 通话字幕翻译(R16 复用):不传则不显示翻译入口(例如英文界面没有可译的目标语言)。 */
  translation?: { api: ApiClient; nativeLanguage: string };
  /** 对话伙伴的名字(头像首字与字幕标题);不传时用通用称呼。 */
  partnerName?: string;
}

/**
 * 打开通话界面的那次点击里**同步**调用(任何 `await` 之前,R31/iOS):取页面级共享 AudioContext 并解锁。
 * 共享上下文的所有权永远不交给通话(`ownsContext: false`),通话结束只断开自己的节点。
 * 浏览器没有 AudioContext 时返回 null(页面应提示 `web.realtime.errors.unsupported`)。
 */
export function prepareCallAudio(env: CaptureEnv = browserCaptureEnv()): { context: AudioContext; ownsContext: false } | null {
  const context = getPageAudioContext(env);
  if (!context) return null;
  unlockAudioContext(context);
  return { context, ownsContext: false };
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));

/**
 * 模态隔离:对话框打开期间,把它之外的页面(从对话框到 body 每一层的兄弟节点)设为 `inert` + `aria-hidden`,
 * 焦点若跑到外面就拉回来;关闭时先撤销,再把焦点还给打开通话的那个控件。
 */
function useModalIsolation(dialog: RefObject<HTMLElement>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = dialog.current;
    const touched: Array<{ el: Element; ariaHidden: string | null }> = [];
    for (let node: Element | null = root; node && node !== document.body; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling === node || sibling.hasAttribute("inert") || sibling.tagName === "SCRIPT") continue;
        touched.push({ el: sibling, ariaHidden: sibling.getAttribute("aria-hidden") });
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
      }
    }
    // 不支持 inert 的浏览器:焦点落到外面时拉回对话框
    const onFocusIn = (e: FocusEvent) => {
      if (!root || root.contains(e.target as Node)) return;
      (focusables(root)[0] ?? root).focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      for (const { el, ariaHidden } of touched) {
        el.removeAttribute("inert");
        if (ariaHidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", ariaHidden);
      }
      opener?.focus?.();
    };
  }, [dialog]);
}

export function RealtimeCallScreen({
  model, level, onHangup, onMute, onInputMode, onSpeaker, onPttDown, onPttUp, onPttCancel, onPttToText, onSendText, onClose, translation, partnerName,
}: RealtimeCallScreenProps) {
  const { t, i18n } = useTranslation();
  const ended = model.phase === "ended";
  // 服务端可能带来新错误码:没有文案的键退回通用文案,不把键名露给用户
  const text = (key: string) => (i18n.exists(key) ? t(key) : t("web.realtime.errors.generic"));
  const name = partnerName?.trim() || t("web.realtime.partner");

  const [autoTranslate, setAutoTranslate] = useState(readAutoTranslate);


  // 焦点:打开时记住原焦点,关闭时归还;背后的页面 inert;通话中落在挂断键,结束后落在关闭键
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalIsolation(dialogRef);
  const hangupRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (ended ? closeRef : hangupRef).current?.focus();
  }, [ended]);

  // 「更多」面板:按住说话模式下的点按说话(读屏)、免提 + 自动模式下的按住插话
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();

  // "转文字"草稿:按住说话上滑到"转文字"松手 → 转写 → 在控制台上方编辑,发送 / 丢弃
  const [draft, setDraft] = useState<CallTextDraftState | null>(null);
  const transcribing = useRef<AbortController | null>(null);
  const stopTranscribing = () => {
    transcribing.current?.abort();
    transcribing.current = null;
  };
  useEffect(() => stopTranscribing, []);
  useEffect(() => {
    if (ended) {
      stopTranscribing();
      setDraft(null);
    }
  }, [ended]);
  const startToText = () => {
    stopTranscribing();
    const ctrl = new AbortController();
    transcribing.current = ctrl;
    setDraft({ status: "transcribing", text: "" });
    onPttToText(ctrl.signal).then(
      (text) => {
        if (ctrl.signal.aborted) return;
        transcribing.current = null;
        setDraft(text.trim() ? { status: "ready", text: text.trim() } : { status: "empty", text: "" });
      },
      () => {
        if (ctrl.signal.aborted) return;
        transcribing.current = null;
        setDraft({ status: "failed", text: "" });
      },
    );
  };
  const focusHoldBar = () => dialogRef.current?.querySelector<HTMLElement>('[data-testid="call-ptt"]')?.focus();
  const discardDraft = () => {
    stopTranscribing();
    setDraft(null);
    focusHoldBar();
  };
  const sendDraft = () => {
    if (!draft || draft.status === "transcribing" || !draft.text.trim()) return;
    if (!onSendText(draft.text)) {
      setDraft({ ...draft, status: "unsent" });
      return;
    }
    setDraft(null);
    focusHoldBar();
  };

  const captionsRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // 贴底:新字幕、以及「更多」面板开合让字幕区变矮/变高时,最新一句始终留在控制台上方
  useEffect(() => {
    const el = captionsRef.current;
    if (el && stick.current) el.scrollTo?.({ top: el.scrollHeight });
  }, [model.captions, model.partial, moreOpen, ended, draft !== null]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab" && dialogRef.current) {
      // 焦点陷阱:Tab / Shift+Tab 在对话框内循环
      const items = focusables(dialogRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey ? active === first || !dialogRef.current.contains(active) : active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
      return;
    }
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    if (draft && !ended) {
      // 转文字草稿开着:Escape 先丢弃草稿,不挂断
      discardDraft();
      return;
    }
    if (moreOpen && !ended) {
      // 面板开着:Escape 先收起面板,不挂断
      setMoreOpen(false);
      moreRef.current?.focus();
      return;
    }
    if (ended) onClose();
    else onHangup();
  };

  // 按住说话模式下按住键与点按键同时在:两者互斥(一边在说时另一边禁用),否则按住键松开会结束点按开始的那句,
  // 点按键却还显示"点按结束说话"(review F2 m3)
  const [tapOn, setTapOn] = useState(false);
  const [holdOn, setHoldOn] = useState(false);
  const ptt = model.inputMode === "ptt";
  const micLive = !ptt || model.holding;
  // 按住键:按住说话模式下是控制台第二个键(取代静音);免提+自动模式下在「更多」里用来插话(机器人说话时半双工,声音打断不了)
  const holdInPanel = !ptt && model.speaker;
  // 点按键 / 面板里的按住键卸载时(收起面板、切换模式)不会再回报状态:在这里复位,免得另一个键一直被禁用
  useEffect(() => {
    if (!(ptt && moreOpen)) setTapOn(false);
  }, [ptt, moreOpen]);
  useEffect(() => {
    if (!(holdInPanel && moreOpen)) setHoldOn(false);
  }, [holdInPanel, moreOpen]);

  const toggleAutoTranslate = () => {
    const next = !autoTranslate;
    setAutoTranslate(next);
    writeAutoTranslate(next);
  };
  // 按住说话模式:静音键隐藏,按住说话是控制台整宽的长条(在按键行下面),按键少一个
  const keyCount = (translation ? 5 : 4) - (ptt ? 1 : 0);
  const basicDetection = !ended && model.vadUnavailable && !ptt;
  const notices = (model.degraded || model.notice || basicDetection) && (
    <div className="mt-2 flex flex-col items-center gap-0.5 text-meta">
      {model.degraded && <p data-testid="call-degraded" role="status" className="text-amber liquid:text-ink-2">{t("web.realtime.degraded")}</p>}
      {model.notice && <p data-testid="call-notice" role="status" className="text-ink-2">{text(model.notice)}</p>}
      {basicDetection && <p data-testid="call-basic-detection" className="text-ink-2">{t("web.realtime.basicDetection")}</p>}
    </div>
  );

  // 渲染到 body 下:背后整页都是对话框的兄弟节点,才能整体设为 inert
  return createPortal(
    <div ref={dialogRef} data-testid="call-screen" role="dialog" aria-modal="true" aria-label={t("web.realtime.title")} onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] text-ink page-bg">
      {/* 唯一的径向蓝色光晕:标记"通话中" */}
      <div aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[52%] bg-[radial-gradient(120%_80%_at_50%_0%,var(--blue-wash),transparent_70%)] liquid:hidden" />
      <CallHeader phase={model.phase} />
      <CallHero name={name} phase={model.phase}
        subtitle={ended ? undefined : <MicIndicator live={micLive} />}
        level={ended ? undefined : <LevelBar level={level} />}>
        {notices}
      </CallHero>
      <CallCaptions ref={captionsRef} captions={model.captions} partial={model.partial} partnerName={name} live={!ended}
        translation={translation} autoTranslate={autoTranslate}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }} />
      {ended ? (
        <div data-testid="call-end" className={cn(DOCK, "flex flex-col items-center gap-3 p-4")}>
          {model.error && <p data-testid="call-error" role="alert" className="text-center text-body text-ink">{text(model.error)}</p>}
          <button ref={closeRef} type="button" data-testid="call-close"
            className="inline-flex min-h-11 min-w-11 w-full items-center justify-center gap-1.5 rounded-button bg-blue px-4 text-body font-semibold text-on-blue liquid:rounded-full liquid:shadow-accent transition-opacity duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:opacity-80"
            onClick={onClose}>
            <XIcon className="h-4 w-4" aria-hidden="true" />{t("web.realtime.close")}
          </button>
        </div>
      ) : (
        <>
          {draft && <CallTextDraft draft={draft} onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))} onSend={sendDraft} onDiscard={discardDraft} />}
          {moreOpen && (
            <div id={moreId} data-testid="call-more-panel" role="group" aria-label={t("web.realtime.more")}
              className="relative z-30 mx-4 mb-2 flex flex-none flex-col gap-2 rounded-card border-[0.5px] border-hair bg-surface p-2 shadow-card mat-float liquid:rounded-tile liquid:mx-2">
              {holdInPanel && (
                <CallPttButton disabled={model.muted || tapOn} onDown={onPttDown} onUp={onPttUp} onHeldChange={setHoldOn}
                  label={t("web.realtime.holdToInterrupt")} />
              )}
              {ptt && <CallTapToTalkButton disabled={model.muted || holdOn} onDown={onPttDown} onUp={onPttUp} onToggle={setTapOn} />}
              {ptt && model.muted && (
                // 按住说话模式隐藏了静音键:之前静音过的话在这里取消,否则按住说话键一直不可用
                <DockBarButton data-testid="call-mute" aria-pressed={true} aria-label={t("web.realtime.unmute")} onClick={() => onMute(false)}>
                  <MicOffIcon aria-hidden="true" />{t("web.realtime.unmute")}
                </DockBarButton>
              )}
              {!ptt && !model.speaker && <p className="px-2 py-1.5 text-center text-sub text-ink-2">{t("web.realtime.moreHint")}</p>}
            </div>
          )}
          <div data-testid="call-dock" className={cn(DOCK, "px-2.5 pb-[9px] pt-2")}>
            <div className="flex h-8 items-center justify-center">
              <CallModeSwitch value={model.inputMode} onChange={onInputMode} />
            </div>
            <div className="mt-1 grid items-start gap-1.5" style={{ gridTemplateColumns: `repeat(${keyCount}, minmax(0, 1fr))` }}>
              <DockKey data-testid="call-speaker" tone={model.speaker ? "on" : "off"} aria-pressed={model.speaker} aria-label={t("web.realtime.speakerToggle")}
                icon={model.speaker ? <Volume2Icon /> : <EarIcon />}
                label={model.speaker ? t("web.realtime.speaker") : t("web.realtime.earpiece")}
                onClick={() => onSpeaker(!model.speaker)} />
              {!ptt && (
                <DockKey data-testid="call-mute" tone={model.muted ? "on" : "off"} aria-pressed={model.muted}
                  aria-label={model.muted ? t("web.realtime.unmute") : t("web.realtime.mute")}
                  icon={model.muted ? <MicOffIcon /> : <MicIcon />} label={t("web.realtime.muteShort")}
                  onClick={() => onMute(!model.muted)} />
              )}
              {translation && (
                <DockKey data-testid="call-auto-translate" tone={autoTranslate ? "on" : "off"} aria-pressed={autoTranslate}
                  aria-label={t("web.realtime.autoTranslate")} icon={<LanguagesIcon />} label={t("web.realtime.translate")}
                  onClick={toggleAutoTranslate} />
              )}
              <DockKey ref={moreRef} data-testid="call-more" tone={moreOpen ? "on" : "off"} aria-expanded={moreOpen}
                aria-controls={moreOpen ? moreId : undefined}
                icon={<SlidersHorizontalIcon />} label={t("web.realtime.more")}
                onClick={() => setMoreOpen((v) => !v)} />
              <DockKey ref={hangupRef} data-testid="call-hangup" tone="end" aria-label={t("web.realtime.hangup")}
                icon={<PhoneOffIcon />} label={t("web.realtime.hangup")} onClick={onHangup} />
            </div>
            {ptt && (
              <div className="mt-2 flex px-0.5">
                <CallHoldBar disabled={model.muted || tapOn} label={t("web.realtime.holdToSpeak")}
                  onDown={onPttDown} onSend={onPttUp} onCancel={onPttCancel} onToText={startToText}
                  onStateChange={(state) => setHoldOn(state !== "idle")} />
              </div>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

export type RealtimeCallDialogProps = Omit<RealtimeCallOptions, "onChange"> & {
  /** 关闭对话框。`ending`:挂断后仍在等服务端关闭的套接字(页面等它关闭再重新加载,并负责在切换/卸载时 drop);还没开始通话时为 null。 */
  onClose(ending: CallEnding | null): void;
  /** 母语代码;不传(英文界面)则通话里不提供翻译。 */
  nativeLanguage?: string;
  /** 对话伙伴的名字(通话头像与字幕标题);不传时用通用称呼。 */
  partnerName?: string;
};

/**
 * 容器:挂载即开始通话(`useRealtimeCall`)。用户挂断(按钮或 Escape)→ 直接 `onClose(ending)`;
 * 其他原因结束(服务端关闭、超时、切后台 R16、麦克风错误……)→ 留在界面上显示原因与关闭按钮。
 * 传入页面共享上下文时用 `prepareCallAudio()` 的结果,`ownsContext` 为 false。
 */
export function RealtimeCallDialog({ onClose, nativeLanguage, partnerName, ...options }: RealtimeCallDialogProps) {
  const { model, call, handOff } = useRealtimeCall(options);
  const callRef = useRef(call);
  callRef.current = call;
  const level = useCallback(() => callRef.current?.level() ?? 0, []);
  return (
    <RealtimeCallScreen model={model} level={level} partnerName={partnerName}
      onHangup={() => { call?.hangup(); onClose(handOff()); }}
      onMute={(m) => call?.setMuted(m)}
      onInputMode={(mode) => call?.setInputMode(mode)}
      onSpeaker={(on) => call?.setSpeaker(on)}
      onPttDown={() => call?.pttDown()}
      onPttUp={() => call?.pttUp()}
      onPttCancel={() => call?.pttCancel()}
      onPttToText={async (signal) => {
        // 同步:撤回这一句并取走音频(还在松手的事件里);随后转写(与聊天语音消息同一个接口)
        const audio = call?.pttToText();
        return audio ? transcribeHeldAudio(options.api, audio, signal) : "";
      }}
      onSendText={(text) => call?.sendUserText(text) ?? false}
      onClose={() => onClose(handOff())}
      translation={nativeLanguage ? { api: options.api, nativeLanguage } : undefined} />
  );
}
