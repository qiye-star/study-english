import "./locales";
import type { TFunction } from "i18next";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import type { ConversationChrome } from "../conversation-chrome";
import type { TodayGreeting } from "./chat-home-api";
import { EmphasisText } from "./emphasis-text";
import { stripEmphasis } from "./emphasis";
import { lineText, type GreetingFacts } from "./greeting-types";

/**
 * 服务端写进对话的问候消息正文:每段的 en / zh(有哪些取哪些,英文在前,中间空一行),去掉强调标记
 * (server `message_text`)。可见文字只有在与它一致时才用带强调的问候行,否则退回原消息(FR12)。
 */
export function storedGreetingText(line: { en?: string; zh?: string }): string {
  return [line.en, line.zh].filter((s): s is string => !!s).map(stripEmphasis).join("\n\n");
}

/** 组尾小字:只有数字(缺项不显示),用弹窗同一套文案。 */
export function factsLine(facts: GreetingFacts, t: TFunction): string {
  const items: string[] = [];
  const ok = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (ok(facts.streak)) items.push(t("web.chat.home.greeting.stats.streak", { n: facts.streak }));
  if (ok(facts.due)) items.push(t("web.chat.home.greeting.stats.due", { n: facts.due }));
  if (ok(facts.yesterdayMistakes)) items.push(t("web.chat.home.greeting.stats.mistakes", { n: facts.yesterdayMistakes }));
  return items.join(" · ");
}

function timeLabel(iso: string, lang: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" }).format(d);
}

/**
 * 今天的默认对话里的问候组(FR12),经 `chrome.renderMessage`:问候的三条助手消息带「✦ 今日问候 · 08:42」小标题、
 * 第 1 条 lead 样式、组尾小字数据;每条的包装层带 `data-gl` / `data-greet-target` 序号,供关闭弹窗时的飞入定位。
 * 可见文字用问候行(带强调、双语主副句);气泡动作(听 / 翻译 / 跟读 / 查词)一律用原消息内容。
 * 消息 id 对不上 → 原样返回默认气泡。
 */
export function greetingRenderMessage(greeting: TodayGreeting | null | undefined, t: TFunction, lang: string): ConversationChrome["renderMessage"] {
  if (!greeting || greeting.messageIds.length !== greeting.lines.length) return undefined;
  return (message, defaultNode, ctl) => {
    const index = message.id ? greeting.messageIds.indexOf(message.id) : -1;
    if (index < 0 || message.role !== "assistant" || message.status !== "done" || !isValidElement(defaultNode)) return defaultNode;
    void ctl;
    const line = greeting.lines[index];
    const { main, sub } = lineText(line, greeting.language);
    const faithful = storedGreetingText(line) === message.content;
    const body: ReactNode = faithful ? (
      <>
        <p className={index === 0 ? "whitespace-pre-wrap break-words text-[17px] font-medium leading-snug" : "whitespace-pre-wrap break-words"} data-testid="chat-greeting-text">
          <EmphasisText text={main} />
        </p>
        {sub ? <p className="mt-1 whitespace-pre-wrap break-words text-sub text-ink-2"><EmphasisText text={sub} /></p> : null}
      </>
    ) : undefined;
    const last = index === greeting.lines.length - 1;
    const facts = last ? factsLine(greeting.facts, t) : "";
    return (
      <div data-gl={index} data-greet-target={index} data-testid="chat-greeting-line" className="flex flex-col gap-1.5">
        {index === 0 ? (
          <p data-testid="chat-greeting-group" className="px-1 text-meta font-medium text-ink-2">
            {t("web.chat.home.group.title", { time: timeLabel(greeting.generatedAt, lang) })}
          </p>
        ) : null}
        {body ? cloneElement(defaultNode as ReactElement<{ body?: ReactNode }>, { body }) : defaultNode}
        {facts ? <p data-testid="chat-greeting-facts" className="px-1 text-meta text-ink-2">{facts}</p> : null}
      </div>
    );
  };
}
