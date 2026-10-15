import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHighlightStub } from "~/test/tap-lookup";
import { FALLBACK_ATTR, PENDING_HIGHLIGHT_NAME, createPendingMark } from "./pending-mark";

function wordRange(): Range {
  document.body.innerHTML = `<p id="p">say hello there</p>`;
  const range = document.createRange();
  range.setStart(document.getElementById("p")!.firstChild!, 4);
  range.setEnd(document.getElementById("p")!.firstChild!, 9);
  return range;
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("PendingMark with the CSS Custom Highlight API", () => {
  let stub: ReturnType<typeof installHighlightStub>;
  beforeEach(() => { stub = installHighlightStub(); });

  it("registers a Highlight under lookup-pending and replaces it on the next show", () => {
    const mark = createPendingMark();
    expect(mark.native).toBe(true);
    const a = wordRange();
    mark.show(a);
    expect(stub.registry.has(PENDING_HIGHLIGHT_NAME)).toBe(true);
    expect(stub.rangesOf(PENDING_HIGHLIGHT_NAME)).toEqual([a]);
    const b = a.cloneRange();
    mark.show(b);
    expect(stub.rangesOf(PENDING_HIGHLIGHT_NAME)).toEqual([b]);
    expect(document.querySelector(`[${FALLBACK_ATTR}]`)).toBeNull();
  });

  it("clear removes it (and is safe to call twice)", () => {
    const mark = createPendingMark();
    mark.show(wordRange());
    mark.clear();
    mark.clear();
    expect(stub.registry.has(PENDING_HIGHLIGHT_NAME)).toBe(false);
  });
});

describe("PendingMark fallback without the Highlight API", () => {
  const rectsOf = (range: Range, rects: Partial<DOMRect>[]) => {
    (range as unknown as { getClientRects: () => unknown }).getClientRects = () => rects;
  };

  it("draws one fixed underline per client rect and removes them on clear and on resize", () => {
    const mark = createPendingMark();
    expect(mark.native).toBe(false);
    const range = wordRange();
    rectsOf(range, [{ left: 10, bottom: 30, width: 40 }, { left: 0, bottom: 50, width: 0 }, { left: 5, bottom: 52, width: 12 }]);
    mark.show(range);
    const bars = document.querySelectorAll<HTMLElement>(`[${FALLBACK_ATTR}]`);
    expect(bars).toHaveLength(2);
    expect(bars[0].style.position).toBe("fixed");
    expect(bars[0].style.pointerEvents).toBe("none");
    expect(bars[0].style.left).toBe("10px");
    expect(bars[0].style.width).toBe("40px");
    window.dispatchEvent(new Event("resize"));
    expect(document.querySelectorAll(`[${FALLBACK_ATTR}]`)).toHaveLength(0);
    mark.show(range);
    mark.show(range); // showing again replaces, never stacks
    expect(document.querySelectorAll(`[${FALLBACK_ATTR}]`)).toHaveLength(2);
    mark.clear();
    expect(document.querySelectorAll(`[${FALLBACK_ATTR}]`)).toHaveLength(0);
  });

  it("does nothing when the engine cannot measure ranges", () => {
    const mark = createPendingMark();
    const range = wordRange();
    (range as unknown as { getClientRects?: unknown }).getClientRects = undefined;
    expect(() => mark.show(range)).not.toThrow();
    expect(document.querySelectorAll(`[${FALLBACK_ATTR}]`)).toHaveLength(0);
  });
});
