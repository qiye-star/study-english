import { MicIcon } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { InputMode } from "./call-machine";
import { cx } from "./call-cx";

/**
 * 控制台按键:52px 圆键 + 11px 标签,整列是一个按钮(命中区 ≥ 44)。
 * tone:off = 未激活(--key 底 + 发丝线)、on = 激活(蓝底)、end = 挂断(红底白字)、
 * ptt = 按住说话(静止蓝色底色;pressed 蓝色实底 + 3px 外环,外环只在允许动效时扩散)。
 */
export type DockKeyTone = "off" | "on" | "end" | "ptt";

const KEY_BUTTON = "group flex min-h-11 min-w-11 select-none flex-col items-center gap-1 text-label font-medium leading-[1.2] tracking-[.01em] focus-visible:outline-none disabled:opacity-50";
const KEY_CIRCLE = "relative flex h-key w-key items-center justify-center rounded-full border-[0.5px] transition-colors duration-fast ease-standard group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background [&>svg]:h-6 [&>svg]:w-6";

export function dockKeyClasses(tone: DockKeyTone, pressed = false): { button: string; circle: string } {
  switch (tone) {
    case "on":
      return { button: cx(KEY_BUTTON, "font-semibold text-blue"), circle: cx(KEY_CIRCLE, "border-transparent bg-blue text-on-blue") };
    case "end":
      return { button: cx(KEY_BUTTON, "text-red"), circle: cx(KEY_CIRCLE, "border-transparent bg-red-solid text-white") };
    case "ptt":
      return {
        button: cx(KEY_BUTTON, "font-semibold text-blue"),
        circle: cx(KEY_CIRCLE, "border-transparent", pressed ? "bg-blue text-on-blue" : "bg-blue-tint text-blue"),
      };
    default:
      return { button: cx(KEY_BUTTON, "text-ink-2"), circle: cx(KEY_CIRCLE, "border-hair bg-key text-ink") };
  }
}

/** 按住说话键按下时的 3px 蓝色外环(放在圆键里) */
export function PttRing() {
  return (
    <span aria-hidden="true"
      className="pointer-events-none absolute -inset-[3px] rounded-full border-[3px] border-blue opacity-45 motion-safe:animate-ptt-ring" />
  );
}

export type DockKeyProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  tone: DockKeyTone;
  icon: ReactNode;
  label: ReactNode;
};

export const DockKey = forwardRef<HTMLButtonElement, DockKeyProps>(function DockKey({ tone, icon, label, className, type = "button", ...rest }, ref) {
  const c = dockKeyClasses(tone);
  return (
    <button ref={ref} type={type} className={cx(c.button, className)} {...rest}>
      <span className={c.circle} aria-hidden="true">{icon}</span>
      <span aria-hidden={rest["aria-label"] ? true : undefined}>{label}</span>
    </button>
  );
});

/**
 * 控制台顶部的分段切换:自动 / 按住说话(互斥)。保持 `role="group"` + `aria-pressed` 按钮的语义;
 * 视觉是 32px 的胶囊(轨道 seg-track,dark 6% 白),命中区是 44px 的整个按钮。
 */
export function CallModeSwitch({ value, onChange }: { value: InputMode; onChange(mode: InputMode): void }) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div data-testid="call-input-mode" role="group" aria-labelledby={labelId}
      className="inline-flex items-center gap-0.5 rounded-badge bg-seg-track p-[3px]">
      <span id={labelId} className="sr-only">{t("web.realtime.inputMode")}</span>
      {(["auto", "ptt"] as const).map((mode) => {
        const on = value === mode;
        return (
          <button key={mode} type="button" data-testid={`call-mode-${mode}`} aria-pressed={on}
            className="group -my-1.5 flex min-h-11 min-w-11 items-center justify-center focus-visible:outline-none"
            onClick={() => { if (!on) onChange(mode); }}>
            <span className={cx(
              "inline-flex h-8 min-w-[72px] items-center justify-center rounded-lg border-[0.5px] px-3 text-sub transition-colors duration-fast ease-standard",
              "group-focus-visible:ring-2 group-focus-visible:ring-ring",
              on ? "border-hair-2 bg-seg-on font-semibold text-ink shadow-seg" : "border-transparent bg-transparent font-medium text-ink-2",
            )}>
              {mode === "auto" ? t("web.realtime.modeAuto") : t("web.realtime.modeHold")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const isHoldKey = (key: string) => key === " " || key === "Enter";

/** 更多面板里的整行按钮(44px,对应设计稿的 holdbar) */
const BAR = "flex min-h-11 min-w-11 w-full select-none items-center justify-center gap-1.5 rounded-button border-[0.5px] text-body font-semibold tracking-[.02em] transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&>svg]:h-5 [&>svg]:w-5";
const barTone = (active: boolean) =>
  active ? "border-transparent bg-blue text-on-blue" : "border-hair bg-surface text-ink shadow-[0_1px_2px_rgba(17,19,24,.04)]";

/**
 * 通话里的"按住说话":按下即开始(音频是实时流出去的,所以没有聊天按钮那种上滑取消/转文字),松开即结束这句;
 * 按得太短(不足 MIN_HOLD_MS)由通话丢弃。免提时它也是"按住插话"(机器人说话时声音打断不了)。
 * 指针按住/松开;键盘 `Space`/`Enter` 按下/抬起;失焦、指针被取消、卸载都会结束这句。
 * variant:`key` = 控制台第二个键(按住说话模式);`bar` = 更多面板里的整行(免提 + 自动模式下的按住插话)。
 */
export function CallPttButton({ disabled, label, variant, onDown, onUp, onHeldChange }: {
  disabled: boolean;
  label: string;
  variant: "key" | "bar";
  onDown(): void;
  onUp(): void;
  onHeldChange?(held: boolean): void;
}) {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const cb = useRef({ onDown, onUp, onHeldChange });
  cb.current = { onDown, onUp, onHeldChange };

  const down = () => {
    if (heldRef.current || disabled) return;
    heldRef.current = true;
    setHeld(true);
    cb.current.onHeldChange?.(true);
    cb.current.onDown();
  };
  const up = (render = true) => {
    if (!heldRef.current) return;
    heldRef.current = false;
    if (render) {
      setHeld(false);
      cb.current.onHeldChange?.(false);
    }
    cb.current.onUp();
  };
  const upRef = useRef(up);
  upRef.current = up;

  useEffect(() => {
    if (disabled) upRef.current();
  }, [disabled]);
  // 卸载时按住着:结束这句(不 setState)
  useEffect(() => () => upRef.current(false), []);

  const key = dockKeyClasses("ptt", held);
  return (
    <button type="button" data-testid="call-ptt" data-held={String(held)} disabled={disabled}
      className={variant === "key" ? key.button : cx(BAR, barTone(held))}
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
      {variant === "key" ? (
        <>
          <span className={key.circle} aria-hidden="true">
            <MicIcon />
            {held && <PttRing />}
          </span>
          <span>{label}</span>
        </>
      ) : (
        <>
          <MicIcon aria-hidden="true" />
          {label}
        </>
      )}
    </button>
  );
}

/** 点按切换的说话键:按住说话模式下给读屏用户(双击无法"按住")和不便长按的人用。 */
export function CallTapToTalkButton({ disabled, onDown, onUp, onToggle }: { disabled: boolean; onDown(): void; onUp(): void; onToggle?(on: boolean): void }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const cb = useRef({ onDown, onUp, onToggle });
  cb.current = { onDown, onUp, onToggle };
  const set = (next: boolean, render = true) => {
    if (onRef.current === next) return;
    onRef.current = next;
    if (render) {
      setOn(next);
      cb.current.onToggle?.(next);
    }
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
    <button type="button" data-testid="call-ptt-tap" aria-pressed={on} disabled={disabled}
      className={cx(BAR, barTone(on))} onClick={() => set(!onRef.current)}>
      <MicIcon aria-hidden="true" />
      {on ? t("web.realtime.tapToStop") : t("web.realtime.tapToTalk")}
    </button>
  );
}

/** 更多面板里的普通整行按钮(例如按住说话模式下的"取消静音") */
export const DockBarButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>(
  function DockBarButton({ active = false, className, type = "button", ...rest }, ref) {
    return <button ref={ref} type={type} className={cx(BAR, barTone(active), className)} {...rest} />;
  },
);

/** 麦克风指示:按住说话模式下按住之外不采集,如实显示"已关闭"。蓝点 = 用户的麦克风在采集。 */
export function MicIndicator({ live }: { live: boolean }) {
  const { t } = useTranslation();
  return (
    <span data-testid="call-mic-indicator" data-live={String(live)} className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cx("h-2 w-2 flex-none rounded-full", live ? "bg-blue motion-safe:animate-pulse" : "bg-ink-3")} />
      {live ? t("web.realtime.micInUse") : t("web.realtime.micOffHold")}
    </span>
  );
}
