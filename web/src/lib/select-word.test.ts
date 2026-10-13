import { afterEach, describe, expect, it } from "vitest";
import { selectWord } from "./select-word";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("selectWord (same contract as features/library/word-tap.ts)", () => {
  it("selects all the text of the element", () => {
    const root = mount('<p><span id="a">talk</span> <span id="b">about</span></p>');
    expect(selectWord(root.querySelector<HTMLElement>("#a")!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("talk");
  });

  it("moves the selection from one word to another when nothing else is selected by hand", () => {
    const root = mount('<p><span id="a">talk</span> <span id="b">about</span></p>');
    selectWord(root.querySelector<HTMLElement>("#a")!);
    expect(selectWord(root.querySelector<HTMLElement>("#b")!)).toBe(false); // a is still selected and differs from b's text
    window.getSelection()?.removeAllRanges();
    expect(selectWord(root.querySelector<HTMLElement>("#b")!)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("about");
  });

  it("does not override a selection the user dragged elsewhere", () => {
    const root = mount('<p id="p">some other text</p><span id="a">talk</span>');
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("#p")!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(selectWord(root.querySelector<HTMLElement>("#a")!)).toBe(false);
    expect(window.getSelection()?.toString()).toBe("some other text");
  });

  it("allows re-selecting the same text", () => {
    const root = mount('<span id="a">talk</span>');
    const el = root.querySelector<HTMLElement>("#a")!;
    expect(selectWord(el)).toBe(true);
    expect(selectWord(el)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("talk");
  });
});
