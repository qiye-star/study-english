/*
 * 强调标记(服务端计划 R17、网页计划 FR19):只认单星号 `*…*`。
 * 合法 = 成对、不嵌套、内容 1–24 字符且不含 `*` / 换行 / `<` / `>`、每条 ≤ 3 处;`**x**` 先规范成 `*x*`。
 * 任何违规 → 整条当纯文本并去掉所有 `*`(服务端已保证不会出现,这里只是防御)。
 */
export interface EmphasisPart {
  text: string;
  em: boolean;
}

const MAX_MARKS = 3;
const MAX_LEN = 24;

const plain = (line: string): EmphasisPart[] => {
  const text = line.replace(/\*/g, "");
  return text ? [{ text, em: false }] : [];
};

export function parseEmphasis(line: string): EmphasisPart[] {
  const source = line.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  if (!source.includes("*")) return source ? [{ text: source, em: false }] : [];
  // 单星号切开后,奇数下标就是标记内的内容;星号个数必须是偶数(成对),也就不可能嵌套
  const pieces = source.split("*");
  if (pieces.length % 2 === 0) return plain(line);
  const parts: EmphasisPart[] = [];
  let marks = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const text = pieces[i];
    const em = i % 2 === 1;
    if (em) {
      marks += 1;
      const length = [...text].length;
      if (marks > MAX_MARKS || length < 1 || length > MAX_LEN || /[\n<>]/.test(text)) return plain(line);
    }
    if (text) parts.push({ text, em });
  }
  return parts;
}

/** 去掉标记后的正文:读屏 / sr-only 全文、朗读、与消息正文比对都用它。 */
export function stripEmphasis(line: string): string {
  return parseEmphasis(line).map((p) => p.text).join("");
}
