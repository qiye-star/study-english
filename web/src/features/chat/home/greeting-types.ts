/*
 * 问候弹窗消费的数据形状(服务端计划 §5.1;网页计划 §6.1)。这里只放结构类型,不依赖数据层:
 * `chat-home-api.ts` 的同名类型与它们结构兼容,集成时直接传入。
 */
export type GreetingLanguage = "zh" | "en" | "bilingual";

/** 一段问候;文本可含 R17 的 `*…*` 强调标记(经 emphasis.ts 解析)。 */
export interface GreetingLine {
  en?: string;
  zh?: string;
}

/** 底部小字数据:只有数字,缺键 = 不显示该项。 */
export interface GreetingFacts {
  streak?: number;
  due?: number;
  yesterdayMistakes?: number;
}

/** 弹窗里一行的两层文字:主句 + 可选的中文副句(只有 bilingual)。 */
export interface LineText {
  main: string;
  sub?: string;
}

/** 按问候语言取出一行要显示的文字:zh → 中文;en → 英文;bilingual → 英文主句 + 中文副句。缺键时退到另一种语言。 */
export function lineText(line: GreetingLine, language: GreetingLanguage): LineText {
  if (language === "zh") return { main: line.zh ?? line.en ?? "" };
  if (language === "en") return { main: line.en ?? line.zh ?? "" };
  return line.en ? { main: line.en, sub: line.zh } : { main: line.zh ?? "" };
}
