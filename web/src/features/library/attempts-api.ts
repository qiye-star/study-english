import { ApiError, type ApiClient } from "~/api/client";

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

/** D8 增补的可选字段(spec §4、§15 W1 行;W1 的 LibrarySegment 若已声明同名字段则兼容):译文 / 分析与它们的语言。 */
export type SegmentWithAi = SavedSegment & {
  zh?: string | null;
  zhLang?: string | null;
  analysis?: string | null;
  analysisLang?: string | null;
};

export interface SegmentPatch {
  startMs?: number;
  endMs?: number;
  text?: string;
}

/**
 * 改句 / 记成绩的服务端错误 → 文案键(plan W2 R-SH19;键 = S1 routers/library.py 的固定英文文本)。译文与分析按状态码处理,不在这里。
 * PENDING:S1 的服务端代码不在本分支基底,键是计划的假设,待 S1 合并后按 routers/library.py 的真实文本核对。
 */
export const SHADOW_SERVER_ERRORS: Record<string, string> = {
  "Library item not found": "web.library.shadow.errors.notFound",
  "Segment not found": "web.library.shadow.errors.notFound",
  "Invalid segment times": "web.library.shadow.errors.badTimes",
  "Invalid segment text": "web.library.shadow.errors.badText",
};

/** 句子分析要等大模型,比默认的 60 s 超时放宽一点。 */
export const ANALYSIS_TIMEOUT_MS = 120_000;

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

/** 改一句的起止 / 文字;响应可为句子、{segment} 或空,缺的字段用本地值补(R-SH11)。 */
export async function patchSegment(api: ApiClient, itemId: string, idx: number, patch: SegmentPatch, base: SavedSegment): Promise<SavedSegment> {
  const res = await api.request<unknown>("PATCH", `${itemPath(itemId)}/segments/${encodeURIComponent(String(idx))}`, { json: patch });
  const inner = res && typeof res === "object" && "segment" in res ? (res as { segment: unknown }).segment : res;
  const r = (inner && typeof inner === "object" ? inner : {}) as Partial<SavedSegment>;
  return {
    idx: base.idx,
    startMs: typeof r.startMs === "number" ? r.startMs : patch.startMs ?? base.startMs,
    endMs: typeof r.endMs === "number" ? r.endMs : patch.endMs ?? base.endMs,
    text: typeof r.text === "string" ? r.text : patch.text ?? base.text,
  };
}

export interface TranslatedSegment {
  idx: number;
  zh: string;
}

export interface TranslateResult {
  items: TranslatedSegment[];
  /** 额度满:已有的照常返回,缺的没有生成(spec §9) */
  limited: boolean;
}

/** 批量译文(D8、E12:一次 ≤ 20 句)。响应接受裸数组或带 limited 的对象(R-SH27);空译文与坏行丢弃。 */
export async function translateSegments(
  api: ApiClient, itemId: string, indices: number[], nativeLanguage: string, signal?: AbortSignal,
): Promise<TranslateResult> {
  const res = await api.request<unknown>("POST", `${itemPath(itemId)}/translate`, { json: { indices, nativeLanguage }, signal });
  const obj = (res && typeof res === "object" && !Array.isArray(res) ? res : {}) as Record<string, unknown>;
  const rows = Array.isArray(res) ? res : [obj.items, obj.translations, obj.segments].find(Array.isArray);
  const items = (Array.isArray(rows) ? rows : []).flatMap((row): TranslatedSegment[] => {
    const r = row as Partial<TranslatedSegment> | null;
    return r && typeof r.idx === "number" && typeof r.zh === "string" && r.zh ? [{ idx: r.idx, zh: r.zh }] : [];
  });
  return { items, limited: obj.limited === true };
}

export interface AnalysisResult {
  /** 模型返回的原文(桌面端 analyze 提示词的分节 markdown,R-SH28) */
  analysis: string;
  cached: boolean;
}

/** 一句的 AI 分析(D8);空文本当作失败。额度满(429)与未开启(404)的状态码原样抛出(R-SH28)。 */
export async function analyzeSegment(
  api: ApiClient, itemId: string, idx: number, nativeLanguage: string, signal?: AbortSignal,
): Promise<AnalysisResult> {
  const res = await api.request<unknown>("POST", `${itemPath(itemId)}/segments/${encodeURIComponent(String(idx))}/analysis`, {
    json: { nativeLanguage }, signal, timeoutMs: ANALYSIS_TIMEOUT_MS,
  });
  const r = (res && typeof res === "object" ? res : {}) as { analysis?: unknown; cached?: unknown };
  if (typeof r.analysis !== "string" || !r.analysis.trim()) throw new ApiError(502, "Empty analysis");
  return { analysis: r.analysis, cached: r.cached === true };
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
