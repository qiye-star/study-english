/**
 * 问候强调标记(FR19,服务端 R17 `normalize_marks` 同一规则):只认单星号 `*…*`。
 * 合法 = 成对、不嵌套、内容 1–24 字符且不含 `*` / 换行 / `<` / `>`、每条 ≤ 3 处;`**x**` 先规范成 `*x*`。
 * 任何违规 → 整条当纯文本并去掉所有 `*`(服务端已保证不会出现,这里只是防御)。不支持任何其他标记。
 */
export interface EmphasisPart { text: string; em: boolean }

const MAX_MARKS = 3;
const MAX_MARK_CHARS = 24;
const BAD_CONTENT = /[\n\r<>]/;

export function stripAllStars(line: string): string {
  return line.replace(/\*/g, "");
}

export function parseEmphasis(line: string): EmphasisPart[] {
  const normalized = line.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  const pieces = normalized.split("*");
  const plain = (): EmphasisPart[] => {
    const text = stripAllStars(line);
    return text ? [{ text, em: false }] : [];
  };
  if (pieces.length === 1) return line ? [{ text: line, em: false }] : [];
  if ((pieces.length - 1) % 2 !== 0) return plain();
  const parts: EmphasisPart[] = [];
  let marks = 0;
  for (let i = 0; i < pieces.length; i++) {
    const text = pieces[i];
    const em = i % 2 === 1;
    if (em) {
      marks += 1;
      if (marks > MAX_MARKS || text.length < 1 || text.length > MAX_MARK_CHARS || BAD_CONTENT.test(text)) return plain();
    }
    if (text) parts.push({ text, em });
  }
  return parts;
}

/** 去掉标记后的纯文本(读屏、aria-label、朗读、与消息正文比对都用它)。 */
export function stripEmphasis(line: string): string {
  return parseEmphasis(line).map((p) => p.text).join("");
}
