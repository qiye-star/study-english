// 答后选项行与「学习内容」区的纯函数(计划 2026-10-13-review-after-answer R-A10 / R-A11)。释义行的取舍一律走 defView,这里不重复规则。
import { defView } from "./def-lang";
import { meaningLine } from "./word-card";
import type { AnswerResult, Card, DefLang, OptionInfo, QType, Question } from "./wordbook-api";

export interface OptionRowView {
  /** 英文单词(双击查它);null = 这行没有可查的词(旧服务端的 meaning 题 / cloze),按原来的样子显示选项原文 */
  word: string | null;
  /** 单词下面的小字(中文释义行 / 词性与中文);null = 不显示 */
  sub: string | null;
}

/** 按 `option` 文本匹配(不按下标:备忘可能来自另一次出题,宁可没信息也不错位)。 */
export const infoFor = (infos: readonly OptionInfo[] | undefined, option: string): OptionInfo | undefined =>
  infos?.find((i) => i.option === option);

const viewOf = (defLang: DefLang, info: OptionInfo, peek: boolean) =>
  defView(defLang, { senses: info.defsZh ?? [], defsEn: info.defsEn ?? [] }, peek);

/**
 * 一个选项答题后显示什么。meaning 题:单词 + (按 def_lang / 「中」开关)可能显示的中文行(就是服务端的释义行原文);
 * word 题:单词 + 小字「词性. 中文」,始终显示(spec D3,不受 def_lang 影响)。
 */
export function optionRowView(qtype: QType, option: string, info: OptionInfo | undefined, defLang: DefLang, peek: boolean): OptionRowView {
  if (qtype === "word") return { word: info?.word ?? option, sub: info ? meaningLine(info.defsZh ?? [], 40) || null : null };
  if (qtype === "meaning" && info) return { word: info.word, sub: viewOf(defLang, info, peek).showSenses ? option : null };
  return { word: null, sub: null };
}

/** 「中」开关有意义:meaning 题里,有任一选项在当前偏好下把中文藏起来了。 */
export const optionsCanPeek = (qtype: QType, defLang: DefLang, infos: readonly OptionInfo[] | undefined): boolean =>
  qtype === "meaning" && (infos ?? []).some((i) => viewOf(defLang, i, false).canPeek);

/** 「学习内容」区用的词卡:优先批次里的词卡;没有就用正确选项的 info + 服务端的 phrases / example 拼一张;都没有 → null。 */
export function cardForPanel(
  card: Card | undefined,
  question: Question,
  result: Pick<AnswerResult, "optionInfo" | "correctOption" | "phrases" | "example">,
): Card | null {
  if (card) return card;
  const info = result.correctOption === null ? undefined : infoFor(result.optionInfo, result.correctOption);
  if (!info) return null;
  return {
    key: question.key, word: info.word, us: "", uk: "", senses: info.defsZh ?? [], phrases: result.phrases ?? [],
    examples: result.example ? [result.example] : [], defsEn: info.defsEn ?? [],
  };
}
