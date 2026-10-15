import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTextSelection } from "./use-text-selection";

function selectWord(word: string) {
  const text = document.getElementById("c")!.firstChild!;
  const start = text.textContent!.indexOf(word);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + word.length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.innerHTML = ""; });

describe("useTextSelection.readNow (plan 2026-10-15 R-L3, R-L8)", () => {
  it("reads the selection at once, without waiting for the debounce", () => {
    document.body.innerHTML = `<p data-lookup-context id="c">ask not what your country can do</p>`;
    const { result } = renderHook(() => useTextSelection(10_000));
    selectWord("country");
    act(() => result.current.readNow());
    expect(result.current.selection?.text).toBe("country");
  });

  it("does nothing while the bar is pressed (the Android latch wins)", () => {
    document.body.innerHTML = `<p data-lookup-context id="c">ask not what your country can do</p>`;
    const { result } = renderHook(() => useTextSelection(10_000));
    act(() => result.current.press());
    selectWord("country");
    act(() => result.current.readNow());
    expect(result.current.selection).toBeNull();
  });
});
