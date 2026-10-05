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

  clear(): void {
    for (const url of this.map.values()) {
      try {
        this.urls.revoke(url);
      } catch {
        /* ignore */
      }
    }
    this.map.clear();
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

/** 按 UTF-16 码元截断,但不劈开代理对(否则会留下孤立的高代理项)。 */
function truncateSafely(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * 去掉 Markdown / 类 HTML 标记,保留换行(句子拆分按行切段;朗读再把空白压成一个空格)。
 * 只剥真正的标记:强调符须成对且位于词边界,`>`/`#` 只在行首作引用/标题标记,不误伤 snake_case、C#、a > b、5 * 3。
 * 所有量词都有上界或不跨行,保证对 100KB 级输入是线性的。
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/<\/?[A-Za-z][^<>]*>/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/!\[[^\]\n]{0,500}\]\([^)\n]{0,1000}\)/g, " ")
    .replace(/\[([^\]\n]{0,500})\]\([^)\n]{0,1000}\)/g, "$1")
    .replace(/^[ \t]{0,3}(?:(?:#{1,6}|[-*+]|\d+\.)[ \t]+|>[ \t]?)+/gm, "")
    .replace(/~~([^~\n]+?)~~/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(?<![A-Za-z0-9_])__([^_\n]+?)__(?![A-Za-z0-9_])/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1")
    .replace(/(?<![A-Za-z0-9_])_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9_])/g, "$1");
}

export function speakableText(markdown: string): string {
  return truncateSafely(stripMarkdown(markdown).replace(/\s+/g, " ").trim(), MAX_TTS_INPUT);
}

export const sharedTtsCache = new TtsCache();
