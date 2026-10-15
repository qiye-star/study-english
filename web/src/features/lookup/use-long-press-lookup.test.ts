import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectWordAt } from "~/lib/select-word";
import { useLongPressLookup } from "./use-long-press-lookup";

vi.mock("~/lib/select-word", () => ({ selectWordAt: vi.fn(() => true) }));

// jsdom has no PointerEvent: build a MouseEvent and define the pointer fields (same reason as choice-question-after.test.tsx).
type Init = { x?: number; y?: number; id?: number; kind?: string; primary?: boolean };
function pointer(el: Element, type: string, { x = 20, y = 20, id = 1, kind = "touch", primary = true }: Init = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(e, { pointerId: { value: id }, pointerType: { value: kind }, isPrimary: { value: primary } });
  el.dispatchEvent(e);
  return e;
}

let clock = 0;
const now = () => clock;
const onSelect = vi.fn();
const mount = (on = true) =>
  renderHook(({ enabled }) => useLongPressLookup({ enabled, onSelect, now }), { initialProps: { enabled: on } });
const el = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  onSelect.mockClear();
  vi.mocked(selectWordAt).mockClear();
  vi.mocked(selectWordAt).mockReturnValue(true);
  document.body.innerHTML = `
    <p data-lookup-context id="ctx">say <b id="w">hello</b> there <a id="link" href="#">link</a></p>
    <p id="plain">plain text</p>
    <div data-lookup-press="own"><span data-lookup-context id="own">talk</span></div>
    <button id="bar">look up</button>`;
});
afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("useLongPressLookup (plan 2026-10-15 R-L3)", () => {
  it("selects the pressed word after 450 ms without moving and reports it", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 30, y: 40 });
    vi.advanceTimersByTime(449);
    expect(selectWordAt).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(selectWordAt).toHaveBeenCalledWith(30, 40, document, el("ctx"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("ignores mouse and pen", () => {
    mount();
    pointer(el("w"), "pointerdown", { kind: "mouse" });
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown", { kind: "pen" });
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("ignores text outside a context, a link inside one and rows that own their long-press (R-L2, R-L6)", () => {
    mount();
    for (const id of ["plain", "link", "own", "bar"]) {
      pointer(el(id), "pointerdown");
      vi.advanceTimersByTime(500);
    }
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("cancels on a move over 8 px, an early lift, a scroll or a second finger", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 20, y: 20 });
    pointer(el("w"), "pointermove", { x: 29, y: 20 });
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(200);
    pointer(el("w"), "pointerup");
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(500);
    pointer(el("w"), "pointerdown");
    pointer(el("w"), "pointerdown", { id: 2, primary: false });
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });

  it("still fires after a move of exactly 8 px", () => {
    mount();
    pointer(el("w"), "pointerdown", { x: 20, y: 20 });
    pointer(el("w"), "pointermove", { x: 28, y: 20 });
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
  });

  it("keeps the timer through an unmoved pointercancel (the browser took over), not a moved one", () => {
    mount();
    pointer(el("w"), "pointerdown");
    pointer(el("w"), "pointercancel");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
    pointer(el("w"), "pointerdown", { x: 20 });
    pointer(el("w"), "pointermove", { x: 40 });
    pointer(el("w"), "pointercancel");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).toHaveBeenCalledTimes(1);
  });

  it("keeps a selection the browser already made and only reports it", () => {
    mount();
    const range = document.createRange();
    range.selectNodeContents(el("w"));
    window.getSelection()!.addRange(range);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    expect(selectWordAt).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when no word was under the finger", () => {
    vi.mocked(selectWordAt).mockReturnValue(false);
    mount();
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("swallows only the first click inside the pressed text within 400 ms of release (R-L5)", () => {
    mount();
    const clicked = vi.fn();
    el("w").addEventListener("click", clicked);
    const barClicked = vi.fn();
    el("bar").addEventListener("click", barClicked);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(450);
    clock += 600;
    pointer(el("w"), "pointerup");
    clock += 100;
    el("bar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(barClicked).toHaveBeenCalledTimes(1); // outside the pressed text: never swallowed
    const first = new MouseEvent("click", { bubbles: true, cancelable: true });
    el("w").dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
    el("w").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("lets the click of a short tap through", () => {
    mount();
    const clicked = vi.fn();
    el("w").addEventListener("click", clicked);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(100);
    pointer(el("w"), "pointerup");
    el("w").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled and stops on unmount", () => {
    const { rerender, unmount } = mount(false);
    pointer(el("w"), "pointerdown");
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
    rerender({ enabled: true });
    pointer(el("w"), "pointerdown");
    unmount();
    vi.advanceTimersByTime(500);
    expect(selectWordAt).not.toHaveBeenCalled();
  });
});
