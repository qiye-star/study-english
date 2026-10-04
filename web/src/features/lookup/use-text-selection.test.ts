import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSelection, useTextSelection } from "./use-text-selection";

function setup() {
  document.body.innerHTML = `
    <div data-lookup-context id="a">Ask not what your   country can do</div>
    <div data-lookup-context id="b">Second block</div>
    <p id="c">outside</p>`;
}

function select(node: Node, start: number, endNode: Node = node, end = start) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(endNode, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("readSelection", () => {
  afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

  it("returns the selected text and its context", () => {
    setup();
    const text = document.getElementById("a")!.firstChild!;
    const start = text.textContent!.indexOf("country");
    expect(readSelection(select(text, start, text, start + 7))).toEqual({ text: "country", context: "Ask not what your country can do" });
  });
  it("ignores collapsed, outside and cross-context selections", () => {
    setup();
    const a = document.getElementById("a")!.firstChild!;
    expect(readSelection(select(a, 2))).toBeNull();
    const c = document.getElementById("c")!.firstChild!;
    expect(readSelection(select(c, 0, c, 3))).toBeNull();
    const b = document.getElementById("b")!.firstChild!;
    expect(readSelection(select(a, 0, b, 3))).toBeNull();
    expect(readSelection(null)).toBeNull();
  });
  it("bounds the context to the sentence around a selection in long text", () => {
    const filler = "Lorem ipsum dolor sit amet ".repeat(40);
    document.body.innerHTML = `<div data-lookup-context id="a">${filler}. The quick brown fox jumps. ${filler}</div>`;
    const text = document.getElementById("a")!.firstChild!;
    const start = text.textContent!.indexOf("fox");
    const info = readSelection(select(text, start, text, start + 3))!;
    expect(info.text).toBe("fox");
    expect(info.context).toBe("The quick brown fox jumps.");
  });
  it("hard-bounds the context when there is no sentence punctuation", () => {
    const long = "word ".repeat(400);
    document.body.innerHTML = `<div data-lookup-context id="a">${long}</div>`;
    const text = document.getElementById("a")!.firstChild!;
    const info = readSelection(select(text, 1000, text, 1004))!;
    expect(info.context.length).toBeLessThanOrEqual(300);
    expect(info.context).toContain("word");
  });
  it("ignores selections inside form fields", () => {
    document.body.innerHTML = `<div data-lookup-context><textarea id="t">hello world</textarea></div>`;
    const ta = document.getElementById("t")!;
    const range = document.createRange();
    range.setStart(ta.firstChild!, 0);
    range.setEnd(ta.firstChild!, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(readSelection(sel)).toBeNull();
  });
});

describe("useTextSelection", () => {
  afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

  it("debounces selectionchange", () => {
    vi.useFakeTimers();
    setup();
    const { result } = renderHook(() => useTextSelection(300));
    const a = document.getElementById("a")!.firstChild!;
    act(() => { select(a, 0, a, 3); document.dispatchEvent(new Event("selectionchange")); });
    expect(result.current.selection).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.selection?.text).toBe("Ask");
    act(() => result.current.clear());
    expect(result.current.selection).toBeNull();
    vi.useRealTimers();
  });
  it("only acts on the final selection while handles are dragged", () => {
    vi.useFakeTimers();
    setup();
    const { result } = renderHook(() => useTextSelection(300));
    const a = document.getElementById("a")!.firstChild!;
    for (const end of [2, 5, 8]) {
      act(() => { select(a, 0, a, end); document.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(100); });
    }
    expect(result.current.selection).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.selection?.text).toBe("Ask not");
    vi.useRealTimers();
  });
});
