import { useCallback, useEffect, useRef, useState } from "react";
import { LOOKUP_CONTEXT_SELECTOR } from "~/lib/lookup-context";
import { normalizeSelection } from "./lookup";

export interface TextSelectionInfo {
  text: string;
  context: string;
}

export { LOOKUP_CONTEXT_SELECTOR }; // 唯一来源在 ~/lib/lookup-context(计划 2026-10-15 R-M1)
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const MAX_TEXT = 1000;
const MAX_CONTEXT = 300;
const SENTENCE_END = /[.!?。！？\n]/;

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Sentence around [start, end) of `raw`, hard-bounded to MAX_CONTEXT characters. */
function boundContext(raw: string, start: number, end: number): string {
  if (normalizeSelection(raw).length <= MAX_CONTEXT) return normalizeSelection(raw);
  let from = start;
  while (from > 0 && !SENTENCE_END.test(raw[from - 1])) from -= 1;
  let to = end;
  while (to < raw.length && !SENTENCE_END.test(raw[to - 1] ?? "")) to += 1;
  if (to - from > MAX_CONTEXT) {
    // Sentence too long: take a MAX_CONTEXT window centred on the selection (clamped to the
    // sentence) so the selected word is never cut off. Slicing raw keeps the window <= MAX_CONTEXT.
    const centre = Math.floor((start + end) / 2);
    const wFrom = Math.max(from, Math.min(centre - MAX_CONTEXT / 2, to - MAX_CONTEXT));
    return normalizeSelection(raw.slice(wFrom, Math.min(to, wFrom + MAX_CONTEXT)));
  }
  return normalizeSelection(raw.slice(from, to));
}

export function readSelection(selection: Selection | null): TextSelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const anchor = elementOf(selection.anchorNode)?.closest(LOOKUP_CONTEXT_SELECTOR) ?? null;
  const focus = elementOf(selection.focusNode)?.closest(LOOKUP_CONTEXT_SELECTOR) ?? null;
  const ctx = anchor ?? focus;
  if (!ctx || (anchor && focus && anchor !== focus)) return null;
  if (elementOf(selection.anchorNode)?.closest(EDITABLE_SELECTOR) || elementOf(selection.focusNode)?.closest(EDITABLE_SELECTOR)) return null;
  // Android can let one end land just outside the text (action row, bubble padding): clamp it to the context. Two different contexts still reject.
  const range = selection.getRangeAt(0).cloneRange();
  if (!ctx.contains(range.startContainer)) range.setStart(ctx, 0);
  if (!ctx.contains(range.endContainer)) range.setEnd(ctx, ctx.childNodes.length);
  const text = normalizeSelection(range.toString());
  if (!text) return null;
  const raw = ctx.textContent ?? "";
  const before = document.createRange();
  before.selectNodeContents(ctx);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const context = boundContext(raw, start, start + range.toString().length);
  return { text: text.slice(0, MAX_TEXT), context };
}

/** After a press on the bar ends, selectionchange events this long still do not clear the selection (the click lands after the release). */
const PRESS_GRACE_MS = 600;

/**
 * Reports the selection only after it has been stable for `debounceMs` (handle dragging fires selectionchange continuously).
 *
 * Android Chrome collapses the native selection when a finger touches anything that is not selected text, which would unmount the
 * action bar before its click lands. `press()` / `release()` (called by the bar) latch the current selection: while a press is in
 * flight, and for PRESS_GRACE_MS after it, selectionchange does not update (so does not clear) it. After the grace the real native
 * selection is read again, so a press that never became a click does not leave a stale bar.
 */
export function useTextSelection(debounceMs = 300, doc: Document = document) {
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const pressing = useRef(false);
  const graceUntil = useRef(0);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = () => pressing.current || Date.now() < graceUntil.current;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (held()) return;
        setSelection(readSelection(doc.getSelection()));
      }, debounceMs);
    };
    doc.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      clearTimeout(graceTimer.current);
      doc.removeEventListener("selectionchange", onChange);
    };
  }, [debounceMs, doc]);
  const press = useCallback(() => {
    pressing.current = true;
    clearTimeout(graceTimer.current);
  }, []);
  const release = useCallback(() => {
    if (!pressing.current) return;
    pressing.current = false;
    graceUntil.current = Date.now() + PRESS_GRACE_MS;
    clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => setSelection(readSelection(doc.getSelection())), PRESS_GRACE_MS + 20);
  }, [doc]);
  /** 立刻读一次选区(全站长按选中词之后用,不等 300 ms 防抖);按住操作条期间与其后的宽限期内不读(R-L8)。 */
  const readNow = useCallback(() => {
    if (held()) return;
    setSelection(readSelection(doc.getSelection()));
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = useCallback(() => {
    pressing.current = false;
    graceUntil.current = 0;
    clearTimeout(graceTimer.current);
    setSelection(null);
    doc.getSelection()?.removeAllRanges();
  }, [doc]);
  return { selection, clear, press, release, readNow };
}
