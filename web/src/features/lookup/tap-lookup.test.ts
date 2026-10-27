import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TAP_MAX_MS, TAP_SLOP_PX, isTap, isUserSelection, sameRange } from "./tap-lookup";

describe("isTap (single-tap lookup gesture)", () => {
  const o = { x: 0, y: 0 };

  it("accepts a press that stayed within 8 px and 450 ms", () => {
    expect(isTap(o, { x: TAP_SLOP_PX, y: 0 }, TAP_MAX_MS)).toBe(true);
    expect(isTap(o, { x: 3, y: 4 }, 0)).toBe(true);
  });

  it("rejects movement over 8 px and holds over 450 ms", () => {
    expect(isTap(o, { x: TAP_SLOP_PX + 1, y: 0 }, 0)).toBe(false);
    expect(isTap(o, o, TAP_MAX_MS + 1)).toBe(false);
  });
});

describe("sameRange / isUserSelection", () => {
  const paragraph = () => {
    const p = document.createElement("p");
    p.textContent = "alpha beta gamma";
    document.body.appendChild(p);
    return p.firstChild!;
  };
  const range = (node: Node, start: number, end: number) => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  };
  let node: Node;
  beforeEach(() => { node = paragraph(); });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("compares boundaries, not object identity", () => {
    expect(sameRange(range(node, 0, 5), range(node, 0, 5))).toBe(true);
    expect(sameRange(range(node, 0, 5), range(node, 0, 4))).toBe(false);
  });

  it("is false for no selection, a collapsed one, blank text, or the word we selected ourselves", () => {
    const sel = window.getSelection()!;
    expect(isUserSelection(null, null)).toBe(false);
    expect(isUserSelection(sel, null)).toBe(false);
    sel.addRange(range(node, 2, 2));
    expect(isUserSelection(sel, null)).toBe(false);
    sel.removeAllRanges();
    sel.addRange(range(node, 6, 10));
    expect(isUserSelection(sel, range(node, 6, 10))).toBe(false);
  });

  it("is true for a selection the user made (anything but the word we picked)", () => {
    const sel = window.getSelection()!;
    sel.addRange(range(node, 0, 11));
    expect(isUserSelection(sel, null)).toBe(true);
    expect(isUserSelection(sel, range(node, 6, 10))).toBe(true);
  });
});
