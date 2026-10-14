import { type ApiClient } from "~/api/client";
import { inflightDedupe, withSignal } from "~/lib/abortable";
import { normalizeSelection, type LookupResult } from "./lookup";

/** 本地词典命中(服务端 POST /api/dictionary/lookup,计划 B R-L4)。网页只关心命中;未命中 / 出错都是 null。 */
export type DictDefLang = "both" | "zh" | "en";
export interface DictDef { pos: string; text: string }
export interface DictPhrase { en: string; zh: string }
export interface DictEntry {
  word: string;
  lemma?: string;
  phonetic?: string;
  defsZh: DictDef[];
  defsEn: DictDef[];
  phrases: DictPhrase[];
  defLang: DictDefLang;
}

const MAX_TEXT = 1000;
const TIMEOUT_MS = 8_000;
const MAX_PHRASES = 3;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function defs(value: unknown): DictDef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((d) => (isObj(d) && str(d.text).trim() ? [{ pos: str(d.pos), text: str(d.text) }] : []));
}

/** 防御式解析:未命中、形状不对、没有任何释义都返回 null。`defLang` 缺省 / 未知按「仅英文」(spec D1)。 */
export function parseDictionaryResponse(raw: unknown): DictEntry | null {
  if (!isObj(raw) || raw.hit !== true || !str(raw.word)) return null;
  const defsZh = defs(raw.defsZh);
  const defsEn = defs(raw.defsEn);
  if (!defsZh.length && !defsEn.length) return null;
  const phrases = Array.isArray(raw.phrases)
    ? raw.phrases.flatMap((p) => (isObj(p) && str(p.en) ? [{ en: str(p.en), zh: str(p.zh) }] : [])).slice(0, MAX_PHRASES)
    : [];
  const defLang: DictDefLang = raw.defLang === "both" || raw.defLang === "zh" || raw.defLang === "en" ? raw.defLang : "en";
  return {
    word: str(raw.word),
    ...(str(raw.lemma) ? { lemma: str(raw.lemma) } : {}),
    ...(str(raw.phonetic) ? { phonetic: str(raw.phonetic) } : {}),
    defsZh, defsEn, phrases, defLang,
  };
}

const dedupe = inflightDedupe<DictEntry | null>();

/**
 * 词只在 POST 体里。同一个词的飞行中请求共用一次(预取与点击撞在一起时);不缓存结果(含用户的 def_lang 偏好)。
 * 任何错误(含 429、404、超时)都会抛出,调用方当作未命中。
 */
export function lookupDictionary(api: ApiClient, text: string, signal?: AbortSignal): Promise<DictEntry | null> {
  const clean = normalizeSelection(text).slice(0, MAX_TEXT);
  return withSignal(dedupe(JSON.stringify(clean.toLowerCase()), async () =>
    parseDictionaryResponse(await api.request("POST", "/api/dictionary/lookup", { json: { text: clean }, timeoutMs: TIMEOUT_MS }))), signal);
}

/** 抽屉里显示哪些行(spec D2):有效偏好 en 而没有英文释义 → 补显中文;偏好 zh 显示中文;两边都空时有什么显示什么。 */
export function visibleDefs(entry: Pick<DictEntry, "defLang" | "defsZh" | "defsEn">): { zh: DictDef[]; en: DictDef[] } {
  const showEn = entry.defLang !== "zh" && entry.defsEn.length > 0;
  const showZh = entry.defLang !== "en" || entry.defsEn.length === 0;
  const zh = showZh ? entry.defsZh : [];
  const en = showEn ? entry.defsEn : [];
  return !zh.length && !en.length ? { zh: entry.defsZh, en: entry.defsEn } : { zh, en };
}

/**
 * 抽屉的「中文」按钮(计划 2026-10-14-review-bilingual-longpress R-Z4):偏好 en 且有英文释义时,中文释义与短语译文默认藏起,
 * `peek`(用户按了「中文」)带回;`canPeek` = 有中文可带回。其余情况与 visibleDefs 相同、没有按钮。纯函数,不缓存。
 */
export function drawerDefs(
  entry: Pick<DictEntry, "defLang" | "defsZh" | "defsEn" | "phrases">,
  peek = false,
): { zh: DictDef[]; en: DictDef[]; phraseZh: boolean; canPeek: boolean } {
  const hidesZh = entry.defLang === "en" && entry.defsEn.length > 0;
  const { zh, en } = visibleDefs(entry);
  return {
    zh: hidesZh && peek ? entry.defsZh : zh,
    en,
    phraseZh: !hidesZh || peek,
    canPeek: hidesZh && (entry.defsZh.length > 0 || entry.phrases.some((p) => p.zh.trim() !== "")),
  };
}

const EN_POS: Record<string, string> = {
  n: "n.", v: "v.", a: "adj.", r: "adv.", prep: "prep.", pron: "pron.", conj: "conj.", art: "art.", num: "num.", aux: "aux.", int: "interj.",
};
export const enPosLabel = (pos: string): string => EN_POS[pos] ?? pos;

/** 词典命中 → 既有的 LookupResult,供 wordTargetFromLookup 生成「加入生词本」的 target(释义 = 词性 · 中文 · 英文)。 */
export function dictToLookup(entry: DictEntry): LookupResult {
  const zh = entry.defsZh.slice(0, 2).map((d) => (d.pos ? `${d.pos}. ${d.text}` : d.text)).join("；");
  return {
    word: entry.word, lemma: entry.lemma ?? "", pronunciation: entry.phonetic ?? "", pos: "",
    definition: entry.defsEn[0]?.text ?? "", translation: zh, contextTranslation: "",
  };
}

/** 还没有词典结果时「加入」按钮用的空结果(只有词本身)。 */
export const bareLookup = (word: string): LookupResult =>
  ({ word, lemma: "", pronunciation: "", pos: "", definition: "", translation: "", contextTranslation: "" });
