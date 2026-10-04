import { describe, expect, it, vi } from "vitest";
import { TtsCache, speakableText, ttsKey } from "./tts";

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
});
