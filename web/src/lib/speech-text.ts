// 朗读兜底(spec 2026-10-12-agents-addressing §5.3):汉字(含扩展 B–F 与兼容表意文字)、假名、CJK 标点、全角 / 半角形式、竖排标点。
// 用 Unicode 脚本属性而不是码位区间:主包预算只有 0.2 kB(INDEX X12)。
const CJK = /[　-ヿ\p{sc=Han}\p{sc=Kana}︰-﹏＀-￯]+/gu;

/**
 * 朗读前去掉所有中文 / 假名 / 全角片段(换成空格,不把两个英文词粘在一起),去掉因此变空的括号与引号,压缩空白;
 * 剩下没有字母或数字就返回空串(调用方据此不请求 TTS)。不含这些字符的文本原样返回。所有量词线性、无回溯。
 */
export function speechText(text: string): string {
  const stripped = text.replace(CJK, " ");
  if (stripped === text) return text; // nothing replaced = no CJK (U+3000 is in the class and becomes " ", so it counts as CJK)
  const out = stripped
    .replace(/[([{"“‘']\s*[)\]}"”’']/g, " ")
    .replace(/\s+([,.;:!?…])|\s+/g, (_, p?: string) => p ?? " ")
    .replace(/^[\s,.;:!?…—–-]+|[\s,;:—–-]+$/g, "");
  return /[A-Za-z0-9]/.test(out) ? out : "";
}
