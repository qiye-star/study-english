import { LoaderIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { DiscardReason } from "./hold-to-talk";
import { useHoldToTalk } from "./use-hold-to-talk";
import type { VoiceTurnState } from "./use-voice-turn";

export interface HoldToTalkButtonProps {
  voiceState: VoiceTurnState;
  disabled: boolean;
  onStart(): Promise<boolean>;
  onFinish(deliver: "send" | "fill"): void;
  onDiscard(reason: DiscardReason): void;
  /** 松手/第二次按键的同步阶段调用(iOS:autoSpeak.prime()) */
  onRelease(): void;
  /** 录音中在浮层卡片里显示的状态(计时器) */
  recordingStatus?: ReactNode;
}

/** 浮层卡片里的音量/脉动示意(没有真实电平:CSS 动画,只表示"正在录") */
function PulseBars() {
  return (
    <div className="flex h-8 items-center gap-1" aria-hidden="true">
      {[0.5, 0.9, 1, 0.7, 0.45].map((h, i) => (
        <span key={i} className="w-1.5 animate-pulse rounded-full bg-current"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 150}ms`, animationDuration: "900ms" }} />
      ))}
    </div>
  );
}

/**
 * 仿微信的"按住 说话"长条(R11 的手势语义不变):按下开始,松手发送;上滑进入落点——左半取消、右半转文字;
 * 键盘 Space/Enter 第一次开始、第二次发送,Escape 取消。按住期间显示居中的浮层与左右两个落点。
 */
export function HoldToTalkButton({ voiceState, disabled, onStart, onFinish, onDiscard, onRelease, recordingStatus }: HoldToTalkButtonProps) {
  const { t } = useTranslation();
  const { model, dispatch } = useHoldToTalk({ start: onStart, finish: onFinish, discard: onDiscard });
  const holding = model.state === "recording" || model.state === "armed-cancel" || model.state === "armed-text";
  const keyboard = model.state === "keyboard";

  // 录音被外部结束(切后台保留草稿、轨道中断、60 s 自动停止):手势归位
  useEffect(() => {
    if (voiceState !== "recording" && voiceState !== "starting" && model.micReady && model.state !== "idle") dispatch({ type: "reset" });
  }, [voiceState, model.micReady, model.state, dispatch]);

  // 落点放在长条上方(长条之下可能还有底部导航):按下时记下长条顶边到视口底部的距离
  const [zonesBottom, setZonesBottom] = useState(144);
  const now = () => performance.now();
  // 只认按下时捕获的那根手指:第二根手指落在按钮上不能移动或结束这次按住
  const pointer = useRef<number | null>(null);
  const mine = (e: { pointerId: number }) => pointer.current === null || e.pointerId === pointer.current;
  useEffect(() => {
    if (model.state === "idle" || model.state === "keyboard") pointer.current = null;
  }, [model.state]);

  // 读屏播报:live region 始终挂载,内容随状态/上滑区域变化
  const announcement =
    model.state === "armed-cancel" ? t("web.chat.hold.releaseToCancel")
      : model.state === "armed-text" ? t("web.chat.hold.releaseToText")
        : model.state === "recording" ? t("web.chat.hold.slideHint")
          : "";
  const pressed = holding || keyboard || model.state === "pressing";
  const processing = voiceState === "processing";
  const label = processing ? t("web.chat.transcribing")
    : model.state === "armed-cancel" ? t("web.chat.hold.releaseToCancel")
      : model.state === "armed-text" ? t("web.chat.hold.releaseToText")
        : pressed ? t("web.chat.hold.barPressed") : t("web.chat.hold.bar");
  const overlayHint = keyboard ? t("web.chat.hold.keyboardStop")
    : model.state === "armed-cancel" ? t("web.chat.hold.overlayCancel")
      : model.state === "armed-text" ? t("web.chat.hold.overlayText")
        : t("web.chat.hold.overlaySlide");
  const cancelArmed = model.state === "armed-cancel";
  const textArmed = model.state === "armed-text";
  return (
    <>
      <button type="button" data-testid="chat-mic" data-hold-to-talk="" data-state={voiceState} data-hold={model.state}
        className={cn(
          "inline-flex h-11 min-w-0 flex-1 select-none items-center justify-center gap-2 rounded-md border px-3 text-base font-medium",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          pressed ? (cancelArmed ? "border-red-600 bg-red-600 text-white" : "border-primary/40 bg-muted text-foreground")
            : "border-input bg-background text-foreground hover:bg-accent",
        )}
        style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        disabled={disabled && model.state === "idle"}
        aria-label={keyboard ? t("web.chat.hold.keyboardStop") : processing ? t("web.chat.transcribing") : t("web.chat.hold.label")}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || e.button > 0) return;
          e.preventDefault();
          if (model.state !== "idle") return; // 已经在按住(或键盘录音):别的手指不算
          pointer.current = e.pointerId;
          setZonesBottom(Math.max(0, window.innerHeight - e.currentTarget.getBoundingClientRect().top) + 16);
          try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 部分环境不支持 */ }
          dispatch({ type: "down", x: e.clientX ?? 0, y: e.clientY ?? 0, t: now(), width: window.innerWidth });
        }}
        onPointerMove={(e) => { if (mine(e)) dispatch({ type: "move", x: e.clientX ?? 0, y: e.clientY ?? 0 }); }}
        onPointerUp={(e) => {
          if (model.state === "idle" || model.state === "keyboard" || !mine(e)) return;
          onRelease();
          dispatch({ type: "up", t: now() });
        }}
        onPointerCancel={(e) => { if (mine(e)) dispatch({ type: "cancel" }); }}
        onLostPointerCapture={(e) => { if (model.state !== "idle" && model.state !== "keyboard" && mine(e)) dispatch({ type: "cancel" }); }}
        onBlur={() => {
          // 键盘录音时焦点移到别处(Tab 走开):丢弃,不让麦克风开着等 60 秒。
          // 整个窗口失焦(权限弹窗、切换应用)不算:那时 document.hasFocus() 为 false
          if (model.state === "keyboard" && document.hasFocus()) dispatch({ type: "cancel" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { dispatch({ type: "escape" }); return; }
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            if (disabled && model.state === "idle") return;
            if (model.state === "keyboard") onRelease();
            dispatch({ type: "key" });
          }
        }}>
        {processing && <LoaderIcon className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </button>
      <span data-testid="hold-status" role="status" className="sr-only">{announcement}</span>
      {(holding || keyboard) && (
        <div data-testid="hold-overlay" className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/20 px-4 pb-24">
          <div className={cn("flex w-44 flex-col items-center gap-2 rounded-2xl px-4 py-4 text-white shadow-lg ring-1 ring-white/15",
            cancelArmed ? "bg-red-600/95" : "bg-neutral-900/85")}>
            <PulseBars />
            {recordingStatus}
            <p data-testid="hold-overlay-hint" data-tone={cancelArmed ? "danger" : "normal"} aria-hidden="true"
              className={cn("text-center text-sm leading-snug", cancelArmed ? "font-semibold text-white" : "text-white/90")}>
              {overlayHint}
            </p>
          </div>
          {holding && (
            <div aria-hidden="true" className="absolute inset-x-0 flex justify-between px-8" style={{ bottom: zonesBottom }}>
              <div data-testid="hold-zone-cancel" data-active={String(cancelArmed)} className="flex flex-col items-center gap-1">
                <span className={cn("flex h-16 w-16 items-center justify-center rounded-full border-2 shadow transition-transform",
                  cancelArmed ? "scale-110 border-red-600 bg-red-600 text-white" : "border-border bg-background/95 text-foreground")}>
                  <XIcon className="h-7 w-7" />
                </span>
                <span className="rounded bg-background/90 px-1.5 text-xs text-foreground">{t("web.chat.hold.cancel")}</span>
              </div>
              <div data-testid="hold-zone-text" data-active={String(textArmed)} className="flex flex-col items-center gap-1">
                <span className={cn("flex h-16 w-16 items-center justify-center rounded-full border-2 text-2xl font-semibold shadow transition-transform",
                  textArmed ? "scale-110 border-primary bg-primary text-primary-foreground" : "border-border bg-background/95 text-foreground")}>
                  文
                </span>
                <span className="rounded bg-background/90 px-1.5 text-xs text-foreground">{t("web.chat.hold.toText")}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
