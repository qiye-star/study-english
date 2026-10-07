/** 流式切句(计划 R7);与 server/app/sentence_split.py 同一规则,共享 server/tests/fixtures/sentence_cases.json。
 *  修改其中一边时必须同时修改另一边并补共享用例。缩写表复用 sentences.ts(与服务端表一致)。 */
import { ABBREVIATIONS } from "./sentences";

export const MAX_SENTENCE_CHARS = 200;
const TERMINATORS = ".!?";
const CJK_TERMINATORS = "。！？";
const CLOSERS = "\"'”’)]」』）";
const OPENER = /^[A-Z0-9"“'‘([]/;
const NEXT = /^\s+(\S)/;
const NEED_MORE = -1;

function isAbbreviation(text: string, dot: number): boolean {
  let start = dot;
  while (start > 0 && dot - start <= 10 && /[A-Za-z.]/.test(text[start - 1])) start--;
  if (dot - start > 10) return false;
  const token = text.slice(start, dot).toLowerCase();
  return !!token && (ABBREVIATIONS.has(token) || /^[a-z]$/.test(token));
}

/** [切点, 停下的位置];切点 null = 没有句末,NEED_MORE = 需要更多文本 */
function scan(s: string, final: boolean): [number | null, number] {
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "\n") return [i + 1, i];
    if (ch === "…" || s.startsWith("...", i)) {
      i += ch === "…" ? 1 : 3;
      while (i < n && s[i] === ".") i++;
      continue;
    }
    if (CJK_TERMINATORS.includes(ch)) {
      let end = i + 1;
      while (end < n && (CJK_TERMINATORS.includes(s[end]) || CLOSERS.includes(s[end]))) end++;
      if (end === n && !final) return [NEED_MORE, i];
      return [end, i];
    }
    if (TERMINATORS.includes(ch)) {
      let end = i + 1;
      while (end < n && TERMINATORS.includes(s[end])) end++;
      while (end < n && CLOSERS.includes(s[end])) end++;
      const rest = s.slice(end);
      if (!rest.trim()) return final ? [end, i] : [NEED_MORE, i];
      const m = NEXT.exec(rest);
      if (m && OPENER.test(m[1]) && !(ch === "." && isAbbreviation(s, i))) return [end, i];
      i = end;
      continue;
    }
    i++;
  }
  return [null, n];
}

/** 长度一律按 Unicode 码点计(与服务端一致):emoji 算 1,绝不从代理对中间切开。 */
function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** 前 n 个码点占用的 UTF-16 单元数(不足 n 个则为 s.length)。 */
function unitsOf(s: string, n: number): number {
  let i = 0;
  for (let k = 0; k < n && i < s.length; k++) {
    const c = s.charCodeAt(i);
    const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
    i += c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff ? 2 : 1;
  }
  return i;
}

function forcedCut(s: string, limit: number): number {
  const cap = unitsOf(s, limit);
  const head = s.slice(0, cap);
  for (const separators of [",;:", " "]) {
    const k = Math.max(...Array.from(separators, (c) => head.lastIndexOf(c)));
    if (k > 0) return k + 1;
  }
  return cap;
}

function clean(piece: string): string[] {
  const text = piece.trim();
  return /\p{L}/u.test(text) ? [text] : [];
}

export interface SentenceStream {
  /** full 是累计全文(onDelta(full));不是上次的延续时从头重来。 */
  push(full: string): string[];
  flush(): string[];
}

export function createSentenceStream(max = MAX_SENTENCE_CHARS): SentenceStream {
  let seen = "";
  let buf = "";
  const nextCut = (final: boolean): number | null => {
    const [cut, at] = scan(buf, final);
    if (cut !== null && cut !== NEED_MORE && cpLength(buf.slice(0, cut)) <= max) return cut;
    if (cpLength(buf) > max && (cut !== NEED_MORE || cpLength(buf.slice(0, at)) >= max)) return forcedCut(buf, max);
    if (cut === NEED_MORE) return null;
    return cut;
  };
  const drain = (final: boolean): string[] => {
    const out: string[] = [];
    while (buf) {
      const cut = nextCut(final);
      if (cut === null) break;
      out.push(...clean(buf.slice(0, cut)));
      buf = buf.slice(cut);
    }
    return out;
  };
  return {
    push(full) {
      // 块可能停在代理对中间:孤立的高位代理留到下一块再处理,保证与分块方式无关。
      const last = full.charCodeAt(full.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) full = full.slice(0, -1);
      if (!full.startsWith(seen)) {
        seen = "";
        buf = "";
      }
      buf += full.slice(seen.length);
      seen = full;
      return drain(false);
    },
    flush() {
      const out = drain(true);
      const rest = buf;
      buf = "";
      return [...out, ...clean(rest)];
    },
  };
}

export function splitForSpeech(text: string): string[] {
  const s = createSentenceStream();
  return [...s.push(text), ...s.flush()];
}
