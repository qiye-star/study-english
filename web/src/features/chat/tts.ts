export const MAX_TTS_INPUT = 4096;

export function ttsKey(model: string, voice: string, text: string): string {
  return [model, voice, text].join("\u0000");
}

interface UrlFactory {
  create(blob: Blob): string;
  revoke(url: string): void;
}

/** 朗读音频只缓存在内存里(设计文档 4.1:TTS 第一版不落盘)。 */
export class TtsCache {
  private readonly map = new Map<string, string>();
  constructor(
    private readonly max = 50,
    private readonly urls: UrlFactory = { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
  ) {}

  get(key: string): string | undefined {
    const url = this.map.get(key);
    if (url) {
      this.map.delete(key);
      this.map.set(key, url);
    }
    return url;
  }

  set(key: string, blob: Blob): string {
    const existing = this.get(key);
    if (existing) return existing;
    const url = this.urls.create(blob);
    this.map.set(key, url);
    while (this.map.size > this.max) {
      const [oldKey, oldUrl] = this.map.entries().next().value as [string, string];
      this.map.delete(oldKey);
      this.urls.revoke(oldUrl);
    }
    return url;
  }
}

export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TTS_INPUT);
}

export const sharedTtsCache = new TtsCache();
