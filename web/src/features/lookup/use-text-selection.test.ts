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
  it("centres the window on the selection when the sentence is longer than the context limit", () => {
    // one 450-character sentence; the selected word sits in its second half
    const filler = Array.from({ length: 100 }, (_, i) => "w" + String(i).padStart(3, "0")).join(" ");
    const raw = filler.slice(0, 380) + "needle" + filler.slice(386, 450);
    expect(raw).toHaveLength(450);
    document.body.innerHTML = `<div data-lookup-context id="a">${raw}</div>`;
    const text = document.getElementById("a")!.firstChild!;
    const start = raw.indexOf("needle");
    const info = readSelection(select(text, start, text, start + 6))!;
    expect(info.text).toBe("needle");
    expect(info.context).toContain("needle");
    expect(info.context.length).toBeLessThanOrEqual(300);
    expect(info.context.length).toBeGreaterThan(200);
  });
  it("keeps a selection near the end of a long sentence inside the context", () => {
    const raw = "word ".repeat(100) + "needle" + " word".repeat(2) + ".";
    document.body.innerHTML = `<div data-lookup-context id="a">${raw}</div>`;
    const text = document.getElementById("a")!.firstChild!;
    const start = raw.indexOf("needle");
    const info = readSelection(select(text, start, text, start + 6))!;
    expect(info.context).toContain("needle");
    expect(info.context.length).toBeLessThanOrEqual(300);
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

describe("readSelection one-sided spill", () => {
  afterEach(() => { window.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });
  it("clamps a selection whose far end lands outside any context to the context of the other end", () => {
    document.body.innerHTML = `<div id="bubble"><div data-lookup-context id="ctx"><p>Hello wonderful world</p></div><div id="actions"><button>Listen</button></div></div>`;
    const text = document.querySelector("#ctx p")!.firstChild!;
    const label = document.querySelector("#actions button")!.firstChild!;
    expect(readSelection(select(text, 6, label, 3))).toEqual({ text: "wonderful world", context: "Hello wonderful world" });
  });
  it("still rejects selections spanning two different contexts", () => {
    setup();
    const a = document.getElementById("a")!.firstChild!;
    const b = document.getElementById("b")!.firstChild!;
    expect(readSelection(select(a, 0, b, 3))).toBeNull();
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
  it("ignores a collapse while a press is in flight and for a grace after, then reads the real selection", () => {
    vi.useFakeTimers();
    setup();
    const { result } = renderHook(() => useTextSelection(300));
    const a = document.getElementById("a")!.firstChild!;
    act(() => { select(a, 0, a, 3); document.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(300); });
    expect(result.current.selection?.text).toBe("Ask");
    act(() => result.current.press());
    act(() => { window.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(1000); });
    expect(result.current.selection?.text).toBe("Ask");
    act(() => result.current.release());
    act(() => { document.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(300); });
    expect(result.current.selection?.text).toBe("Ask"); // still inside the grace
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.selection).toBeNull(); // grace over: the real (collapsed) selection wins
    vi.useRealTimers();
  });
});
