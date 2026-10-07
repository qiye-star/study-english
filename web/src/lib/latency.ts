/** 语音链路延迟打点(设计文档 §3.2;测量方法见计划「延迟测量方法」)。只记时间,不记文本。 */
export type LatencyMark = "release" | "audio_ready" | "transcript" | "reply_first_delta" | "reply_done" | "tts_request" | "first_audio";

export interface LatencySpans {
  transcriptMs?: number;
  replyMs?: number;
  firstAudioAfterReplyMs?: number;
  firstAudioAfterReleaseMs?: number;
}

export interface LatencyRecord {
  id: number;
  kind: "voice" | "text";
  marks: Partial<Record<LatencyMark, number>>;
  spans: LatencySpans;
}

const MAX_RECORDS = 50;
const DEBUG_KEY = "enjoy-web.debug.latency";
const defaultClock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
let clock: () => number = defaultClock;
let current: LatencyRecord | null = null;
let nextId = 1;
let records: LatencyRecord[] = [];

function publish(): void {
  (globalThis as unknown as { __enjoyLatency?: readonly LatencyRecord[] }).__enjoyLatency = records;
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

export function finishLatencyTrace(): void {
  if (!current) return;
  const done = current;
  current = null;
  records = [...records, done].slice(-MAX_RECORDS);
  publish();
  if (debugEnabled()) console.info("[latency]", { kind: done.kind, ...done.spans });
}

export function startLatencyTrace(kind: "voice" | "text"): void {
  finishLatencyTrace();
  current = { id: nextId++, kind, marks: {}, spans: {} };
}

export function markLatency(mark: LatencyMark): void {
  if (!current || current.marks[mark] !== undefined) return;
  current.marks[mark] = clock();
  current.spans = latencySpans(current.marks);
  if (mark === "first_audio") finishLatencyTrace();
}

export function latencyLog(): readonly LatencyRecord[] {
  return records;
}

export function resetLatencyForTest(now?: () => number): void {
  clock = now ?? defaultClock;
  current = null;
  nextId = 1;
  records = [];
  publish();
}
