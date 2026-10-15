/**
 * 程序化选中一个元素里的全部文字(点词 / 双击答后选项):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己出现选中操作条,
 * 上下文取最近的 [data-lookup-context]。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
 *
 * 与 features/library/word-tap.ts 的 selectWord 同一契约(那份归跟读库,feature 之间不能导入彼此的内部文件,所以这里放一份;
 * 计划 2026-10-13-review-after-answer R-A8)。以后 library 可以改成从这里 re-export。
 */
export function selectWord(el: HTMLElement, doc: Document = el.ownerDocument): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  const current = sel.isCollapsed ? "" : sel.toString().trim();
  if (current && current !== (el.textContent ?? "").trim()) return false;
  sel.removeAllRanges();
  sel.selectAllChildren(el);
  return true;
}

/** Letters (Latin incl. accents), digits, apostrophes and hyphens make up an English word; CJK never does. */
const WORD_CHAR = /[A-Za-zÀ-ɏ0-9'’-]/;
const EDGE_PUNCT = /['’-]/;
const LATIN = /[A-Za-zÀ-ɏ]/;

type CaretDoc = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as CaretDoc;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

/**
 * The Range of the English word under (x, y), or null (tap-to-lookup marker and lookup, plan 2026-10-15 tap-lookup).
 * The range lies inside ONE text node (and inside `within` when given); whitespace, punctuation, digits-only and CJK text
 * give null, as does a browser without caretPositionFromPoint / caretRangeFromPoint. Apostrophes and hyphens count inside a word.
 */
export function wordRangeAt(x: number, y: number, doc: Document = document, within?: Element): Range | null {
  const caret = caretAt(doc, x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  if (within && !within.contains(caret.node)) return null;
  const text = caret.node.textContent ?? "";
  let start = caret.offset;
  let end = caret.offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end += 1;
  while (start < end && EDGE_PUNCT.test(text[start])) start += 1;
  while (end > start && EDGE_PUNCT.test(text[end - 1])) end -= 1;
  if (!LATIN.test(text.slice(start, end))) return null;
  const range = doc.createRange();
  range.setStart(caret.node, start);
  range.setEnd(caret.node, end);
  return range;
}

/**
 * Select the English word under (x, y) (second tap of tap-to-lookup).
 * Does nothing when a selection already exists (the browser's own long-press wins) or when `wordRangeAt` finds no word.
 * Returns whether the selection changed.
 */
export function selectWordAt(x: number, y: number, doc: Document = document, within?: Element): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  if (!sel.isCollapsed && sel.toString().trim()) return false;
  const range = wordRangeAt(x, y, doc, within);
  if (!range) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
