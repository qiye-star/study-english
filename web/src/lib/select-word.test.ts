import { afterEach, describe, expect, it } from "vitest";
import { selectWord, selectWordAt, wordRangeAt } from "./select-word";

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

type CaretDoc = Omit<Document, "caretRangeFromPoint" | "caretPositionFromPoint"> & { caretRangeFromPoint?: unknown; caretPositionFromPoint?: unknown };
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

describe("wordRangeAt (tap-to-lookup marker)", () => {
  afterEach(() => {
    delete (document as CaretDoc).caretRangeFromPoint;
    delete (document as CaretDoc).caretPositionFromPoint;
    document.body.innerHTML = "";
  });

  it("returns a Range inside one text node around the word, with inner apostrophes and hyphens", () => {
    document.body.innerHTML = `<p id="p">it's a well-known fact</p>`;
    const text = document.getElementById("p")!.firstChild!;
    caretAt(text, 2);
    const a = wordRangeAt(1, 1)!;
    expect(a.toString()).toBe("it's");
    expect(a.startContainer).toBe(text);
    expect(a.endContainer).toBe(text);
    caretAt(text, 12);
    expect(wordRangeAt(1, 1)!.toString()).toBe("well-known");
  });

  it("does not change the selection", () => {
    document.body.innerHTML = `<p id="p">say hello</p>`;
    caretAt(document.getElementById("p")!.firstChild!, 5);
    wordRangeAt(1, 1);
    expect(String(document.getSelection())).toBe("");
  });

  it("is null on whitespace, punctuation, digits-only, CJK, outside `within`, an element caret, or without a caret API", () => {
    document.body.innerHTML = `<p id="p">a, 123 你好 ok</p><div id="other"></div>`;
    const text = document.getElementById("p")!.firstChild!;
    caretAt(text, 1);
    expect(wordRangeAt(1, 1)!.toString()).toBe("a");
    caretAt(text, 2);
    expect(wordRangeAt(1, 1)).toBeNull(); // the comma / space between words
    caretAt(text, 4);
    expect(wordRangeAt(1, 1)).toBeNull(); // 123
    caretAt(text, 8);
    expect(wordRangeAt(1, 1)).toBeNull(); // 你好
    caretAt(text, 11);
    expect(wordRangeAt(1, 1, document, document.getElementById("other")!)).toBeNull();
    caretAt(document.getElementById("p")!, 0);
    expect(wordRangeAt(1, 1)).toBeNull();
    delete (document as CaretDoc).caretRangeFromPoint;
    expect(wordRangeAt(1, 1)).toBeNull();
  });
});
