import { useTranslation } from "react-i18next";
import { SurfaceCard } from "~/components/surface-card";
import { ZhToggle } from "~/components/zh-toggle";
import { zhReveal } from "./def-lang";
import { DefinitionsEn } from "./defs-en";
import { cardForPanel } from "./option-view";
import { PhrasesSection } from "./phrases-section";
import { ListenButton, WordCardView, posLabel, type ListenProps } from "./word-card";
import type { AnswerResult, Card, DefLang, Question } from "./wordbook-api";
import "./locales";

export const AFTER_MAX_PHRASES = 3;
const MAX_SENSES = 4;

/**
 * 复习页答题后题目下方的「学习内容」(spec 2026-10-13-review-after-answer D1 / D3,计划 R-A10 / R-A11;
 * 「中文」按钮:计划 2026-10-14-review-bilingual-longpress R-Z2 / R-Z3):
 * - `meaning`(英→中):正确单词 + 英英释义 + 短语(最多 3 条,展开)+ 朗读。偏好「仅英文」且有英文释义时,中文释义与短语译文藏在
 *   「中文」按钮后面(`peek` 由复习页持有,换题复位);偏好 zh / both 或没有英文释义的词直接显示中文,没有按钮。不显示例句。
 * - `word`(中→英)/ `cloze`(例句选词,选项也是英文词):正确单词的卡片 `WordCardView` 受控模式(同一个「中文」按钮,不画卡片右上角的「中」)。
 * 词卡优先取批次里的;没有时用答案里正确选项的 `optionInfo` + `phrases` + `example` 拼一张;都没有就什么也不渲染。
 */
export function AfterAnswerPanel({ question, result, card, defLang, peek, onPeek, onListen, listening, canListen }: ListenProps & {
  question: Question;
  result: Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example">;
  card: Card | undefined;
  defLang: DefLang;
  peek: boolean;
  onPeek: () => void;
}) {
  const { t } = useTranslation();
  const shown = cardForPanel(card, question, result);
  if (!shown) return null;
  const listen = { onListen, listening, canListen };
  if (question.qtype === "word" || question.qtype === "cloze") {
    return (
      <WordCardView card={shown} defLang={defLang} eyebrow={t("web.wordbookDefs.after.title")} className="mt-3" phrasesOpen={false}
        peek={peek} onPeek={onPeek} {...listen} />
    );
  }
  const { view, phraseZh, chip } = zhReveal(defLang, shown, peek);
  return (
    <SurfaceCard data-testid="after-answer-panel" className="mt-3 px-4 pb-3 pt-4">
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <p className="eyebrow">{t("web.wordbookDefs.after.title")}</p>
        <ListenButton id={`${shown.key}:after`} text={shown.word} label={t("web.wordbook.word.listen.word")} {...listen}
          className="-my-2.5 -mr-2 h-tap w-tap justify-center rounded-full bg-blue-tint text-blue" />
      </div>
      <p lang="en" className="mt-1 break-words text-title font-semibold">{shown.word}</p>
      {view.showSenses ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {shown.senses.slice(0, MAX_SENSES).map((s, i) => (
            <li key={i} className="text-body leading-dialogue">
              {s.pos ? <em className="mr-1.5 font-mono text-meta font-semibold not-italic text-ink-2">{posLabel(s.pos)}</em> : null}
              {s.text}
            </li>
          ))}
        </ul>
      ) : null}
      {view.showDefs ? <DefinitionsEn groups={view.groups} className={view.showSenses ? "mt-1.5" : "mt-2"} /> : null}
      {chip ? <ZhToggle pressed={peek} onToggle={onPeek} label={t("web.wordbookDefs.after.zh")} testId="after-zh" className="mt-2.5" /> : null}
      <PhrasesSection phrases={shown.phrases.slice(0, AFTER_MAX_PHRASES)} mode showZh={phraseZh} />
    </SurfaceCard>
  );
}
