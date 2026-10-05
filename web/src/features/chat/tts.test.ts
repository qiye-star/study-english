import { describe, expect, it, vi } from "vitest";
import { TtsCache, speakableText, stripMarkdown, ttsKey } from "./tts";

describe("tts helpers", () => {
  it("evicts least recently used urls and revokes them", () => {
    let n = 0;
    const urls = { create: vi.fn(() => `blob:${++n}`), revoke: vi.fn() };
    const cache = new TtsCache(2, urls);
    cache.set("a", new Blob(["a"]));
    cache.set("b", new Blob(["b"]));
    expect(cache.get("a")).toBe("blob:1");
    cache.set("c", new Blob(["c"]));
    expect(urls.revoke).toHaveBeenCalledWith("blob:2");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.set("a", new Blob(["x"]))).toBe("blob:1");
  });
  it("strips markdown before speaking", () => {
    expect(speakableText("# Title\n**Bold** `code` [link](http://x) and _it_\n- item\n```js\nx()\n```")).toBe("Title Bold code link and it item");
    expect(speakableText("x".repeat(5000))).toHaveLength(4096);
  });
  it("never splits a surrogate pair when truncating", () => {
    const text = "a".repeat(4095) + "😀" + "tail";
    const out = speakableText(text);
    expect(out).toBe("a".repeat(4095));
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(speakableText("a".repeat(4094) + "😀")).toBe("a".repeat(4094) + "😀");
  });
  it("keys by model, voice and text", () => {
    expect(ttsKey("m", "v", "t")).not.toBe(ttsKey("m", "v2", "t"));
  });
  it("strips markdown but keeps line breaks", () => {
    expect(stripMarkdown("# Title\n- **One** item\n- Two `code`\n[link](http://x) ![img](y)")).toBe("Title\nOne item\nTwo code\nlink  ");
  });
  it.each<[string, string]>([
    ["use snake_case here", "use snake_case here"],
    ["I know C# and C++", "I know C# and C++"],
    ["a > b", "a > b"],
    ["5 * 3", "5 * 3"],
    ["It costs ~5 dollars", "It costs ~5 dollars"],
    ["10 * 2 * 3", "10 * 2 * 3"],
    ["5*3*2", "5*3*2"],
    ["don't stop, it's fine", "don't stop, it's fine"],
    ["a < b and c > d", "a < b and c > d"],
    ["<b>hi</b>", "hi"],
    ["x <br/> y", "x  y"],
    ["a **bold** b", "a bold b"],
    ["a __bold__ b", "a bold b"],
    ["a *it* b", "a it b"],
    ["a _it_ b", "a it b"],
    ["a ~~gone~~ b", "a gone b"],
    ["## Head", "Head"],
    ["> quoted\n> > deeper", "quoted\ndeeper"],
    ["* one\n+ two\n1. three", "one\ntwo\nthree"],
    ["`a\nb`", "`a\nb`"],
    ["if x<y then go.\n> quote here", "if x<y then go.\nquote here"],
    ["x<y is true.\nIt means a -> b ok", "x<y is true.\nIt means a -> b ok"],
    ["x<y is true.\n```\na > b\n```\nok", "x<y is true.\n \nok"],
    ["Use <name> here", "Use <name> here"],
    ["List<String> items", "List<String> items"],
    ["`<b>`", "<b>"],
    ['<a href="http://x">link</a> and <BR/>', "link and "],
    ["| a | b |\n|---|:--|\n| 1 | 2 |\nx | y", "  a   b  \n\n  1   2  \nx | y"],
  ])("stripMarkdown keeps prose / strips markup: %j", (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it("handles normal and long link/image text with bounded patterns", () => {
    const long = "w".repeat(400);
    expect(stripMarkdown(`[${long}](http://x/${"p".repeat(500)})`)).toBe(long);
    expect(stripMarkdown("see [docs](http://a.b/c) ![alt text](img.png) end")).toBe("see docs   end");
  });

  it.each<[string, string]>([
    ["![ x50000", "![".repeat(50000)],
    ["[ x100000", "[".repeat(100000)],
    ["[a]( x25000", "[a](".repeat(25000)],
    ["* x50000", "*a ".repeat(30000)],
    ["_ x50000", "_a ".repeat(30000)],
    ["< x50000", "<a ".repeat(30000)],
  ])("stripMarkdown stays fast on adversarial input: %s", (_n, input) => {
    const t = performance.now();
    stripMarkdown(input);
    expect(performance.now() - t).toBeLessThan(1500);
  });
});
