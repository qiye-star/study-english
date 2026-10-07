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

// 句末(R7):ASCII . ! ? … 后可跟引号/括号,且必须接空白;全角 。！？ 后可跟引号/括号,不需要空白
const SENTENCE_END = /[.!?…]["'”’)\]]*(\s)|[\u3002\uFF01\uFF1F]["'”’)\]\uFF09\u300D\u300F]*/g;

/** 超长时在 max 之内最后一个句末截断;句末早于 max/2 时退回按码元的安全截断。 */
export function truncateAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1); // 句末的空白恰好在第 max 位时也算
  let cut = -1;
  for (const m of head.matchAll(SENTENCE_END)) {
    const end = (m.index ?? 0) + m[0].length - (m[1] ? 1 : 0); // ASCII:空白的位置;CJK:标点之后
    if (end <= max) cut = end;
  }
  return cut >= max / 2 ? text.slice(0, cut).trimEnd() : truncateSafely(text, max);
}

const HTML_TAG =
  /<\/?(?:b|i|u|em|strong|a|p|br|div|span|ul|ol|li|code|pre|h[1-6]|blockquote|table|tr|td|th|img|sup|sub)(?=[\s/>])(?:\s[^<>\n]{0,200})?\/?>/gi;
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
// 代码段先换成占位符(私用区字符,不是空白也不是 \w),标记处理完再换回:代码里的 * _ < | 一律原样(review F3-I2)
const SLOT = /\uE000(\d+)\uE001/g;

function withCodeMasked(markdown: string, transform: (masked: string) => string): string {
  const code: string[] = [];
  const masked = markdown.replace(/[\uE000\uE001]/g, "").replace(CODE, (m) => `\uE000${code.push(m) - 1}\uE001`);
  return transform(masked).replace(SLOT, (_, i: string) => {
    const m = code[Number(i)];
    return m.startsWith("```") ? " " : m.slice(1, -1);
  });
}

function stripMasked(text: string): string {
  return text
    // 只剥常见 HTML 标签(白名单、单行、有长度上界),代码段已被遮住,不会吞掉 x<y、List<String>、<name> 之类的正文
    .replace(HTML_TAG, "")
    .replace(/!\[[^\]\n]{0,500}\]\([^)\n]{0,1000}\)/g, " ")
    .replace(/\[([^\]\n]{0,500})\]\([^)\n]{0,1000}\)/g, "$1")
    .replace(/^[ \t]{0,3}(?:(?:#{1,6}|[-*+]|\d+\.)[ \t]+|>[ \t]?)+/gm, "")
    .replace(/~~([^~\n]+?)~~/g, "$1")
    .replace(/^[ \t]*\|[ \t:|-]*$/gm, "")
    .replace(/^[ \t]*\|.*$/gm, (row) => row.replace(/\|/g, " "))
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(?<![A-Za-z0-9_])__([^_\n]+?)__(?![A-Za-z0-9_])/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1")
    .replace(/(?<![A-Za-z0-9_])_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9_])/g, "$1");
}

/**
 * 去掉 Markdown / 类 HTML 标记,保留换行(句子拆分按行切段;朗读再把空白压成一个空格)。
 * 只剥真正的标记:强调符须成对且位于词边界,`>`/`#` 只在行首作引用/标题标记,不误伤 snake_case、C#、a > b、5 * 3;
 * 行内代码只去掉反引号,内容原样;代码块整体去掉。
 * 所有量词都有上界或不跨行,保证对 100KB 级输入是线性的。
 */
export function stripMarkdown(markdown: string): string {
  return withCodeMasked(markdown, stripMasked);
}

const GLOB_OR_PATH = /^(?:\.[A-Za-z]|\/)/; // *.txt、**/*.ts、_/x
const ARGUMENT = /^[A-Za-z_]\w*\)/; // foo(*args, **kwargs):参数以 ) 结尾,或以 ( 开头、以 , 结尾
const FIRST_ARGUMENT = /^[A-Za-z_]\w*[,)]/;
const SENTENCE_END_TOKEN = /^\S*[.!?…]["'”’)\]]*$/;

/**
 * 逐句朗读时,跨句的强调会被切成两半("**One." / "Two.**"),stripMarkdown 只剥成对的标记。
 * 这里去掉贴在词边上、另一侧是空白/行首行尾/括号引号的 1–3 个 `*`/`_`,但保留字面用法(review F3-I2):
 * - 后面是 `.字母` 或 `/`(*.txt,以及 glob 的双星号加斜杠);前缀是函数参数(foo(*args, **kwargs));
 * - 句中的前缀 `_`/`__` 后面那个词不在句末(_name、__dirname);
 * - 后缀前面不是字母数字或收尾标点(Ctrl+*);单个后缀贴在字母数字后、后面是空白(a* matches、my_var_ is、URL 的 some_page_)。
 * 两侧都是空白(5 * 3)或两侧都是字符(a*b、snake_case)的本来就不匹配。代码段由调用方遮住,不受影响。
 */
function dropStrayEmphasis(text: string): string {
  return text
    .replace(/(^|[\s(["'“‘])([*_]{1,3})(?=[^\s*_])/g, (m, before: string, run: string, offset: number, all: string) => {
      const rest = all.slice(offset + m.length);
      if (GLOB_OR_PATH.test(rest)) return m;
      if (run[0] === "*" && (before === "(" ? FIRST_ARGUMENT : ARGUMENT).test(rest)) return m;
      if (run[0] === "_" && offset + before.length > 0 && !SENTENCE_END_TOKEN.test(rest.split(/\s/, 1)[0])) return m;
      return before;
    })
    .replace(/([^\s*_])([*_]{1,3})(?=$|[\s)\]"'”’.,!?;:])/g, (m, before: string, run: string, offset: number, all: string) => {
      const rest = all.slice(offset + m.length);
      if (GLOB_OR_PATH.test(rest)) return m;
      if (!/[A-Za-z0-9.,!?;:…)\]"'”’\uE001]/.test(before)) return m;
      if (run.length === 1 && /[A-Za-z0-9]/.test(before) && /^\s/.test(rest)) return m;
      return before;
    });
}

export function speakableText(markdown: string): string {
  const text = withCodeMasked(markdown, (masked) => dropStrayEmphasis(stripMasked(masked)));
  return truncateAtSentence(text.replace(/\s+/g, " ").trim(), MAX_TTS_INPUT);
}

export const sharedTtsCache = new TtsCache();
