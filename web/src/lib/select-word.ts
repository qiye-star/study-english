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
