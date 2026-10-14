import type { ApiClient } from "~/api/client";
import { LIBRARY_SERVER_ERRORS } from "./library-api";

/** 某一句的成绩汇总(GET …/attempts 的一行,spec §9)。 */
export interface SegmentBest {
  segIdx: number;
  bestScore: number | null;
  count: number;
  lastAt: string | null;
}

/** 一句的起止与文字(与 GET /api/library/items/{id} 的 segments 同形,camelCase;W1 的 LibrarySegment 是它的超集)。 */
export interface SavedSegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * PATCH 回包 `{segment}` 的 D8 字段(契约夹具:`zh` / `zh_lang` / `has_analysis` / `analysis_lang`;分析正文不在句子里,
 * 只在 POST analysis 的回包里)。只有回包带了这些键才出现;与 W1 的 `LibrarySegment` 同名同形。
 */
export type SegmentWithAi = SavedSegment & {
  zh?: string | null;
  zhLang?: string | null;
  hasAnalysis?: boolean;
  analysisLang?: string | null;
  /** plan v2 R-V14:时间可疑的原因码;服务端在时间被改后清空 */
  flags?: string[];
};

export interface SegmentPatch {
  startMs?: number;
  endMs?: number;
  text?: string;
}

/**
 * 改句 / 记成绩 / 分析的服务端错误 → 文案键。键 = `server/app/library/errors.py::API_ERRORS` 的固定英文文本
 * (已对照 `server/tests/fixtures/library_contract.json` 的 `errors`);W1 的 `LIBRARY_SERVER_ERRORS` 作底,
 * 这里只把「句子 / 条目不存在」「时间 / 文字不合法」换成本车道更具体的文案。AI 额度与开关按状态码处理(429 / 404),不靠文本。
 */
export const SHADOW_SERVER_ERRORS: Record<string, string> = {
  ...LIBRARY_SERVER_ERRORS,
  "Not Found": "web.library.shadow.errors.notFound",
  "Sentence not found": "web.library.shadow.errors.notFound",
  "Invalid sentence times": "web.library.shadow.errors.badTimes",
  "Invalid sentence text": "web.library.shadow.errors.badText",
};

const itemPath = (itemId: string) => `/api/library/items/${encodeURIComponent(itemId)}`;

function toBest(row: unknown): SegmentBest[] {
  const r = row as Partial<SegmentBest> | null;
  if (!r || typeof r.segIdx !== "number") return [];
  return [{
    segIdx: r.segIdx,
    bestScore: typeof r.bestScore === "number" ? r.bestScore : null,
    count: typeof r.count === "number" ? r.count : 0,
    lastAt: typeof r.lastAt === "string" ? r.lastAt : null,
  }];
}

/** 每句最好成绩;接受裸数组或 {attempts: [...]}(R-SH11)。 */
export async function listAttempts(api: ApiClient, itemId: string, signal?: AbortSignal): Promise<SegmentBest[]> {
  const res = await api.request<unknown>("GET", `${itemPath(itemId)}/attempts`, { signal });
  const rows = Array.isArray(res) ? res : (res as { attempts?: unknown } | null)?.attempts;
  return Array.isArray(rows) ? rows.flatMap(toBest) : [];
}

/** 记一次跟读成绩;服务端核对评测属于本人、source=library、参考文本与该句一致(spec §9)。响应不读。 */
export function recordAttempt(api: ApiClient, itemId: string, input: { segIdx: number; assessmentId: string }): Promise<unknown> {
  return api.request("POST", `${itemPath(itemId)}/attempts`, { json: input });
}

/** 改一句的起止 / 文字。回包 `{segment}`(契约夹具);也接受裸句子或空体,缺的字段用本地值补。回包带的 D8 字段原样带回。 */
export async function patchSegment(api: ApiClient, itemId: string, idx: number, patch: SegmentPatch, base: SavedSegment): Promise<SegmentWithAi> {
  const res = await api.request<unknown>("PATCH", `${itemPath(itemId)}/segments/${encodeURIComponent(String(idx))}`, { json: patch });
  const inner = res && typeof res === "object" && "segment" in res ? (res as { segment: unknown }).segment : res;
  const r = (inner && typeof inner === "object" ? inner : {}) as Partial<SegmentWithAi>;
  const saved: SegmentWithAi = {
    idx: base.idx,
    startMs: typeof r.startMs === "number" ? r.startMs : patch.startMs ?? base.startMs,
    endMs: typeof r.endMs === "number" ? r.endMs : patch.endMs ?? base.endMs,
    text: typeof r.text === "string" ? r.text : patch.text ?? base.text,
  };
  if ("zh" in r) saved.zh = typeof r.zh === "string" ? r.zh : null;
  if ("zhLang" in r) saved.zhLang = typeof r.zhLang === "string" ? r.zhLang : null;
  if (typeof r.hasAnalysis === "boolean") saved.hasAnalysis = r.hasAnalysis;
  if ("analysisLang" in r) saved.analysisLang = typeof r.analysisLang === "string" ? r.analysisLang : null;
  if (Array.isArray(r.flags)) saved.flags = r.flags.filter((f): f is string => typeof f === "string");
  return saved;
}

export function bestBySegment(rows: SegmentBest[]): Map<number, SegmentBest> {
  return new Map(rows.map((r) => [r.segIdx, r]));
}

/** 本页刚记下的一次成绩并入汇总(不改原表);分数取整,与服务端的 SmallInteger 一致。 */
export function mergeBest(map: Map<number, SegmentBest>, segIdx: number, score: number, at: string = new Date().toISOString()): Map<number, SegmentBest> {
  const next = new Map(map);
  const prev = map.get(segIdx);
  const rounded = Math.round(score);
  next.set(segIdx, {
    segIdx,
    bestScore: prev && typeof prev.bestScore === "number" ? Math.max(prev.bestScore, rounded) : rounded,
    count: (prev ? prev.count : 0) + 1,
    lastAt: at,
  });
  return next;
}

/** 服务端汇总晚于本页的记录到达时:以服务端为准,除非本页已记得更多次(它的快照还没包含它们)。 */
export function mergeServerBest(server: Map<number, SegmentBest>, local: Map<number, SegmentBest>): Map<number, SegmentBest> {
  const next = new Map(server);
  for (const [k, v] of local) {
    const s = next.get(k);
    if (!s || v.count > s.count) next.set(k, v);
  }
  return next;
}

// ---- 最好成绩缓存(R-SH30):当前句一变,旧句的 ActivePanel 卸载、新句的挂载,不能每换一句就 GET 一次 ----

/** 缓存多久后重取(同一次观看里别的设备记的成绩不会立刻出现,可接受)。 */
export const BEST_TTL_MS = 5 * 60_000;

interface BestEntry {
  map: Map<number, SegmentBest>;
  /** 取自服务端的时间;只有本地记录、从未取过时为 0(下次 loadBest 会取并合并) */
  at: number;
}
const bestCache = new Map<string, BestEntry>();
const bestInflight = new Map<string, Promise<Map<number, SegmentBest>>>();

export function peekBest(itemId: string): Map<number, SegmentBest> | undefined {
  return bestCache.get(itemId)?.map;
}

/** 取条目的每句最好成绩:ttl 内命中缓存;并发请求合并成一次;失败不缓存(调用方自行忽略)。 */
export function loadBest(api: ApiClient, itemId: string, now: number = Date.now()): Promise<Map<number, SegmentBest>> {
  const hit = bestCache.get(itemId);
  if (hit && hit.at > 0 && now - hit.at < BEST_TTL_MS) return Promise.resolve(hit.map);
  const pending = bestInflight.get(itemId);
  if (pending) return pending;
  const request = listAttempts(api, itemId)
    .then((rows) => {
      const merged = mergeServerBest(bestBySegment(rows), bestCache.get(itemId)?.map ?? new Map()); // 在回调里读缓存:期间可能已记了新成绩
      bestCache.set(itemId, { map: merged, at: now });
      return merged;
    })
    .finally(() => {
      bestInflight.delete(itemId);
    });
  bestInflight.set(itemId, request);
  return request;
}

/** 本页记下一次成绩(POST attempts 成功后调);返回合并后的新表。 */
export function noteAttempt(itemId: string, segIdx: number, score: number, at?: string): Map<number, SegmentBest> {
  const cur = bestCache.get(itemId);
  const map = mergeBest(cur?.map ?? new Map(), segIdx, score, at);
  bestCache.set(itemId, { map, at: cur?.at ?? 0 });
  return map;
}

/** 只给测试:清空缓存与在途请求。 */
export function resetBestCache(): void {
  bestCache.clear();
  bestInflight.clear();
}
