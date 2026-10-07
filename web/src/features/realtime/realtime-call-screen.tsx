import { HandIcon, MicIcon, MicOffIcon, PhoneOffIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { browserCaptureEnv, getPageAudioContext, unlockAudioContext, type CaptureEnv } from "~/audio/capture";
import { scoreTone } from "~/features/chat/result-badges";
import type { CallModel } from "./call-machine";
import type { RealtimeCallOptions } from "./realtime-call";
import { useRealtimeCall } from "./use-realtime-call";

export interface RealtimeCallScreenProps {
  model: CallModel;
  /** 0..1 的电平,每帧读取(不触发重渲染)。 */
  level(): number;
  onHangup(): void;
  onMute(muted: boolean): void;
  onPushToTalk(on: boolean): void;
  onPttDown(): void;
  onPttUp(): void;
  onClose(): void;
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

const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : window.setTimeout(cb, 50);
const caf = (id: number): void =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : window.clearTimeout(id);

/** 电平条:直接写 DOM 宽度,不 setState(每帧重渲染整个界面没有必要)。 */
function LevelBar({ level }: { level(): number }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (bar.current) bar.current.style.width = `${Math.round(Math.min(1, Math.max(0, level() * 3)) * 100)}%`;
      frame = raf(tick);
    };
    frame = raf(tick);
    return () => caf(frame);
  }, [level]);
  return (
    <div data-testid="call-level" aria-hidden="true" className="h-2 w-40 overflow-hidden rounded-full bg-muted">
      <div ref={bar} className="h-full bg-primary" style={{ width: "0%" }} />
    </div>
  );
}

const isHoldKey = (key: string) => key === " " || key === "Enter";

/**
 * 通话里的"按住说话":按下即开始上行(音频是实时流出去的,所以没有聊天按钮那种上滑取消/转文字),松开即结束这句。
 * 指针按住/松开;键盘 `Space`/`Enter` 按下/抬起;失焦、指针被取消、卸载都会结束这句。
 */
function CallPttButton({ disabled, onDown, onUp }: { disabled: boolean; onDown(): void; onUp(): void }) {
  const { t } = useTranslation();
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const cb = useRef({ onDown, onUp });
  cb.current = { onDown, onUp };

  const down = () => {
    if (heldRef.current || disabled) return;
    heldRef.current = true;
    setHeld(true);
    cb.current.onDown();
  };
  const up = (render = true) => {
    if (!heldRef.current) return;
    heldRef.current = false;
    if (render) setHeld(false);
    cb.current.onUp();
  };
  const upRef = useRef(up);
  upRef.current = up;

  useEffect(() => {
    if (disabled) upRef.current();
  }, [disabled]);
  // 卸载时按住着:结束这句(不 setState)
  useEffect(() => () => upRef.current(false), []);

  return (
    <Button type="button" data-testid="call-ptt" data-held={String(held)} disabled={disabled}
      variant={held ? "destructive" : "default"}
      className="h-14 min-h-11 min-w-11 w-full select-none text-base"
      style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.preventDefault();
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 部分环境不支持 */ }
        down();
      }}
      onPointerUp={() => up()}
      onPointerCancel={() => up()}
      onLostPointerCapture={() => up()}
      onBlur={() => up()}
      onKeyDown={(e) => {
        if (!isHoldKey(e.key)) return;
        e.preventDefault();
        if (!e.repeat) down();
      }}
      onKeyUp={(e) => {
        if (!isHoldKey(e.key)) return;
        e.preventDefault();
        up();
      }}>
      <MicIcon className="mr-1 h-5 w-5" aria-hidden="true" />
      {t("web.realtime.holdToSpeak")}
    </Button>
  );
}

/** 点按切换的说话键:没有 VAD 时给读屏用户(双击无法"按住")和不便长按的人用。 */
function CallTapToTalkButton({ disabled, onDown, onUp }: { disabled: boolean; onDown(): void; onUp(): void }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const cb = useRef({ onDown, onUp });
  cb.current = { onDown, onUp };
  const set = (next: boolean, render = true) => {
    if (onRef.current === next) return;
    onRef.current = next;
    if (render) setOn(next);
    if (next) cb.current.onDown();
    else cb.current.onUp();
  };
  const setRef = useRef(set);
  setRef.current = set;
  useEffect(() => {
    if (disabled) setRef.current(false);
  }, [disabled]);
  useEffect(() => () => setRef.current(false, false), []);
  return (
    <Button type="button" data-testid="call-ptt-tap" variant={on ? "destructive" : "outline"} aria-pressed={on} disabled={disabled}
      className="min-h-11 min-w-11 w-full text-base" onClick={() => set(!onRef.current)}>
      <MicIcon className="mr-1 h-5 w-5" aria-hidden="true" />
      {on ? t("web.realtime.tapToStop") : t("web.realtime.tapToTalk")}
    </Button>
  );
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

export function RealtimeCallScreen({ model, level, onHangup, onMute, onPushToTalk, onPttDown, onPttUp, onClose }: RealtimeCallScreenProps) {
  const { t, i18n } = useTranslation();
  const ended = model.phase === "ended";
  // 服务端可能带来新错误码:没有文案的键退回通用文案,不把键名露给用户
  const text = (key: string) => (i18n.exists(key) ? t(key) : t("web.realtime.errors.generic"));

  const captionsRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = captionsRef.current;
    if (el && stick.current) el.scrollTo?.({ top: el.scrollHeight });
  }, [model.captions, model.partial]);

  // 焦点:打开时记住原焦点,关闭时归还;背后的页面 inert;通话中落在挂断键,结束后落在关闭键
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalIsolation(dialogRef);
  const hangupRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (ended ? closeRef : hangupRef).current?.focus();
  }, [ended]);

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
    if (ended) onClose();
    else onHangup();
  };

  const phaseKey = model.phase === "idle" ? "connecting" : model.phase;
  const lockedId = useId();
  // 渲染到 body 下:背后整页都是对话框的兄弟节点,才能整体设为 inert
  return createPortal(
    <div ref={dialogRef} data-testid="call-screen" role="dialog" aria-modal="true" aria-label={t("web.realtime.title")} onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <header className="flex items-center justify-between gap-2 border-b p-3">
        <span data-testid="call-status" data-phase={model.phase} role="status" className="text-base font-medium">
          {t(`web.realtime.status.${phaseKey}`)}
        </span>
        {!ended && (
          <span data-testid="call-mic-indicator" className="flex items-center gap-1 text-sm text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
            {t("web.realtime.micInUse")}
          </span>
        )}
      </header>
      <div className="flex flex-col items-center gap-2 p-3">
        {!ended && <LevelBar level={level} />}
        {model.degraded && (
          <p data-testid="call-degraded" role="status" className="text-sm text-amber-700">{t("web.realtime.degraded")}</p>
        )}
        {model.notice && (
          <p data-testid="call-notice" role="status" className="text-sm text-muted-foreground">{text(model.notice)}</p>
        )}
      </div>
      <div ref={captionsRef} data-testid="call-captions" data-lookup-context="" aria-label={t("web.realtime.captions")}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 pb-4">
        {model.captions.map((c) => (
          <div key={c.key} className={cn("flex flex-col gap-1", c.role === "user" ? "items-end" : "items-start")}>
            <p className={cn("max-w-[85%] break-words rounded-lg px-3 py-2 text-base",
              c.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              {c.text}
              {c.interrupted && <span className="ml-1 text-xs opacity-70">{t("web.realtime.interrupted")}</span>}
            </p>
            {c.role === "user" && typeof c.score === "number" && (
              <span data-testid="call-score" data-score={c.score}
                className={cn("inline-flex h-6 items-center rounded-full px-2 text-xs", scoreTone(c.score))}>
                {t("web.chat.voice.score", { score: c.score })}
              </span>
            )}
          </div>
        ))}
        {model.partial && (
          <p data-testid="call-partial" className="ml-auto max-w-[85%] break-words text-base italic text-muted-foreground">{model.partial}</p>
        )}
      </div>
      {ended ? (
        <footer className="flex flex-col items-center gap-3 border-t p-4">
          {model.error && <p data-testid="call-error" role="alert" className="text-center text-base">{text(model.error)}</p>}
          <Button ref={closeRef} type="button" data-testid="call-close" className="min-h-11 min-w-11" onClick={onClose}>
            <XIcon className="mr-1 h-4 w-4" aria-hidden="true" />{t("web.realtime.close")}
          </Button>
        </footer>
      ) : (
        <footer className="flex flex-col items-center gap-3 border-t p-4">
          {model.pushToTalk && <CallPttButton disabled={model.muted} onDown={onPttDown} onUp={onPttUp} />}
          {model.pushToTalk && model.vadUnavailable && <CallTapToTalkButton disabled={model.muted} onDown={onPttDown} onUp={onPttUp} />}
          <div className="flex items-center gap-4">
            <Button type="button" data-testid="call-mute" variant="outline" size="icon" className="min-h-11 min-w-11"
              aria-pressed={model.muted} aria-label={model.muted ? t("web.realtime.unmute") : t("web.realtime.mute")}
              onClick={() => onMute(!model.muted)}>
              {model.muted ? <MicOffIcon className="h-5 w-5" aria-hidden="true" /> : <MicIcon className="h-5 w-5" aria-hidden="true" />}
            </Button>
            <Button ref={hangupRef} type="button" data-testid="call-hangup" variant="destructive" size="icon"
              className="min-h-11 min-w-11 rounded-full" aria-label={t("web.realtime.hangup")} onClick={onHangup}>
              <PhoneOffIcon className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button type="button" data-testid="call-ptt-toggle" variant={model.pushToTalk ? "secondary" : "outline"} size="icon"
              className="min-h-11 min-w-11" aria-pressed={model.pushToTalk} aria-label={t("web.realtime.pushToTalk")}
              disabled={model.vadUnavailable} aria-describedby={model.vadUnavailable ? lockedId : undefined}
              onClick={() => onPushToTalk(!model.pushToTalk)}>
              <HandIcon className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
          {model.vadUnavailable && (
            <p id={lockedId} data-testid="call-ptt-locked" className="text-center text-sm text-muted-foreground">{t("web.realtime.pttLocked")}</p>
          )}
        </footer>
      )}
    </div>,
    document.body,
  );
}

export type RealtimeCallDialogProps = Omit<RealtimeCallOptions, "onChange"> & { onClose(): void };

/**
 * 容器:挂载即开始通话(`useRealtimeCall`)。用户挂断(按钮或 Escape)→ 直接 `onClose()`;
 * 其他原因结束(服务端关闭、超时、切后台 R16、麦克风错误……)→ 留在界面上显示原因与关闭按钮。
 * 传入页面共享上下文时用 `prepareCallAudio()` 的结果,`ownsContext` 为 false。
 */
export function RealtimeCallDialog({ onClose, ...options }: RealtimeCallDialogProps) {
  const { model, call } = useRealtimeCall(options);
  const callRef = useRef(call);
  callRef.current = call;
  const level = useCallback(() => callRef.current?.level() ?? 0, []);
  return (
    <RealtimeCallScreen model={model} level={level}
      onHangup={() => { call?.hangup(); onClose(); }}
      onMute={(m) => call?.setMuted(m)}
      onPushToTalk={(on) => call?.setPushToTalk(on)}
      onPttDown={() => call?.pttDown()}
      onPttUp={() => call?.pttUp()}
      onClose={onClose} />
  );
}
