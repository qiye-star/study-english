import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPointerEvent, installHighlightStub, stubCaret, tapAt, unstubCaret } from "~/test/tap-lookup";
import { useTapLookup } from "./use-tap-lookup";

const SENTENCE = "ask not what your country can do for you";
const at = (word: string, inside = 2) => SENTENCE.indexOf(word) + inside;

let now = 0;
let navigateTo: (to: string) => void = () => undefined;
function Page({ enabled = true, onSelect }: { enabled?: boolean; onSelect: () => void }) {
  useTapLookup({ enabled, onSelect, now: () => now });
  navigateTo = useNavigate();
  return (
    <div>
      <p data-testid="ctx" data-lookup-context>{SENTENCE}</p>
      <p data-testid="plain">plain words here</p>
      <p data-testid="zh" data-lookup-context>你好世界</p>
      <a href="/x"><span data-testid="linked" data-lookup-context>linked words</span></a>
      <button type="button"><span data-testid="inbutton" data-lookup-context>button words</span></button>
      <div data-lookup-tap="off"><span data-testid="off" data-lookup-context>opted out words</span></div>
    </div>
  );
}

let highlights: ReturnType<typeof installHighlightStub>;
const mount = (props: { enabled?: boolean; onSelect?: () => void; route?: string } = {}) => {
  const onSelect = props.onSelect ?? vi.fn();
  const view = render(<MemoryRouter initialEntries={[props.route ?? "/practice"]}><Page enabled={props.enabled} onSelect={onSelect} /></MemoryRouter>);
  return { onSelect, ...view };
};
const marked = () => highlights.rangesOf("lookup-pending").map((r) => r.toString());
const ctx = () => screen.getByTestId("ctx");
const selected = () => window.getSelection()?.toString() ?? "";
const tapWord = (word: string, init: PointerEventInit = {}) => {
  stubCaret(ctx().firstChild!, at(word));
  tapAt(ctx(), 10, 10, init);
};

beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  now = 0;
  highlights = installHighlightStub();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  vi.useRealTimers();
  unstubCaret();
  window.getSelection()?.removeAllRanges();
  document.getElementById("zzz")?.remove();
});

describe("useTapLookup · mark and look up", () => {
  it("the first tap on a word underlines it with the highlight (no selection, no onSelect)", () => {
    const { onSelect } = mount();
    tapWord("country");
    expect(marked()).toEqual(["country"]);
    expect(selected()).toBe("");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("works for a pen too", () => {
    mount();
    tapWord("country", { pointerType: "pen" });
    expect(marked()).toEqual(["country"]);
  });

  it("the second tap on the same word selects it, calls onSelect and drops the marker", () => {
    const { onSelect } = mount();
    tapWord("country");
    tapWord("country", {});
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(marked()).toEqual([]);
  });

  it("the second tap may land on another letter of the same word", () => {
    const { onSelect } = mount();
    tapWord("country", {});
    stubCaret(ctx().firstChild!, at("country", 6));
    tapAt(ctx());
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a tap on another word moves the marker", () => {
    const { onSelect } = mount();
    tapWord("country");
    tapWord("what");
    expect(marked()).toEqual(["what"]);
    tapWord("what");
    expect(selected()).toBe("what");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("after a lookup the next tap on the word starts over with a marker", () => {
    mount();
    tapWord("country");
    tapWord("country");
    window.getSelection()?.removeAllRanges();
    tapWord("country");
    expect(marked()).toEqual(["country"]);
  });

  it("re-selects the word if the browser's own click collapses the selection right after the second tap", () => {
    const { onSelect } = mount();
    tapWord("country");
    tapWord("country");
    window.getSelection()?.removeAllRanges();
    fireEvent.click(ctx());
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(2);
    window.getSelection()?.removeAllRanges();
    fireEvent.click(ctx()); // only once
    expect(selected()).toBe("");
  });
});

describe("useTapLookup · what clears the marker", () => {
  it("tapping outside any lookup context, on CJK text or in a link / button / opted-out subtree", () => {
    mount();
    for (const id of ["plain", "linked", "inbutton", "off", "zh"]) {
      tapWord("country");
      expect(marked()).toEqual(["country"]);
      stubCaret(screen.getByTestId(id).firstChild!, 1);
      tapAt(screen.getByTestId(id));
      expect(marked()).toEqual([]);
    }
  });

  it("never marks in a link, a button, an opted-out subtree or non-Latin text", () => {
    mount();
    for (const id of ["plain", "linked", "inbutton", "off", "zh"]) {
      stubCaret(screen.getByTestId(id).firstChild!, 1);
      tapAt(screen.getByTestId(id));
      expect(marked()).toEqual([]);
    }
  });

  it("any scroll, including one in a nested container (capture phase)", () => {
    mount();
    tapWord("country");
    fireEvent.scroll(ctx());
    expect(marked()).toEqual([]);
    tapWord("country");
    fireEvent.scroll(document);
    expect(marked()).toEqual([]);
  });

  it("a resize and a pointercancel", () => {
    mount();
    tapWord("country");
    fireEvent(window, new Event("resize"));
    expect(marked()).toEqual([]);
    tapWord("country");
    fireEvent.pointerCancel(ctx(), { pointerId: 9, pointerType: "touch" });
    expect(marked()).toEqual([]);
  });

  it("6 seconds without a second tap; a later tap on the same word marks again instead of looking up", () => {
    vi.useFakeTimers();
    const { onSelect } = mount();
    tapWord("country");
    now = 5999;
    act(() => { vi.advanceTimersByTime(5999); });
    expect(marked()).toEqual(["country"]);
    now = 6000;
    act(() => { vi.advanceTimersByTime(1); });
    expect(marked()).toEqual([]);
    tapWord("country");
    expect(marked()).toEqual(["country"]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moving the marker restarts the 6 s clock", () => {
    vi.useFakeTimers();
    mount();
    tapWord("country");
    now = 4000;
    act(() => { vi.advanceTimersByTime(4000); });
    tapWord("what");
    now = 8000;
    act(() => { vi.advanceTimersByTime(4000); });
    expect(marked()).toEqual(["what"]);
    now = 10000;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(marked()).toEqual([]);
  });

  it("a route change", () => {
    mount();
    tapWord("country");
    act(() => navigateTo("/somewhere"));
    expect(marked()).toEqual([]);
  });

  it("a non-empty selection appearing (the bar showing)", () => {
    mount();
    tapWord("country");
    const r = document.createRange();
    r.selectNodeContents(screen.getByTestId("plain"));
    window.getSelection()?.addRange(r);
    fireEvent(document, new Event("selectionchange"));
    expect(marked()).toEqual([]);
  });

  it("disabling the hook (drawer open) and unmounting", () => {
    const { rerender, unmount } = mount();
    tapWord("country");
    rerender(<MemoryRouter><Page enabled={false} onSelect={vi.fn()} /></MemoryRouter>);
    expect(marked()).toEqual([]);
    tapWord("country");
    expect(marked()).toEqual([]);
    rerender(<MemoryRouter><Page enabled onSelect={vi.fn()} /></MemoryRouter>);
    tapWord("country");
    expect(marked()).toEqual(["country"]);
    unmount();
    expect(marked()).toEqual([]);
  });
});

describe("useTapLookup · what is not a tap", () => {
  it("a mouse click keeps native behaviour", () => {
    mount();
    tapWord("country", { pointerType: "mouse" });
    expect(marked()).toEqual([]);
    expect(selected()).toBe("");
  });

  it("movement over 8 px (a scroll or drag) is not a tap and marks nothing", () => {
    mount();
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(ctx(), { ...base, clientX: 10, clientY: 30 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 10, clientY: 30 });
    expect(marked()).toEqual([]);
    // an up far from the down without any move event (coalesced) is no tap either
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 40, clientY: 10 });
    expect(marked()).toEqual([]);
  });

  it("a small wobble (<= 8 px) still counts", () => {
    mount();
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(ctx(), { ...base, clientX: 14, clientY: 13 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 14, clientY: 13 });
    expect(marked()).toEqual(["country"]);
  });

  it("a long press (the browser's own selection) is not a tap and clears a marker", () => {
    mount();
    tapWord("what");
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 10, clientY: 10 };
    fireEvent.pointerDown(ctx(), base);
    now = 700;
    fireEvent.pointerUp(ctx(), base);
    expect(marked()).toEqual([]);
  });

  it("a second finger cancels the gesture and the marker", () => {
    mount();
    tapWord("what");
    stubCaret(ctx().firstChild!, at("country"));
    fireEvent.pointerDown(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(ctx(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(ctx(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    expect(marked()).toEqual([]);
    tapWord("country");
    expect(marked()).toEqual(["country"]); // the next single tap works again
  });

  it("does not mark while a selection exists (the user is selecting natively)", () => {
    mount();
    const r = document.createRange();
    r.selectNodeContents(screen.getByTestId("plain"));
    window.getSelection()?.addRange(r);
    tapWord("country");
    expect(marked()).toEqual([]);
    expect(selected()).toBe("plain words here");
  });

  it("is dead on pinned routes (library, changelog), alive elsewhere", () => {
    const lib = mount({ route: "/library/abc" });
    tapWord("country");
    expect(marked()).toEqual([]);
    lib.unmount();
    const log = mount({ route: "/practice/changelog" });
    tapWord("country");
    expect(marked()).toEqual([]);
    log.unmount();
    mount({ route: "/practice" });
    tapWord("country");
    expect(marked()).toEqual(["country"]);
  });

  it("does nothing without a caret-from-point API", () => {
    mount();
    unstubCaret();
    tapAt(ctx());
    expect(marked()).toEqual([]);
  });

  it("never calls preventDefault on the pointer events", () => {
    mount();
    stubCaret(ctx().firstChild!, at("country"));
    const down = new TestPointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    const up = new TestPointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    ctx().dispatchEvent(down);
    ctx().dispatchEvent(up);
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
  });
});
