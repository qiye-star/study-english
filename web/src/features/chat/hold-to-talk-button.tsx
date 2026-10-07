import { LoaderIcon, MicIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
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
}

export function HoldToTalkButton({ voiceState, disabled, onStart, onFinish, onDiscard, onRelease }: HoldToTalkButtonProps) {
  const { t } = useTranslation();
  const { model, dispatch } = useHoldToTalk({ start: onStart, finish: onFinish, discard: onDiscard });
  const holding = model.state === "recording" || model.state === "armed-cancel" || model.state === "armed-text";

  // 录音被外部结束(切后台保留草稿、轨道中断、60 s 自动停止):手势归位
  useEffect(() => {
    if (voiceState !== "recording" && voiceState !== "starting" && model.micReady && model.state !== "idle") dispatch({ type: "reset" });
  }, [voiceState, model.micReady, model.state, dispatch]);

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
  return (
    <>
      <Button type="button" data-testid="chat-mic" data-hold-to-talk="" data-state={voiceState} data-hold={model.state}
        size="icon" variant={holding || model.state === "keyboard" ? "destructive" : "ghost"}
        className="h-11 w-11 shrink-0 select-none" style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        disabled={disabled && model.state === "idle"}
        aria-label={model.state === "keyboard" ? t("web.chat.hold.keyboardStop") : voiceState === "processing" ? t("web.chat.transcribing") : t("web.chat.hold.label")}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || e.button > 0) return;
          e.preventDefault();
          if (model.state !== "idle") return; // 已经在按住(或键盘录音):别的手指不算
          pointer.current = e.pointerId;
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
        {voiceState === "processing" ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <MicIcon className="h-5 w-5" />}
      </Button>
      <span data-testid="hold-status" role="status" className="sr-only">{announcement}</span>
      {holding && (
        <div data-testid="hold-overlay" aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-2 px-4">
          <span className="rounded-full bg-black/70 px-3 py-1 text-sm text-white">{t("web.chat.hold.slideHint")}</span>
          <div className="flex w-full gap-2">
            <div data-testid="hold-zone-cancel" data-active={String(model.state === "armed-cancel")}
              className={cn("flex min-h-[88px] flex-1 items-center justify-center rounded-lg border-2 text-base",
                model.state === "armed-cancel" ? "border-red-600 bg-red-600 text-white" : "border-muted bg-background/90")}>
              {t("web.chat.hold.cancel")}
            </div>
            <div data-testid="hold-zone-text" data-active={String(model.state === "armed-text")}
              className={cn("flex min-h-[88px] flex-1 items-center justify-center rounded-lg border-2 text-base",
                model.state === "armed-text" ? "border-primary bg-primary text-primary-foreground" : "border-muted bg-background/90")}>
              {t("web.chat.hold.toText")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
