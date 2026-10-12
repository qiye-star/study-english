// 朗读兜底(spec 2026-10-12-agents-addressing §5.3):中日统一表意文字、假名、CJK 标点、全角 / 半角形式、竖排标点、扩展 B–F。
const CJK = /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯\u{20000}-\u{2fa1f}]+/gu;
const HAS_CJK = new RegExp(CJK.source, "u");

/**
 * 朗读前去掉所有中文 / 假名 / 全角片段(换成空格,不把两个英文词粘在一起),去掉因此变空的括号与引号,压缩空白;
 * 剩下没有字母或数字就返回空串(调用方据此不请求 TTS)。不含这些字符的文本原样返回。所有量词线性、无回溯。
 */
export function speechText(text: string): string {
  if (!HAS_CJK.test(text)) return text;
  const out = text
    .replace(CJK, " ")
    .replace(/[([{"“‘']\s*[)\]}"”’']/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?…])/g, "$1")
    .replace(/^[\s,.;:!?…—–-]+|[\s,;:—–-]+$/g, "");
  return /[A-Za-z0-9]/.test(out) ? out : "";
}
