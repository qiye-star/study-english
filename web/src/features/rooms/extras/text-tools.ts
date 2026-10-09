import type { RoomMessage } from "../protocol";

const CJK = /[㐀-䶿一-鿿豈-﫿]/gu;
const LATIN = /[A-Za-z]/g;

/**
 * 消息主体是否已经是收听者的母语(spec §6.2 / R2-14):中文母语时 CJK 字符占(CJK + 拉丁字母)≥ 30% 才算。
 * 与服务端 `rooms/voice.py::detect_lang` 同一条规则(P2-10;两边测试用同样的三条样例)。其他母语一律 false(仍显示「译」)。
 */
export function isMostlyNative(text: string, nativeLanguage: string): boolean {
  if (!nativeLanguage.toLowerCase().startsWith("zh")) return false;
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  if (cjk + latin === 0) return false;
  return cjk / (cjk + latin) >= 0.3;
}

const AT_AI = /^\s*@(?:ai|助手)(?=$|[\s:：,，])[\s:：,，]*/i;

/**
 * 「朗读」与「译」用的正文:AI 回答只取英文部分(去掉「中文:」行及其后的说明,与列表里 AiAnswer 的切分一致);
 * 成员消息去掉开头的 @ai / @助手。
 */
export function speakable(m: RoomMessage): string {
  if (m.kind === "ai_answer") {
    const lines = m.text.split("\n");
    const zhAt = lines.findIndex((l) => /^\s*中文[:：]/.test(l));
    return (zhAt < 0 ? lines : lines.slice(0, zhAt)).join("\n").trim();
  }
  return m.text.replace(AT_AI, "").trim();
}
