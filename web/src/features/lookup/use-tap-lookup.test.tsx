import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TestPointerEvent, stubCaret, tapAt, unstubCaret } from "~/test/tap-lookup";
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

const mount = (props: { enabled?: boolean; onSelect?: () => void; route?: string } = {}) => {
  const onSelect = props.onSelect ?? vi.fn();
  const view = render(<MemoryRouter initialEntries={[props.route ?? "/practice"]}><Page enabled={props.enabled} onSelect={onSelect} /></MemoryRouter>);
  return { onSelect, ...view };
};
const ctx = () => screen.getByTestId("ctx");
const selected = () => window.getSelection()?.toString() ?? "";
const tapWord = (word: string, init: PointerEventInit = {}) => {
  stubCaret(ctx().firstChild!, at(word));
  tapAt(ctx(), 10, 10, init);
};
const selectPlain = () => {
  const r = document.createRange();
  r.selectNodeContents(screen.getByTestId("plain"));
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(r);
};

beforeAll(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  now = 0;
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});
afterEach(() => {
  vi.useRealTimers();
  unstubCaret();
  window.getSelection()?.removeAllRanges();
});

describe("useTapLookup · one tap looks up", () => {
  it("a single tap selects the word and calls onSelect once (no marker, no second tap)", () => {
    const { onSelect } = mount();
    tapWord("country");
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not register any CSS highlight", () => {
    mount();
    tapWord("country");
    expect((globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights).toBeUndefined();
  });

  it("works for a pen too", () => {
    const { onSelect } = mount();
    tapWord("country", { pointerType: "pen" });
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a tap on another word right after a lookup selects that word", () => {
    const { onSelect } = mount();
    tapWord("country");
    tapWord("what");
    expect(selected()).toBe("what");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("a tap on the same word again looks it up again", () => {
    const { onSelect } = mount();
    tapWord("country");
    window.getSelection()?.removeAllRanges();
    tapWord("country");
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("the tap on the lookup word keeps working after our own selection is still there", () => {
    const { onSelect } = mount();
    tapWord("country");
    tapWord("can");
    tapWord("for");
    expect(selected()).toBe("for");
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it("re-selects the word if the browser's own click collapses the selection right after the tap", () => {
    const { onSelect } = mount();
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

describe("useTapLookup · a user's own selection", () => {
  it("is only cleared by a tap, never replaced by a lookup", () => {
    const { onSelect } = mount();
    selectPlain();
    tapWord("country");
    expect(onSelect).not.toHaveBeenCalled();
    expect(selected()).toBe("plain words here");
  });

  it("a selection made after our own pick blocks the next lookup too", () => {
    const { onSelect } = mount();
    tapWord("country");
    selectPlain();
    tapWord("what");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(selected()).toBe("plain words here");
  });

  it("a tap once the user's selection is gone looks up again", () => {
    const { onSelect } = mount();
    selectPlain();
    window.getSelection()?.removeAllRanges();
    tapWord("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("useTapLookup · where a tap does nothing", () => {
  it("outside any lookup context, on CJK text, or in a link / button / opted-out subtree", () => {
    const { onSelect } = mount();
    for (const id of ["plain", "linked", "inbutton", "off", "zh"]) {
      stubCaret(screen.getByTestId(id).firstChild!, 1);
      tapAt(screen.getByTestId(id));
      expect(selected()).toBe("");
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("is dead on pinned routes (library, changelog), alive elsewhere", () => {
    const lib = mount({ route: "/library/abc" });
    tapWord("country");
    expect(selected()).toBe("");
    lib.unmount();
    const log = mount({ route: "/practice/changelog" });
    tapWord("country");
    expect(selected()).toBe("");
    log.unmount();
    mount({ route: "/practice" });
    tapWord("country");
    expect(selected()).toBe("country");
  });

  it("is off while disabled (drawer open) and stops on unmount", () => {
    const onSelect = vi.fn();
    const { rerender, unmount } = mount({ onSelect });
    rerender(<MemoryRouter><Page enabled={false} onSelect={onSelect} /></MemoryRouter>);
    tapWord("country");
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<MemoryRouter><Page enabled onSelect={onSelect} /></MemoryRouter>);
    tapWord("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
    unmount();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a route change does not break later taps", () => {
    const { onSelect } = mount();
    act(() => navigateTo("/somewhere"));
    tapWord("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("useTapLookup · desktop mouse single click", () => {
  const mouse = { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, clientX: 10, clientY: 10 };
  const clickWord = (word: string, init: PointerEventInit = {}) => {
    stubCaret(ctx().firstChild!, at(word));
    fireEvent.pointerDown(ctx(), { ...mouse, ...init });
    fireEvent.pointerUp(ctx(), { ...mouse, ...init });
  };

  it("a single left click on a word selects it and calls onSelect once", () => {
    const { onSelect } = mount();
    clickWord("country");
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a second click on another word looks that one up", () => {
    const { onSelect } = mount();
    clickWord("country");
    clickWord("what");
    expect(selected()).toBe("what");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("the second click of a native double-click (detail 2) is left to the browser", () => {
    const { onSelect } = mount();
    clickWord("country");
    clickWord("country", { detail: 2 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a right or middle button press is not a lookup", () => {
    const { onSelect } = mount();
    clickWord("country", { button: 2 });
    clickWord("country", { button: 1 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(selected()).toBe("");
  });

  it("a drag (movement over 8 px) keeps the native drag selection and does not look anything up", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    fireEvent.pointerDown(ctx(), mouse);
    fireEvent.pointerMove(ctx(), { ...mouse, clientX: 60, clientY: 10 });
    const r = document.createRange();
    r.selectNodeContents(screen.getByTestId("plain"));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
    fireEvent.pointerUp(ctx(), { ...mouse, clientX: 60, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(selected()).toBe("plain words here");
  });

  it("a long press over 450 ms is not a click", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    fireEvent.pointerDown(ctx(), mouse);
    now = 700;
    fireEvent.pointerUp(ctx(), mouse);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a click while the user has their own selection only clears it", () => {
    const { onSelect } = mount();
    selectPlain();
    clickWord("country");
    expect(onSelect).not.toHaveBeenCalled();
    expect(selected()).toBe("plain words here"); // the browser's mousedown would clear it; the hook never replaces it
  });

  it("a click after a lookup on a word inside a button or link is still not a lookup", () => {
    const { onSelect } = mount();
    stubCaret(screen.getByTestId("linked").firstChild!, 1);
    fireEvent.pointerDown(screen.getByTestId("linked"), mouse);
    fireEvent.pointerUp(screen.getByTestId("linked"), mouse);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("useTapLookup · what is not a tap", () => {
  it("movement over 8 px (a scroll or drag) is not a tap", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(ctx(), { ...base, clientX: 10, clientY: 30 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 10, clientY: 30 });
    expect(selected()).toBe("");
    // an up far from the down without any move event (coalesced) is no tap either
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 40, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a small wobble (<= 8 px) still counts", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
    fireEvent.pointerDown(ctx(), { ...base, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(ctx(), { ...base, clientX: 14, clientY: 13 });
    fireEvent.pointerUp(ctx(), { ...base, clientX: 14, clientY: 13 });
    expect(selected()).toBe("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a long press (the browser's own selection) is not a tap", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    const base = { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: 10, clientY: 10 };
    fireEvent.pointerDown(ctx(), base);
    now = 700;
    fireEvent.pointerUp(ctx(), base);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a second finger cancels the gesture; the next single tap works again", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    fireEvent.pointerDown(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(ctx(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(ctx(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
    tapWord("country");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("a pointercancel drops the press", () => {
    const { onSelect } = mount();
    stubCaret(ctx().firstChild!, at("country"));
    fireEvent.pointerDown(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(ctx(), { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(ctx(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does nothing without a caret-from-point API", () => {
    const { onSelect } = mount();
    unstubCaret();
    tapAt(ctx());
    expect(onSelect).not.toHaveBeenCalled();
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
