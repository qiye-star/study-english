/**
 * 导入包的批次执行器(plan 2026-10-27 R-A5–R-A7、A6)。
 *
 * - 一次只传一条,顺序 = 包内 manifest 顺序。
 * - 队列背压:本批已完成上传、仍在 queued / processing 的条目 ≥ 2 时,不开始下一条;每 3 秒拉一次列表等它降下来。
 * - 单条失败不影响其余;503 / 401 / 网络错误暂停整批,「继续」从当前条目接着跑(用服务端已收的分片续传)。
 * - 覆盖走「替换媒体」(startReplace),从不删除任何东西。
 * - 状态只在内存里,不写 localStorage / sessionStorage;不打日志。
 *
 * 纯逻辑:所有网络与 md5 都经 `RunnerDeps` 注入(测试用假件,界面用 `package-dialog.tsx` 里的真实接口)。
 */
import { ApiError } from "../../api/client";
import type { CatalogRow, NewMeta } from "./api";

export type Action = "create" | "resume" | "replace";

/** 已经由预览判定为「能导入」的一条(包内容 + 服务端的匹配)。 */
export interface RunItem {
  sourceMd5: string;
  title: string;
  action: Action;
  /** replace 与 resume 必填:既有条目的 id */
  catalogId: string | null;
  /** resume 时服务端已收的字节数 */
  uploadReceived: number;
  /** 中性文件名 `media.<ext>`(只让服务端取扩展名) */
  mediaName: string;
  media: Blob;
  mediaBytes: number;
  mediaMd5: string;
  subtitle: Blob;
  subtitleMd5: string;
}

export type Outcome =
  | { kind: "created" }
  | { kind: "replaced" }
  | { kind: "resumed" }
  | { kind: "exists" }
  | { kind: "published" }
  | { kind: "busy"; reason: string }
  | { kind: "failed"; reason: string };

export interface ItemResult {
  sourceMd5: string;
  title: string;
  outcome: Outcome;
}

export type Paused = "unavailable" | "auth" | "network";

export interface RunnerState {
  status: "idle" | "running" | "paused" | "stopped" | "done";
  paused: Paused | null;
  waiting: boolean;
  index: number;
  total: number;
  /** 当前条目的上传百分比 */
  percent: number;
  results: ItemResult[];
}

export interface RunnerDeps {
  startUpload: (filename: string, size: number, meta: NewMeta, sourceMd5: string) => Promise<{ catalogId: string; chunkBytes: number }>;
  startReplace: (id: string, filename: string, size: number) => Promise<{ catalogId: string; chunkBytes: number }>;
  uploadChunks: (
    id: string,
    file: Blob,
    chunkBytes: number,
    onProgress: (p: { sent: number; total: number }) => void,
    signal: AbortSignal,
    send: undefined,
    startChunk: number,
  ) => Promise<unknown>;
  putSubtitles: (id: string, file: Blob, name: string) => Promise<unknown>;
  completeUpload: (id: string) => Promise<unknown>;
  cancel: (id: string) => Promise<unknown>;
  fetchCatalog: () => Promise<{ items: CatalogRow[] }>;
  md5Blob: (blob: Blob, opts: { signal?: AbortSignal }) => Promise<string>;
  /** 测试可替换;默认是 setTimeout(可被 signal 中止)。 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const QUEUE_POLL_MS = 3000;
const QUEUE_LIMIT = 2;
const MEDIA_TOOLS_MISSING = "Media tools are not installed";

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const isAbort = (e: unknown) => (e instanceof DOMException || e instanceof Error) && e.name === "AbortError";

/** 503 媒体工具 / 401 会话 / 网络与 5xx 才暂停整批;其余是单条问题。 */
export function pauseOf(e: unknown): Paused | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 503 && e.message === MEDIA_TOOLS_MISSING) return "unavailable";
  if (e.status === 401) return "auth";
  if (e.status === 0 || e.status >= 500) return "network";
  return null;
}

type StepResult = { outcome: Outcome } | { pause: Paused } | "stopped";

const DONE_KIND: Record<Action, Outcome> = { create: { kind: "created" }, replace: { kind: "replaced" }, resume: { kind: "resumed" } };

export class PackageRunner {
  private state: RunnerState;
  private readonly listeners = new Set<() => void>();
  private cursor = 0;
  /** 本批已完成上传、可能仍在队列里的目录 id */
  private readonly inFlight = new Set<string>();
  /** 暂停时保留的进行中条目(按 items 下标):续传时以服务端为准 */
  private readonly live = new Map<number, { id: string; kind: Action; chunkBytes: number }>();
  private ctrl: AbortController | null = null;
  private stopRequested = false;
  private running = false;

  constructor(
    private readonly items: RunItem[],
    private readonly deps: RunnerDeps,
    private readonly opts: { chunkBytes: number; meta: NewMeta },
  ) {
    this.state = { status: "idle", paused: null, waiting: false, index: 0, total: items.length, percent: 0, results: [] };
  }

  getState = (): RunnerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    if (this.running || this.state.status === "done" || this.state.status === "stopped") return;
    void this.drive();
  }

  /** 暂停后「继续」:从当前条目接着跑。 */
  resume(): void {
    if (this.state.status === "paused") void this.drive();
  }

  /** 「停止」:中止当前分片上传(条目留在 uploading,下次可续传),结束批次。不调用 cancel。 */
  stop(): void {
    if (this.state.status === "done" || this.state.status === "stopped") return;
    this.stopRequested = true;
    this.ctrl?.abort();
    if (!this.running) this.set({ status: "stopped", paused: null, waiting: false });
  }

  private set(patch: Partial<RunnerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private async drive(): Promise<void> {
    this.running = true;
    this.set({ status: "running", paused: null });
    try {
      while (this.cursor < this.items.length && !this.stopRequested) {
        if (this.inFlight.size >= QUEUE_LIMIT) {
          const w = await this.waitQueue();
          if (w !== null) {
            if (w === "stopped") break;
            this.set({ status: "paused", paused: w.pause });
            return;
          }
          if (this.stopRequested) break;
        }
        const item = this.items[this.cursor];
        const r = await this.runOne(item, this.cursor);
        if (r === "stopped") break;
        if ("pause" in r) {
          this.set({ status: "paused", paused: r.pause, percent: 0 });
          return;
        }
        this.cursor++;
        this.set({ results: [...this.state.results, { sourceMd5: item.sourceMd5, title: item.title, outcome: r.outcome }], index: this.cursor, percent: 0 });
      }
      this.set({ status: this.stopRequested ? "stopped" : "done", waiting: false, percent: 0 });
    } finally {
      this.running = false;
    }
  }

  /** 等到 inFlight 降到 1 以下。返回 null 表示可以继续;"stopped" 或暂停原因表示退出。 */
  private async waitQueue(): Promise<"stopped" | { pause: Paused } | null> {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.set({ waiting: true });
    const sleep = this.deps.sleep ?? defaultSleep;
    try {
      while (this.inFlight.size >= QUEUE_LIMIT) {
        await sleep(QUEUE_POLL_MS, ctrl.signal);
        if (this.stopRequested) return "stopped";
        const rows = (await this.deps.fetchCatalog()).items;
        for (const id of [...this.inFlight]) {
          const row = rows.find((r) => r.id === id);
          if (!row || (row.status !== "queued" && row.status !== "processing")) this.inFlight.delete(id);
        }
      }
      return null;
    } catch (e) {
      if (this.stopRequested || isAbort(e)) return "stopped";
      const pause = pauseOf(e);
      if (pause) return { pause };
      return { pause: "network" };
    } finally {
      this.set({ waiting: false });
      this.ctrl = null;
    }
  }

  private async runOne(item: RunItem, idx: number): Promise<StepResult> {
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const { signal } = ctrl;
    let owned: string | null = null;
    try {
      if ((await this.deps.md5Blob(item.media, { signal })) !== item.mediaMd5) return { outcome: { kind: "failed", reason: "checksum" } };
      if ((await this.deps.md5Blob(item.subtitle, { signal })) !== item.subtitleMd5) return { outcome: { kind: "failed", reason: "checksum" } };

      let id: string;
      let kind: Action;
      let chunkBytes: number;
      let startChunk: number;
      const live = this.live.get(idx);
      if (live) {
        // 暂停后继续:以服务端为准,不重新建条目
        const row = (await this.deps.fetchCatalog()).items.find((r) => r.id === live.id);
        if (!row) {
          this.live.delete(idx);
          return { outcome: { kind: "failed", reason: "missing_row" } };
        }
        id = live.id;
        kind = live.kind;
        chunkBytes = live.chunkBytes;
        owned = id;
        if (row.status !== "uploading") {
          this.live.delete(idx);
          this.inFlight.add(id);
          return { outcome: DONE_KIND[kind] };
        }
        startChunk = Math.floor(row.uploadReceived / chunkBytes);
      } else if (item.action === "create") {
        const started = await this.deps.startUpload(item.mediaName, item.mediaBytes, { ...this.opts.meta, title: item.title }, item.sourceMd5);
        id = started.catalogId;
        chunkBytes = started.chunkBytes;
        kind = "create";
        startChunk = 0;
        owned = id;
        this.live.set(idx, { id, kind, chunkBytes });
      } else if (item.action === "replace") {
        const started = await this.deps.startReplace(item.catalogId as string, item.mediaName, item.mediaBytes);
        id = started.catalogId;
        chunkBytes = started.chunkBytes;
        kind = "replace";
        startChunk = 0;
        owned = id;
        this.live.set(idx, { id, kind, chunkBytes });
      } else {
        id = item.catalogId as string;
        kind = "resume";
        chunkBytes = this.opts.chunkBytes;
        startChunk = Math.floor(item.uploadReceived / chunkBytes);
        owned = id;
        this.live.set(idx, { id, kind, chunkBytes });
      }

      await this.deps.uploadChunks(
        id,
        item.media,
        chunkBytes,
        (p) => this.set({ percent: Math.floor((p.sent * 100) / Math.max(1, p.total)) }),
        signal,
        undefined,
        startChunk,
      );
      await this.deps.putSubtitles(id, item.subtitle, "subtitle.srt");
      await this.deps.completeUpload(id);
      this.live.delete(idx);
      this.inFlight.add(id);
      return { outcome: DONE_KIND[kind] };
    } catch (e) {
      return this.failure(e, idx, owned);
    } finally {
      this.ctrl = null;
    }
  }

  private async failure(e: unknown, idx: number, owned: string | null): Promise<StepResult> {
    if (this.stopRequested || isAbort(e)) return "stopped";
    const pause = pauseOf(e);
    if (pause) return { pause };
    this.live.delete(idx);
    if (e instanceof ApiError && e.status === 409) {
      if (e.message === "Item already imported") return { outcome: { kind: "exists" } };
      if (e.message === "Item is published") return { outcome: { kind: "published" } };
      if (!owned) return { outcome: { kind: "busy", reason: e.message } };
    }
    // 我们建过 / 开始替换过的条目:失败时取消(替换取消后服务端恢复 ready,旧媒体不动)
    if (owned) await this.deps.cancel(owned).catch(() => undefined);
    const reason = e instanceof Error ? e.message : "unknown";
    return { outcome: { kind: "failed", reason } };
  }
}

export interface Summary {
  created: number;
  replaced: number;
  resumed: number;
  exists: number;
  published: number;
  busy: number;
  failed: ItemResult[];
  notStarted: number;
}

/** 汇总(界面用)。notStarted = 批次里还没有结果的条目(停止或暂停时)。 */
export function summarize(results: ItemResult[], total: number): Summary {
  const out: Summary = { created: 0, replaced: 0, resumed: 0, exists: 0, published: 0, busy: 0, failed: [], notStarted: total - results.length };
  for (const r of results) {
    switch (r.outcome.kind) {
      case "created":
        out.created++;
        break;
      case "replaced":
        out.replaced++;
        break;
      case "resumed":
        out.resumed++;
        break;
      case "exists":
        out.exists++;
        break;
      case "published":
        out.published++;
        break;
      case "busy":
        out.busy++;
        break;
      case "failed":
        out.failed.push(r);
        break;
    }
  }
  return out;
}
