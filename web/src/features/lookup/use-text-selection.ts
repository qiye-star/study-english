import { useCallback, useEffect, useState } from "react";
import { normalizeSelection } from "./lookup";

export interface TextSelectionInfo {
  text: string;
  context: string;
}

export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";
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
  if (to - from > MAX_CONTEXT * 2) {
    // No usable punctuation nearby: take a window around the selection instead.
    from = Math.max(from, start - MAX_CONTEXT / 3);
    to = Math.min(to, from + MAX_CONTEXT * 2);
  }
  return normalizeSelection(raw.slice(from, to)).slice(0, MAX_CONTEXT);
}

export function readSelection(selection: Selection | null): TextSelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = normalizeSelection(selection.toString());
  if (!text) return null;
  const anchor = elementOf(selection.anchorNode)?.closest(LOOKUP_CONTEXT_SELECTOR);
  const focus = elementOf(selection.focusNode)?.closest(LOOKUP_CONTEXT_SELECTOR);
  if (!anchor || anchor !== focus) return null;
  if (elementOf(selection.anchorNode)?.closest(EDITABLE_SELECTOR) || elementOf(selection.focusNode)?.closest(EDITABLE_SELECTOR)) return null;
  const raw = anchor.textContent ?? "";
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(anchor);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const context = boundContext(raw, start, start + range.toString().length);
  return { text: text.slice(0, MAX_TEXT), context };
}

/** Reports the selection only after it has been stable for `debounceMs` (handle dragging fires selectionchange continuously). */
export function useTextSelection(debounceMs = 300, doc: Document = document) {
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setSelection(readSelection(doc.getSelection())), debounceMs);
    };
    doc.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      doc.removeEventListener("selectionchange", onChange);
    };
  }, [debounceMs, doc]);
  const clear = useCallback(() => {
    setSelection(null);
    doc.getSelection()?.removeAllRanges();
  }, [doc]);
  return { selection, clear };
}
