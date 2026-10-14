// 答后选项行与「学习内容」区的纯函数(计划 2026-10-13-review-after-answer R-A11;选项行双语:2026-10-14-review-bilingual-longpress R-Z1)。
import { meaningLine } from "./word-card";
import type { AnswerResult, Card, OptionInfo, QType, Question } from "./wordbook-api";

export interface OptionRowView {
  /** 第一行:meaning 题 = 选项原文(服务端的中文释义行);word 题 = 英文单词;没有信息 = 选项原文 */
  main: string;
  /** 第二行小字:meaning 题 = 英文单词;word / cloze 题 = 「词性. 中文」;null = 没有 */
  sub: string | null;
  /** 长按查的英文单词;null = 这行没有可查的词(旧服务端的 meaning 题),按原来的样子显示 */
  word: string | null;
  /** 英文单词在哪一行 */
  wordLine: "main" | "sub" | null;
}

/** 按 `option` 文本匹配(不按下标:备忘可能来自另一次出题,宁可没信息也不错位)。 */
export const infoFor = (infos: readonly OptionInfo[] | undefined, option: string): OptionInfo | undefined =>
  infos?.find((i) => i.option === option);

/**
 * 一个选项答题后显示什么(R-Z1:与 def_lang 无关,中文永远在)。
 * meaning 题:选项原文(中文)为主行 + 小字英文单词(正确项、错误项、未选项一样);word 题:英文单词 + 小字「词性. 中文」(spec D3)。
 */
export function optionRowView(qtype: QType, option: string, info: OptionInfo | undefined): OptionRowView {
  if (qtype === "word" || qtype === "cloze") {
    const word = info?.word ?? option;
    return { main: word, sub: info ? meaningLine(info.defsZh ?? [], 40) || null : null, word, wordLine: "main" };
  }
  if (qtype === "meaning" && info) return { main: option, sub: info.word, word: info.word, wordLine: "sub" };
  return { main: option, sub: null, word: null, wordLine: null };
}

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
