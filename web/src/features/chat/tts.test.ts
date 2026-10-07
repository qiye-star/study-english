import { describe, expect, it, vi } from "vitest";
import { TtsCache, speakableText, stripMarkdown, truncateAtSentence, ttsKey } from "./tts";
import { splitForSpeech } from "./sentence-stream";

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
  it("emphasis spanning a sentence boundary leaves no literal markers in the per-sentence TTS text (review W2)", () => {
    for (const reply of ["**One. Two.**", "__One. Two.__", "*One. Two.*", "_One. Two._", "***One. Two.***", "Say **this. And that** now."]) {
      const spoken = splitForSpeech(reply).map(speakableText);
      expect(spoken.length, reply).toBeGreaterThan(1);
      for (const s of spoken) expect(s, reply).not.toMatch(/[*_]/);
    }
    expect(splitForSpeech("**One. Two.**").map(speakableText)).toEqual(["One.", "Two."]);
    expect(splitForSpeech("Say **this. And that** now.").map(speakableText)).toEqual(["Say this.", "And that now."]);
    expect(splitForSpeech("*One, two. Three.*").map(speakableText)).toEqual(["One, two.", "Three."]);
    expect(splitForSpeech("Say __this. And that__ now.").map(speakableText)).toEqual(["Say this.", "And that now."]);
    expect(splitForSpeech("Say **this is it. And that one** now.").map(speakableText)).toEqual(["Say this is it.", "And that one now."]);
  });
  it("keeps asterisks and underscores that are not emphasis markers", () => {
    expect(speakableText("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(speakableText("use snake_case and a*b")).toBe("use snake_case and a*b");
    expect(speakableText("**Bold** and *it* and _it_")).toBe("Bold and it and it");
  });
  // review F3-I2:跨句强调的残留标记去掉了,但代码段里和正文里字面的 * / _ 必须原样读出。
  it.each<[string, string]>([
    ["In Python, `**kwargs` collects keyword arguments.", "In Python, **kwargs collects keyword arguments."],
    ["Call `foo(*args, **kwargs)` here.", "Call foo(*args, **kwargs) here."],
    ["Call foo(*args, **kwargs) here.", "Call foo(*args, **kwargs) here."],
    ["Call f(*rest) or g(**opts) now.", "Call f(*rest) or g(**opts) now."],
    ["Use `__init__` and `_x_`.", "Use __init__ and _x_."],
    ["Delete all *.txt files.", "Delete all *.txt files."],
    ["Match files with **/*.ts globs.", "Match files with **/*.ts globs."],
    ["Press Ctrl+* to zoom.", "Press Ctrl+* to zoom."],
    ["The regex a* matches zero or more a's.", "The regex a* matches zero or more a's."],
    ["Private members start with _name", "Private members start with _name"],
    ["Node gives you __dirname", "Node gives you __dirname"],
    ["The variable my_var_ is reserved.", "The variable my_var_ is reserved."],
    ["See https://example.com/some_page_ for more.", "See https://example.com/some_page_ for more."],
    ["2*3*4 is 24", "2*3*4 is 24"],
    ["use snake_case and user_id", "use snake_case and user_id"],
    ["* one\n* two", "one two"],
    ["**Note:** read it. **Really.**", "Note: read it. Really."],
    ["_Hmm_, maybe. Or _not_.", "Hmm, maybe. Or not."],
  ])("speakableText keeps literal markers and code spans verbatim (review F3-I2): %j", (input, expected) => {
    expect(speakableText(input)).toBe(expected);
    for (const sentence of splitForSpeech(input)) {
      const spoken = speakableText(sentence);
      expect(expected.replace(/\s+/g, " "), sentence).toContain(spoken);
    }
  });
  it("a code span inside a split cross-sentence emphasis keeps its markers (review F3-I2)", () => {
    expect(splitForSpeech("**Run `*.py`. Then `**kw`.**").map(speakableText)).toEqual(["Run *.py.", "Then **kw."]);
  });
  it("never splits a surrogate pair when truncating", () => {
    const text = "a".repeat(4095) + "😀" + "tail";
    const out = speakableText(text);
    expect(out).toBe("a".repeat(4095));
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(speakableText("a".repeat(4094) + "😀")).toBe("a".repeat(4094) + "😀");
  });
  it("truncates long text at the last sentence end within the limit (R7)", () => {
    const text = "This is a sentence. ".repeat(300).trim(); // 5999 字符
    const out = speakableText(text);
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(out.length).toBeGreaterThan(2048);
    expect(out.endsWith("sentence.")).toBe(true);
    expect(truncateAtSentence("Short. " + "x".repeat(5000), 4096)).toHaveLength(4096); // 句末太靠前:按码元截断
    expect(truncateAtSentence("Done! Next? Yes.", 4096)).toBe("Done! Next? Yes.");
    expect(truncateAtSentence(`He said "Stop." ${"y".repeat(10)}`, 16)).toBe(`He said "Stop."`);
  });
  it("cuts CJK text at a full-width terminator without needing whitespace", () => {
    const sentence = "这是一个句子\u3002";
    const out = speakableText(sentence.repeat(1000));
    expect(out.length).toBeLessThanOrEqual(4096);
    expect(out.length).toBeGreaterThan(2048);
    expect(out.endsWith("\u3002")).toBe(true);
    expect(truncateAtSentence("他说\u201c走\uff01\u201d" + "好".repeat(20), 8)).toBe("他说\u201c走\uff01\u201d");
    expect(truncateAtSentence("你好\uff1f" + "x".repeat(30), 10)).toHaveLength(10); // 句末太靠前
  });
  it("falls back to a safe cut with no punctuation and never splits a surrogate pair", () => {
    const out = truncateAtSentence("a".repeat(4095) + "\u{1F600}".repeat(10), 4096);
    expect(out).toBe("a".repeat(4095));
    expect(truncateAtSentence("\u{1F600}".repeat(3000), 4096)).toHaveLength(4096);
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
