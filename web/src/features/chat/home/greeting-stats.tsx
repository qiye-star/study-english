import { BookOpen, Flame, Target } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CountUp } from "./count-up";
import type { GreetingFacts } from "./greeting-types";

/** 数字占位:文案里的 {{n}} 先替换成它,再在它处切开,数字换成 CountUp。 */
const MARK = "\u0001";

const valid = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * 底部小字数据行:只有数字(连续天数 / 待复习 / 昨天错点数),缺键的项不显示,全缺则整行不渲染。
 * 视觉部分 aria-hidden(数字在计数),另有完整的读屏文字。
 */
export function GreetingStats({ facts, delayMs, reduced }: { facts: GreetingFacts; delayMs: number; reduced: boolean }) {
  const { t } = useTranslation();
  const items: Array<{ key: string; icon: ReactNode; n: number }> = [];
  if (valid(facts.streak)) items.push({ key: "streak", icon: <Flame aria-hidden />, n: facts.streak });
  if (valid(facts.due)) items.push({ key: "due", icon: <BookOpen aria-hidden />, n: facts.due });
  if (valid(facts.yesterdayMistakes)) items.push({ key: "mistakes", icon: <Target aria-hidden />, n: facts.yesterdayMistakes });
  if (items.length === 0) return null;

  const spoken = items.map((it) => t(`web.chat.home.greeting.stats.${it.key}Sr`, { n: it.n })).join(t("web.chat.home.greeting.stats.sep"));
  return (
    <div data-testid="greeting-stats" className="greet-quiet">
      <span className="sr-only">{spoken}</span>
      <div aria-hidden="true" className="greet-quiet-row">
        {items.map((it, i) => {
          const [pre, post = ""] = t(`web.chat.home.greeting.stats.${it.key}`, { n: MARK }).split(MARK);
          return (
            <span key={it.key} className="greet-q">
              {it.icon}
              {pre}
              <CountUp to={it.n} delayMs={delayMs + 150 + i * 80} reduced={reduced} />
              {post}
            </span>
          );
        })}
      </div>
    </div>
  );
}
