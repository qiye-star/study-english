import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/** Stubs `CSS.highlights` + `Highlight` (jsdom has neither); returns the registry. Undo with vi.unstubAllGlobals(). */
export function installHighlightStub() {
  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) { this.ranges = ranges; }
  }
  const registry = new Map<string, FakeHighlight>();
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { highlights: registry });
  return { registry, rangesOf: (name: string): Range[] => registry.get(name)?.ranges ?? [] };
}

/** jsdom has no PointerEvent: without one fireEvent builds a plain Event and drops clientX / pointerType / pointerId. */
export class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "touch";
    this.isPrimary = init.isPrimary ?? true;
  }
}

type CaretDoc = Omit<Document, "caretRangeFromPoint" | "caretPositionFromPoint"> & { caretRangeFromPoint?: unknown; caretPositionFromPoint?: unknown };

/** The next hit tests land at `offset` of `node` (a collapsed caret range). */
export function stubCaret(node: Node, offset: number): void {
  (document as CaretDoc).caretRangeFromPoint = () => {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    return r;
  };
}
export function unstubCaret(): void {
  delete (document as CaretDoc).caretRangeFromPoint;
  delete (document as CaretDoc).caretPositionFromPoint;
}

/** One finger tap on `el` at (x, y): pointerdown + pointerup (dispatch them separately for movement / long-press cases). */
export function tapAt(el: Element, x = 10, y = 10, init: PointerEventInit = {}): void {
  const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y, ...init };
  fireEvent.pointerDown(el, base);
  fireEvent.pointerUp(el, base);
}
