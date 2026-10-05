/** 把一段英文切成句子,供"跟读"面板使用。规则见计划裁定 R17:宁可少断,也不错断。 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k",
  "fig", "approx", "dept", "inc", "ltd", "co", "mt", "jan", "feb", "aug", "sept", "oct", "nov", "dec",
]);
const TERMINATORS = ".!?";
const CLOSERS = "\"'”’)]";
const OPENERS = /[A-Z0-9"“'‘([]/;

function isAbbreviation(line: string, dot: number): boolean {
  const token = line.slice(0, dot).match(/([A-Za-z.]+)$/)?.[1] ?? "";
  if (!token) return false;
  const lower = token.toLowerCase();
  return ABBREVIATIONS.has(lower) || /^[a-z]$/.test(lower); // 单个字母:姓名缩写 J. K.
}

function push(out: string[], piece: string): void {
  const text = piece.trim();
  if (/\p{L}/u.test(text)) out.push(text);
}

export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n+/)) {
    let start = 0;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "…" || (ch === "." && line.startsWith("...", i))) {
        i += ch === "…" ? 1 : 3; // 省略号从不断句
        while (line[i] === ".") i++;
        continue;
      }
      if (!TERMINATORS.includes(ch)) {
        i++;
        continue;
      }
      let end = i + 1;
      while (end < line.length && TERMINATORS.includes(line[end])) end++;
      while (end < line.length && CLOSERS.includes(line[end])) end++;
      const next = line.slice(end).match(/^\s+(\S)/)?.[1];
      const boundary = end >= line.length || (next !== undefined && OPENERS.test(next));
      if (boundary && !(ch === "." && isAbbreviation(line, i))) {
        push(out, line.slice(start, end));
        start = end;
      }
      i = end;
    }
    push(out, line.slice(start));
  }
  return out;
}
