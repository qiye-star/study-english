import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCountdown } from "./countdown";
import { formatGreetingDate } from "./greeting-date";
import { useFitGreeting } from "./greeting-fit";
import { RevealText, revealEnd } from "./greeting-reveal";
import { GreetingStats } from "./greeting-stats";
import { greetingTimeline } from "./greeting-tokens";
import { lineText, type GreetingFacts, type GreetingLanguage, type GreetingLine } from "./greeting-types";
import { animate, useReducedMotion } from "./motion";
import "./greeting.css";

/** 倒计时长度:从最后一行开始出现时算起(演示页 COUNTDOWN)。 */
export const COUNTDOWN_MS = 5000;

export type GreetingCloseReason = "skip" | "tap" | "key" | "esc" | "timeout";

/** 关闭动画的可动对象,供调用方自定义退场(例如把各行飞进对话气泡)。 */
export interface GreetingExitTargets {
  root: HTMLElement;
  bg: HTMLElement;
  date: HTMLElement;
  /** 每一行(顺序同 lines),带 data-gl 序号。 */
  lines: HTMLElement[];
  bottom: HTMLElement;
  reduced: boolean;
}

export interface GreetingModalProps {
  /** 问候的各行,服务端保证恰好 3 条;文本可含 R17 的 `*…*`。 */
  lines: GreetingLine[];
  /** 决定显示哪种语言:zh / en / bilingual(英文主句 + 中文副句)。 */
  language: GreetingLanguage;
  /** 用户本地日 YYYY-MM-DD,弹窗顶部日期行据此本地化。 */
  localDate: string;
  /** 底部小字数据;空对象或不传 = 不显示。 */
  facts?: GreetingFacts;
  /** open = 当天首次 / 每次上线;replay = 设置里重播(只影响 data-mode,是否调 seen 由调用方决定)。 */
  mode?: "open" | "replay";
  /** 退场动画结束后调用一次;调用方在这里卸载弹窗。 */
  onClose: (reason: GreetingCloseReason) => void;
  /** 弹窗出现(挂载)时调用一次,例如调用方在此上报 seen。 */
  onShown?: () => void;
  /** 自定义退场;返回的 Promise 结束后才调用 onClose。缺省 = 整体淡出(320 ms,减弱动效 180 ms)。 */
  playExit?: (targets: GreetingExitTargets) => Promise<void> | void;
  /** 关闭后的焦点归还:缺省把焦点还给打开前的元素(已不在页面上则不动);要回到别处(如消息列表)时传入并自己 focus。 */
  onCloseAutoFocus?: (event: Event) => void;
  /** 挂载位置,缺省 document.body。 */
  container?: HTMLElement | null;
}

const hoverCapable = () => {
  try {
    return window.matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
};

/*
 * 今日问候弹窗(网页计划 FR13–FR16、FR19;演示页 openGreeting / closeGreeting)。纯展示组件:没有数据层依赖。
 * 只有问候文字(没有助手名字 / 头像):3 行逐词模糊落下,最后一行开始出现时启动 5 s 倒计时;
 * 轻点任意处 / 跳过 / Enter / Space / Esc 随时进入对话;悬停在「跳过」上或页面隐藏时暂停。
 * 不使用 backdrop-filter(极光用 filter: blur 色斑),文字只经 React 文本节点渲染。
 */
export function GreetingModal({ lines, language, localDate, facts, mode = "open", onClose, onShown, playExit, onCloseAutoFocus, container }: GreetingModalProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const timeline = greetingTimeline(lines.length, reduced);

  const content = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const fg = useRef<HTMLDivElement | null>(null);
  // Radix 的 Portal 在首次提交后才挂内容,所以前景元素就位后才能量布局
  const [fgReady, setFgReady] = useState(false);
  const setFg = useCallback((el: HTMLDivElement | null) => {
    fg.current = el;
    setFgReady(el !== null);
  }, []);
  const dateRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  // Radix 只会把焦点还给 Trigger;这里没有 Trigger,所以自己记下打开前的焦点元素
  const returnTo = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const [closing, setClosing] = useState(false);
  const [lastShown, setLastShown] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);

  const shown = useRef(onShown);
  shown.current = onShown;
  useEffect(() => shown.current?.(), []);

  // 最后一行开始出现 = 倒计时起点
  useEffect(() => {
    const id = setTimeout(() => setLastShown(true), timeline.countdownAt);
    return () => clearTimeout(id);
  }, [timeline.countdownAt]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const close = useCallback(
    (reason: GreetingCloseReason) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      const done = () => onClose(reason);
      const root = content.current;
      if (root && bg.current && dateRef.current && box.current && bottom.current && playExit) {
        const targets: GreetingExitTargets = {
          root, bg: bg.current, date: dateRef.current, bottom: bottom.current, reduced,
          lines: Array.from(box.current.querySelectorAll<HTMLElement>("[data-gl]")),
        };
        void Promise.resolve(playExit(targets)).then(done, done);
        return;
      }
      if (!root) return done();
      animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 180 : 320, fill: "forwards", onfinish: done });
    },
    [onClose, playExit, reduced],
  );

  const paused = hovering || hidden;
  const seconds = useCountdown({ ms: COUNTDOWN_MS, active: lastShown && !closing, paused, onDone: () => close("timeout") });

  useFitGreeting(fg, box, [dateRef, bottom], [lines, language, fgReady]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      close("key");
    }
  };
  const onSkip = (e: MouseEvent) => {
    e.stopPropagation();
    close("skip");
  };

  const date = formatGreetingDate(localDate, i18n.language);
  const hasFacts = facts && Object.keys(facts).length > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close("esc")}>
      <Dialog.Portal container={container ?? undefined}>
        <Dialog.Content
          ref={content}
          aria-describedby={undefined}
          aria-modal="true"
          data-testid="greeting-modal"
          data-mode={mode}
          className="greet"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            content.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (onCloseAutoFocus) return onCloseAutoFocus(e);
            const back = returnTo.current;
            if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus({ preventScroll: true });
          }}
          onKeyDown={onKeyDown}
          onClick={() => close("tap")}
        >
          <Dialog.Title className="sr-only">{t("web.chat.home.greeting.title")}</Dialog.Title>
          <div ref={bg} className="greet-bg" aria-hidden="true">
            <div className="greet-aurora"><i /><i /><i /></div>
          </div>
          <div ref={setFg} className="greet-fg">
            <div ref={dateRef} className="greet-date" data-testid="greeting-date">
              {date ? <RevealText text={date} fx="split" delay={150} stagger={30} reduced={reduced} /> : null}
            </div>
            <div ref={box} className="greet-lines" data-testid="greeting-lines">
              {lines.map((line, i) => {
                const { main, sub } = lineText(line, language);
                const start = timeline.starts[i];
                const zh = language === "zh";
                const stagger = zh ? (i ? 24 : 45) : i ? 45 : 80;
                const maxSpan = i ? 1000 : 900;
                return (
                  <div key={i} data-gl={i} data-testid="greeting-line" className={i === 0 ? "greet-line greet-lead" : "greet-line"}>
                    <span><RevealText text={main} fx="blur" delay={start} stagger={stagger} maxSpan={maxSpan} reduced={reduced} /></span>
                    {sub ? (
                      <span className="greet-sub">
                        <RevealText text={sub} fx="split" delay={revealEnd(main, "blur", start, stagger, maxSpan) - 400} stagger={12} maxSpan={450} reduced={reduced} />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div ref={bottom} className="greet-bottom">
              {hasFacts ? <FadeIn delay={timeline.statsAt} reduced={reduced}><GreetingStats facts={facts} delayMs={timeline.statsAt} reduced={reduced} /></FadeIn> : null}
              <div className="greet-foot">
                <span className="greet-shiny" aria-hidden="true">{t("web.chat.home.greeting.tapHint")}</span>
                <button
                  type="button"
                  data-testid="greeting-skip"
                  className="greet-skip"
                  aria-label={t("web.chat.home.greeting.skipAria")}
                  onClick={onSkip}
                  onPointerEnter={() => hoverCapable() && setHovering(true)}
                  onPointerLeave={() => setHovering(false)}
                >
                  {t("web.chat.home.greeting.skip")}
                  <span className="greet-ring" aria-hidden="true">
                    <svg viewBox="0 0 32 32">
                      <circle className="greet-ring-track" cx="16" cy="16" r="13" />
                      <circle
                        className={lastShown ? "greet-ring-bar greet-ring-run" : "greet-ring-bar"}
                        data-testid="greeting-ring"
                        cx="16" cy="16" r="13"
                        style={{ ["--dur" as string]: `${COUNTDOWN_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                      />
                    </svg>
                    <b>{seconds}</b>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 底部数据行整体上浮淡入(演示页:第 2 行开始后 500 ms,700 ms)。 */
function FadeIn({ delay, reduced, children }: { delay: number; reduced: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const a = animate(el, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
      duration: 700, delay, easing: "cubic-bezier(.2,0,0,1)", fill: "backwards",
    });
    return () => a?.cancel();
  }, [delay, reduced]);
  return <div ref={ref}>{children}</div>;
}
