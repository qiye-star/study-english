import { afterEach, describe, expect, it } from "vitest";
import { selectWord, selectWordAt } from "./select-word";

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

type CaretDoc = Document & { caretRangeFromPoint?: unknown; caretPositionFromPoint?: unknown };
const caretAt = (node: Node, offset: number) => {
  (document as CaretDoc).caretRangeFromPoint = () => {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    return r;
  };
};

describe("selectWordAt (plan 2026-10-15 R-L3)", () => {
  afterEach(() => {
    delete (document as CaretDoc).caretRangeFromPoint;
    delete (document as CaretDoc).caretPositionFromPoint;
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("selects the English word under the point", () => {
    document.body.innerHTML = `<p id="p">say hello there</p>`;
    caretAt(document.getElementById("p")!.firstChild!, 6);
    expect(selectWordAt(1, 1)).toBe(true);
    expect(String(document.getSelection())).toBe("hello");
  });

  it("prefers caretPositionFromPoint and trims a trailing apostrophe", () => {
    document.body.innerHTML = `<p id="p">the dogs' bowl</p>`;
    const text = document.getElementById("p")!.firstChild!;
    (document as CaretDoc).caretPositionFromPoint = () => ({ offsetNode: text, offset: 5 });
    (document as CaretDoc).caretRangeFromPoint = () => { throw new Error("must not be used"); };
    expect(selectWordAt(1, 1)).toBe(true);
    expect(String(document.getSelection())).toBe("dogs");
  });

  it("keeps a selection that already exists (the browser's own long-press wins)", () => {
    document.body.innerHTML = `<p id="p">say hello there</p>`;
    const text = document.getElementById("p")!.firstChild!;
    const r = document.createRange();
    r.setStart(text, 10);
    r.setEnd(text, 15);
    document.getSelection()!.addRange(r);
    caretAt(text, 6);
    expect(selectWordAt(1, 1)).toBe(false);
    expect(String(document.getSelection())).toBe("there");
  });

  it("does nothing on Chinese text, outside `within`, or without a caret API", () => {
    document.body.innerHTML = `<p id="zh">你好世界</p><p id="en">hello</p><div id="other"></div>`;
    caretAt(document.getElementById("zh")!.firstChild!, 1);
    expect(selectWordAt(1, 1)).toBe(false);
    caretAt(document.getElementById("en")!.firstChild!, 2);
    expect(selectWordAt(1, 1, document, document.getElementById("other")!)).toBe(false);
    delete (document as CaretDoc).caretRangeFromPoint;
    expect(selectWordAt(1, 1)).toBe(false);
    expect(String(document.getSelection())).toBe("");
  });
});
