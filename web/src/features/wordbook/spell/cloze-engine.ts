/**
 * 按句拼写的输入引擎(spec §6.6 / §11.5):纯 reducer + 隐藏输入框差异解释器。
 *
 * 隐藏输入框的值 = 哨兵(零宽空格)+ 当前空的内容。只比较 input 事件前后的值(安卓 Gboard 的
 * keydown 恒为 keyCode 229,不带字符),所以「空格跳空」「空的空上退格回跳」都从值的差异推出。
 */
export const SENTINEL = "​";

export interface ClozeState { values: string[]; active: number; hinted: boolean[] }
export type ClozeAction =
  | { type: "set"; value: string }
  | { type: "space" }
  | { type: "backspaceEmpty" }
  | { type: "focus"; index: number }
  | { type: "hint"; index: number; letter: string }
  | { type: "reset"; count: number };

/** 一个空最多这么多字符(最长的词头分词也远短于此):长粘贴 / 硬件键盘按住不放不会把句子撑出屏幕(review m3)。 */
export const MAX_BLANK = 32;

/** 只留字母(含拉丁扩展)、撇号、连字符;弯撇号折叠为直撇号。空白与哨兵都去掉。截到 MAX_BLANK。 */
const clean = (v: string) => v.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’-]/g, "").replace(/’/g, "'").slice(0, MAX_BLANK);

export function initCloze(count: number): ClozeState {
  return { values: Array<string>(count).fill(""), active: 0, hinted: Array<boolean>(count).fill(false) };
}

export function clozeReducer(s: ClozeState, a: ClozeAction): ClozeState {
  const last = s.values.length - 1;
  switch (a.type) {
    case "set": {
      if (last < 0) return s;
      const value = clean(a.value);
      if (value === s.values[s.active]) return s;
      const values = [...s.values];
      values[s.active] = value;
      return { ...s, values };
    }
    case "space": {
      const active = Math.min(s.active + 1, Math.max(last, 0));
      return active === s.active ? s : { ...s, active };
    }
    case "backspaceEmpty": {
      const active = Math.max(s.active - 1, 0);
      return active === s.active ? s : { ...s, active };
    }
    case "focus":
      return a.index >= 0 && a.index <= last && a.index !== s.active ? { ...s, active: a.index } : s;
    case "hint": {
      if (a.index < 0 || a.index > last) return s;
      const values = [...s.values];
      const hinted = [...s.hinted];
      // 已经以该字母开头就保留已打的字,否则把字母补在前面(与 TypingQuestion 的提示一致;review m2)
      const typed = values[a.index] ?? "";
      const letter = clean(a.letter);
      values[a.index] = typed.toLowerCase().startsWith(letter.toLowerCase()) ? typed : clean(letter + typed);
      hinted[a.index] = true;
      return { values, hinted, active: a.index };
    }
    case "reset":
      return initCloze(a.count);
  }
}

export const allFilled = (s: ClozeState) => s.values.every((v) => v.length > 0);

/**
 * 把隐藏输入框的旧值 `prev` 与新值 `next` 翻译成动作。
 * - 新值仍以哨兵开头:哨兵后面的文字就是当前空的内容,其中每个空白字符 = 跳到下一空。
 * - 哨兵不见了(在空的空上退格、全选替换、光标落在哨兵前):有字 → 仍当内容;没字且旧值只有哨兵 → 退格回跳。
 */
export function interpretInput(prev: string, next: string, remaining = Number.POSITIVE_INFINITY): ClozeAction[] {
  if (!next.startsWith(SENTINEL)) {
    const text = next.split(SENTINEL).join("");
    if (text) return splitWords(text, remaining);
    return prev === SENTINEL ? [{ type: "backspaceEmpty" }] : [{ type: "set", value: "" }];
  }
  return splitWords(next.slice(SENTINEL.length).split(SENTINEL).join(""), remaining);
}

/**
 * 每个空白 = 跳到下一空。`remaining` = 当前空后面还有几个空:跳不动的空白及其后的词丢掉,
 * 否则在最后一个空粘贴 "used to" 会先写 used、跳空失败、再用 to 覆盖(review m1)。
 */
function splitWords(text: string, remaining: number): ClozeAction[] {
  const parts = text.split(/\s/);
  const out: ClozeAction[] = [{ type: "set", value: parts[0] }];
  let left = remaining;
  for (const part of parts.slice(1)) {
    if (left <= 0) break;
    left -= 1;
    out.push({ type: "space" });
    if (part) out.push({ type: "set", value: part });
  }
  return out;
}
