import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { avatarInitial } from "~/components/avatar";
import type { CallPhase } from "./call-machine";
import { cx } from "./call-cx";

const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : window.setTimeout(cb, 50);
const caf = (id: number): void =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : window.clearTimeout(id);

/**
 * 电平条:直接写 DOM 宽度,不 setState(每帧重渲染整个界面没有必要)。
 * 高屏在副标题下方 160px;短屏(max-height:700px)并入副标题行,48px。
 */
export function LevelBar({ level }: { level(): number }) {
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
    <div data-testid="call-level" aria-hidden="true"
      className="mt-3 h-1 w-40 flex-none overflow-hidden rounded-sm bg-surface-2 [@media(max-height:700px)]:mt-0 [@media(max-height:700px)]:w-12">
      <div ref={bar} className="h-full rounded-sm bg-blue" style={{ width: "0%" }} />
    </div>
  );
}

const LIVE: ReadonlySet<CallPhase> = new Set(["listening", "thinking", "speaking"]);

/** 顶栏:左侧状态胶囊(绿点 = 通话在线)。状态文字是 `role="status"`,读屏会播报阶段变化。 */
export function CallHeader({ phase }: { phase: CallPhase }) {
  const { t } = useTranslation();
  const phaseKey = phase === "idle" ? "connecting" : phase;
  return (
    <div className="relative z-[2] flex-none">
      <div className="flex h-[52px] items-center justify-between px-2">
        <span className="inline-flex h-8 items-center gap-2 rounded-badge border-[0.5px] border-hair bg-surface px-3 text-sub font-semibold tracking-[.01em] text-ink">
          <span aria-hidden="true" className={cx("h-2 w-2 flex-none rounded-full", LIVE.has(phase) ? "bg-green" : "bg-ink-3")} />
          <span data-testid="call-status" data-phase={phase} role="status">{t(`web.realtime.status.${phaseKey}`)}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * 主视觉:伙伴头像(中性色,呼吸环只在伙伴说话时、且仅 `prefers-reduced-motion:no-preference` 下动)、名字、
 * 副标题(麦克风指示)与电平条。短屏:头像 96→64、无环、名字 22→17、电平条并入副标题、上内边距 24→8。
 */
export function CallHero({ name, phase, subtitle, level, children }: {
  name: string;
  phase: CallPhase;
  /** 副标题行(麦克风指示);通话结束后不传 */
  subtitle?: ReactNode;
  /** 电平条;通话结束后不传 */
  level?: ReactNode;
  /** 主视觉下的提示行(网络慢、没听清……) */
  children?: ReactNode;
}) {
  const ended = phase === "ended";
  const ring = "pointer-events-none absolute rounded-full border-[1.5px] border-blue [@media(max-height:700px)]:hidden";
  const breathing = phase === "speaking" && "motion-safe:animate-breathe";
  return (
    <div className="relative z-[1] flex-none px-4 pt-6 text-center [@media(max-height:700px)]:pt-2">
      <div className="relative mx-auto h-24 w-24 [@media(max-height:700px)]:h-16 [@media(max-height:700px)]:w-16">
        {!ended && (
          <>
            <span aria-hidden="true" className={cx(ring, "-inset-2.5 opacity-35", breathing)} />
            <span aria-hidden="true" className={cx(ring, "-inset-5 opacity-15 [animation-delay:.4s]", breathing)} />
          </>
        )}
        <span role="img" aria-label={name}
          className="relative flex h-full w-full items-center justify-center rounded-full border-[0.5px] border-hair bg-surface text-hero font-semibold tracking-[-.03em] text-ink shadow-[0_8px_24px_-12px_rgba(36,86,219,.35)] [@media(max-height:700px)]:text-[26px]">
          <span aria-hidden="true">{avatarInitial(name)}</span>
        </span>
      </div>
      <h2 className="mt-3.5 text-headline font-semibold tracking-[-.02em] text-ink [@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:text-title">
        {name}
      </h2>
      {(subtitle || level) && (
        <div className="flex flex-col items-center [@media(max-height:700px)]:mt-[3px] [@media(max-height:700px)]:flex-row [@media(max-height:700px)]:justify-center [@media(max-height:700px)]:gap-2">
          {subtitle && (
            <p className="mt-[3px] flex items-center justify-center gap-2 text-sub text-ink-2 [@media(max-height:700px)]:mt-0">{subtitle}</p>
          )}
          {level}
        </div>
      )}
      {children}
    </div>
  );
}
