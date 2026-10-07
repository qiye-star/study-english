/** 语音链路延迟打点(设计文档 §3.2;测量方法见计划「延迟测量方法」)。只记时间,不记文本。 */
export type LatencyMark = "release" | "audio_ready" | "transcript" | "reply_first_delta" | "reply_done" | "tts_request" | "first_audio";

export interface LatencySpans {
  transcriptMs?: number;
  replyMs?: number;
  firstAudioAfterReplyMs?: number;
  firstAudioAfterReleaseMs?: number;
}

export type LatencyStatus = "complete" | "aborted";

export interface LatencyRecord {
  id: number;
  kind: "voice" | "text";
  /** complete = 记到 first_audio;aborted = 轮次失败/取消/被新一轮取代/超时 */
  status: LatencyStatus;
  startedAt: number;
  marks: Partial<Record<LatencyMark, number>>;
  spans: LatencySpans;
}

const MAX_RECORDS = 50;
/** 一条记录最长存活时间:超过则作废(发布为 aborted),防止后到的标记串到别的轮次。 */
const TRACE_TTL_MS = 120_000;
const DEBUG_KEY = "enjoy-web.debug.latency";
const defaultClock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
let clock: () => number = defaultClock;
let current: LatencyRecord | null = null;
let nextId = 1;
let records: LatencyRecord[] = [];
let expiry: ReturnType<typeof setTimeout> | undefined;

function publish(): void {
  try {
    (globalThis as unknown as { __enjoyLatency?: readonly LatencyRecord[] }).__enjoyLatency = records;
  } catch {
    /* 全局对象被冻结等:忽略 */
  }
}

function debugEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function latencySpans(marks: Partial<Record<LatencyMark, number>>): LatencySpans {
  const span = (from: LatencyMark, to: LatencyMark) => {
    const a = marks[from];
    const b = marks[to];
    return a === undefined || b === undefined ? undefined : Math.round(b - a);
  };
  const spans: LatencySpans = {
    transcriptMs: span("release", "transcript"),
    replyMs: span("transcript", "reply_done"),
    firstAudioAfterReplyMs: span("reply_done", "first_audio"),
    firstAudioAfterReleaseMs: span("release", "first_audio"),
  };
  for (const key of Object.keys(spans) as Array<keyof LatencySpans>) if (spans[key] === undefined) delete spans[key];
  return spans;
}

function clearExpiry(): void {
  if (expiry !== undefined) clearTimeout(expiry);
  expiry = undefined;
}

function close(status: LatencyStatus): void {
  clearExpiry();
  if (!current) return;
  const done = current;
  current = null;
  done.status = status;
  records = [...records, done].slice(-MAX_RECORDS);
  publish();
  if (debugEnabled()) console.info("[latency]", { kind: done.kind, status, ...done.spans });
}

function expireStale(): void {
  if (current && clock() - current.startedAt > TRACE_TTL_MS) close("aborted");
}

/** 这个标记是否属于当前记录的合理位置(防止手动朗读、过期回复把时间记到别的轮次上)。 */
function accepts(record: LatencyRecord, mark: LatencyMark): boolean {
  const m = record.marks;
  switch (mark) {
    case "audio_ready":
    case "transcript":
      return record.kind === "voice" && m.release !== undefined;
    case "reply_first_delta":
    case "reply_done":
      return record.kind === "text" || m.transcript !== undefined;
    case "tts_request":
    case "first_audio":
      return m.reply_first_delta !== undefined || m.reply_done !== undefined;
    default:
      return true;
  }
}

/** 结束当前记录(默认 complete)。给出 turn 时只在仍是该轮次时生效。所有函数都不会向产品代码抛异常。 */
export function finishLatencyTrace(status: LatencyStatus = "complete", turn?: number): void {
  try {
    if (turn !== undefined && current?.id !== turn) return;
    close(status);
  } catch {
    current = null;
  }
}

/** 轮次失败/取消:把当前记录发布为 aborted。给出 turn 时只在仍是该轮次时生效。 */
export function abortLatencyTrace(turn?: number): void {
  try {
    if (current && (turn === undefined || current.id === turn)) close("aborted");
  } catch {
    current = null;
  }
}

/** 开始新记录(先把未结束的上一条发布为 aborted),返回本轮 id;出错时返回 0(之后的标记都被忽略)。 */
export function startLatencyTrace(kind: "voice" | "text"): number {
  try {
    close("aborted");
    const record: LatencyRecord = { id: nextId++, kind, status: "complete", startedAt: clock(), marks: {}, spans: {} };
    current = record;
    expiry = setTimeout(() => abortLatencyTrace(record.id), TRACE_TTL_MS);
    return record.id;
  } catch {
    current = null;
    return 0;
  }
}

/** 记一个时间点。同一标记只记第一次;给出 turn 且不是当前轮次则忽略;first_audio 记完即结束。 */
export function markLatency(mark: LatencyMark, turn?: number): void {
  try {
    expireStale();
    if (!current || current.marks[mark] !== undefined) return;
    if (turn !== undefined && current.id !== turn) return;
    if (!accepts(current, mark)) return;
    current.marks[mark] = clock();
    current.spans = latencySpans(current.marks);
    if (mark === "first_audio") close("complete");
  } catch {
    /* 打点绝不影响产品逻辑 */
  }
}

export function latencyLog(): readonly LatencyRecord[] {
  try {
    expireStale();
  } catch {
    /* ignore */
  }
  return records;
}

export function resetLatencyForTest(now?: () => number): void {
  clearExpiry();
  clock = now ?? defaultClock;
  current = null;
  nextId = 1;
  records = [];
  publish();
}
