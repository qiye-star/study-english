import { LoaderIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import type { DiscardReason, HoldState } from "~/lib/hold-gesture";
import { useHoldGesture } from "./use-hold-gesture";

export interface HoldToTalkBarProps {
  /** 按钮的 data-testid(聊天 `chat-mic`、通话 `call-ptt`) */
  testId: string;
  /** 额外的 data-* 属性(例如聊天的 `data-state`) */
  data?: Record<`data-${string}`, string>;
  /** neutral = 聊天的 surface 长条;blue = 通话按住说话键(设计稿 v3:静止 blue-tint、按下 blue 实底) */
  tone?: "neutral" | "blue";
  disabled: boolean;
  /**
   * 底层录音仍在进行。手势已拿到麦克风(micReady)而它变为 false(切后台保留草稿、轨道中断、静音、自动停止):手势归位。
   */
  live: boolean;
  /** 正在处理(转写):长条显示转圈与 busyLabel */
  busy?: boolean;
  busyLabel?: string;
  /** 静止时的文字(默认 "按住 说话") */
  idleLabel?: string;
  maxHoldMs: number;
  /** 是否提供「转文字」落点(默认 true)。false = 只收语音(晋级赛):只有取消落点,上滑到任意一侧都是取消,永远不会 `onFinish("fill")` */
  allowToText?: boolean;
  onStart(): Promise<boolean>;
  onFinish(deliver: "send" | "fill"): void;
  onDiscard(reason: DiscardReason): void;
  /** 松手/第二次按键的同步阶段调用(iOS:在手势里解锁/预热播放) */
  onRelease(): void;
  /** 手势状态变化(通话据此让点按说话键与按住键互斥) */
  onStateChange?(state: HoldState): void;
  /** 录音中在浮层卡片里显示的状态(计时器) */
  recordingStatus?: ReactNode;
  /** 按钮内额外的装饰(通话:按下时的 3px 外环) */
  adornment?(pressed: boolean): ReactNode;
}

/** 浮层卡片里的音量/脉动示意(没有真实电平:CSS 动画,只表示"正在录") */
function PulseBars() {
  return (
    <div className="flex h-8 items-center gap-1" aria-hidden="true">
      {[0.5, 0.9, 1, 0.7, 0.45].map((h, i) => (
        <span key={i} className="w-1.5 rounded-full bg-current motion-safe:animate-pulse"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 150}ms`, animationDuration: "900ms" }} />
      ))}
    </div>
  );
}

/** 进入落点时的轻触觉(支持 Vibration API 的设备;iOS Safari 没有,静默跳过) */
function tick() {
  try {
    navigator.vibrate?.(10);
  } catch {
    /* 部分环境禁止 */
  }
}

/**
 * 仿微信的"按住 说话"长条(R11 的手势语义):按下开始,松手发送;上滑进入落点——左半取消、右半转文字;
 * 键盘 Space/Enter 第一次开始、第二次发送,Escape 取消。按住期间显示居中的浮层与左右两个落点。
 * 聊天(`features/chat/hold-to-talk-button.tsx`)与通话(`features/realtime/call-dock.tsx`)共用。
 */
export function HoldToTalkBar({
  testId, data, tone = "neutral", disabled, live, busy = false, busyLabel, idleLabel, maxHoldMs, allowToText = true,
  onStart, onFinish, onDiscard, onRelease, onStateChange, recordingStatus, adornment,
}: HoldToTalkBarProps) {
  const { t } = useTranslation();
  const { model, dispatch } = useHoldGesture({ start: onStart, finish: onFinish, discard: onDiscard, maxHoldMs });
  const holding = model.state === "recording" || model.state === "armed-cancel" || model.state === "armed-text";
  const keyboard = model.state === "keyboard";

  // 录音被外部结束:手势归位
  useEffect(() => {
    if (!live && model.micReady && model.state !== "idle") dispatch({ type: "reset" });
  }, [live, model.micReady, model.state, dispatch]);

  const stateChange = useRef(onStateChange);
  stateChange.current = onStateChange;
  const lastState = useRef<HoldState>("idle");
  useEffect(() => {
    const prev = lastState.current;
    lastState.current = model.state;
    if (prev === model.state) return;
    stateChange.current?.(model.state);
    if (model.state === "armed-cancel" || model.state === "armed-text") tick();
  }, [model.state]);

  // 落点放在长条上方(长条之下可能还有底部导航/控制台按键):按下时记下长条顶边到视口底部的距离
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
    model.state === "armed-cancel" ? t("web.hold.releaseToCancel")
      : model.state === "armed-text" ? t("web.hold.releaseToText")
        : model.state === "recording" ? t(allowToText ? "web.hold.slideHint" : "web.hold.slideHintCancel")
          : "";
  const pressed = holding || keyboard || model.state === "pressing";
  const label = busy ? busyLabel
    : model.state === "armed-cancel" ? t("web.hold.releaseToCancel")
      : model.state === "armed-text" ? t("web.hold.releaseToText")
        : pressed ? t("web.hold.barPressed") : idleLabel ?? t("web.hold.bar");
  const overlayHint = keyboard ? t("web.hold.keyboardStop")
    : model.state === "armed-cancel" ? t("web.hold.overlayCancel")
      : model.state === "armed-text" ? t("web.hold.overlayText")
        : t("web.hold.overlaySlide");
  const cancelArmed = model.state === "armed-cancel";
  const textArmed = model.state === "armed-text";
  const rest = tone === "blue"
    ? "border-transparent bg-blue-tint text-blue hover:bg-blue-tint plate liquid:text-ink"
    : "border-hair bg-surface text-ink shadow-[0_1px_2px_rgba(17,19,24,0.04)] hover:bg-surface-2 plate liquid:border-transparent";
  const down = tone === "blue" ? "border-transparent bg-blue text-on-blue" : "border-blue/40 bg-blue-tint text-blue";
  return (
    <>
      <button type="button" data-testid={testId} data-hold-to-talk="" data-hold={model.state} {...data}
        className={cn(
          // 设计稿 .holdbar:44 高、圆角 12、0.5px 发丝线、15px 600 字重
          "relative inline-flex h-11 min-h-11 min-w-0 flex-1 select-none items-center justify-center gap-2 rounded-button border-[0.5px] px-3 text-body font-semibold tracking-[0.02em] liquid:rounded-full",
          "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          pressed ? (cancelArmed ? "border-transparent bg-red-solid text-white" : down) : rest,
        )}
        style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        disabled={disabled && model.state === "idle"}
        aria-label={keyboard ? t("web.hold.keyboardStop") : busy ? busyLabel : t("web.hold.label")}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || e.button > 0) return;
          e.preventDefault();
          if (model.state !== "idle") return; // 已经在按住(或键盘录音):别的手指不算
          pointer.current = e.pointerId;
          setZonesBottom(Math.max(0, window.innerHeight - e.currentTarget.getBoundingClientRect().top) + 16);
          try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 部分环境不支持 */ }
          dispatch({ type: "down", x: e.clientX ?? 0, y: e.clientY ?? 0, t: now(), width: window.innerWidth, allowToText });
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
          // 键盘录音时焦点移到别处(Tab 走开):丢弃,不让麦克风开着等到上限。
          // 整个窗口失焦(权限弹窗、切换应用)不算:那时 document.hasFocus() 为 false
          if (model.state === "keyboard" && document.hasFocus()) dispatch({ type: "cancel" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // 录音中的 Escape 只取消这一句(不让外层对话框把它当成"关闭/挂断")
            if (model.state !== "idle") e.preventDefault();
            dispatch({ type: "escape" });
            return;
          }
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            if (disabled && model.state === "idle") return;
            if (model.state === "keyboard") onRelease();
            dispatch({ type: "key" });
          }
        }}>
        {busy && <LoaderIcon className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
        <span className="truncate">{label}</span>
        {adornment?.(pressed)}
      </button>
      <span data-testid="hold-status" role="status" className="sr-only">{announcement}</span>
      {(holding || keyboard) && (
        <div data-testid="hold-overlay" className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-[rgba(17,19,24,0.28)] px-4 pb-24">
          {/* 浮层卡片不模糊(输入条、底栏、顶栏已占三层玻璃);状态切换只动颜色,150ms */}
          <div className={cn("flex w-44 flex-col items-center gap-2 rounded-sheet px-4 py-4 text-white shadow-[0_12px_32px_-12px_rgba(17,19,24,0.5)] transition-colors duration-fast",
            cancelArmed ? "bg-red-solid" : "bg-[rgba(17,19,24,0.88)] dark:bg-[rgba(30,33,39,0.96)]")}>
            <PulseBars />
            {recordingStatus}
            <p data-testid="hold-overlay-hint" data-tone={cancelArmed ? "danger" : "normal"} aria-hidden="true"
              className={cn("text-center text-sub leading-snug", cancelArmed ? "font-semibold text-white" : "text-white/90")}>
              {overlayHint}
            </p>
          </div>
          {holding && (
            <div aria-hidden="true" className={cn("absolute inset-x-0 flex px-8", allowToText ? "justify-between" : "justify-center")} style={{ bottom: zonesBottom }}>
              <div data-testid="hold-zone-cancel" data-active={String(cancelArmed)} className="flex flex-col items-center gap-1.5">
                <span className={cn("flex h-16 w-16 items-center justify-center rounded-full border-[0.5px] transition-[transform,background-color] duration-fast motion-reduce:transition-none",
                  cancelArmed ? "scale-110 border-transparent bg-red-solid text-white" : "border-hair bg-surface text-ink shadow-card")}>
                  <XIcon className="h-7 w-7" />
                </span>
                <span className="rounded-inline bg-surface px-1.5 text-meta font-medium text-ink">{t("web.hold.cancel")}</span>
              </div>
              {allowToText && <div data-testid="hold-zone-text" data-active={String(textArmed)} className="flex flex-col items-center gap-1.5">
                <span className={cn("flex h-16 w-16 items-center justify-center rounded-full border-[0.5px] text-headline font-semibold transition-[transform,background-color] duration-fast motion-reduce:transition-none",
                  textArmed ? "scale-110 border-transparent bg-blue text-on-blue" : "border-hair bg-surface text-ink shadow-card")}>
                  文
                </span>
                <span className="rounded-inline bg-surface px-1.5 text-meta font-medium text-ink">{t("web.hold.toText")}</span>
              </div>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
