import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { CatalogRow } from "./api";
import { PackageRunner, summarize, type RunItem, type RunnerDeps } from "./package-runner";

const md5Of = (n: number) => n.toString(16).padStart(32, "0");
const CHUNK = 4;

/** 每条 8 字节媒体(2 片);md5 由测试直接登记,不走 FileReader(假定时器下更稳)。 */
function makeItem(n: number, over: Partial<RunItem> = {}, sums: Map<Blob, string> = new Map()): RunItem {
  const media = new Blob([new Uint8Array(8).fill(n) as BlobPart]);
  const subtitle = new Blob([`srt-${n}` as BlobPart]);
  sums.set(media, md5Of(100 + n));
  sums.set(subtitle, md5Of(200 + n));
  return {
    sourceMd5: md5Of(n), title: `T${n}`, action: "create", catalogId: null, uploadReceived: 0,
    mediaName: "media.mp4", media, mediaBytes: 8, mediaMd5: md5Of(100 + n), subtitle, subtitleMd5: md5Of(200 + n),
    ...over,
  };
}

function fakeDeps(sums: Map<Blob, string>, over: Partial<RunnerDeps> = {}) {
  const deps: RunnerDeps = {
    startUpload: vi.fn(async (_f: string, _s: number, _m: unknown, md5: string) => ({ catalogId: `up-${md5.slice(-2)}`, chunkBytes: CHUNK })),
    startReplace: vi.fn(async (id: string) => ({ catalogId: id, chunkBytes: CHUNK })),
    uploadChunks: vi.fn(async () => null),
    putSubtitles: vi.fn(async () => ({ cueCount: 3 })),
    completeUpload: vi.fn(async (id: string) => ({ id })),
    cancel: vi.fn(async (id: string) => ({ id })),
    fetchCatalog: vi.fn(async () => ({ items: [] as CatalogRow[], state: {} as never })),
    md5Blob: vi.fn(async (b: Blob) => sums.get(b) ?? "?"),
    ...over,
  };
  return deps;
}

const META = { level: null, tags: [], licenseNote: null, aiLang: "zh-CN" };
const run = (items: RunItem[], deps: RunnerDeps) => new PackageRunner(items, deps, { chunkBytes: CHUNK, meta: META });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function settle(runner: PackageRunner, pred: (s: ReturnType<PackageRunner["getState"]>) => boolean, max = 200) {
  for (let i = 0; i < max && !pred(runner.getState()); i++) await flush();
}
const rowOf = (id: string, status: CatalogRow["status"], extra: Partial<CatalogRow> = {}) => ({ id, status, ...extra }) as CatalogRow;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PackageRunner", () => {
  it("uploads one item at a time in manifest order", async () => {
    vi.useFakeTimers();
    const sums = new Map<Blob, string>();
    let active = 0;
    let peak = 0;
    // 两条完成后第三条要等队列:目录报告它们都已就绪,等待一次定时器即可
    const deps = fakeDeps(sums, {
      uploadChunks: vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await flush();
        active--;
        return null;
      }),
      completeUpload: vi.fn(async (id: string) => ({ id })),
      fetchCatalog: vi.fn(async () => ({ items: [1, 2].map((n) => rowOf(`up-${md5Of(n).slice(-2)}`, "ready")), state: {} as never })),
    });
    const items = [makeItem(1, {}, sums), makeItem(2, {}, sums), makeItem(3, {}, sums)];
    const runner = run(items, deps);
    runner.start();
    await settle(runner, () => runner.getState().waiting || runner.getState().status === "done");
    await vi.advanceTimersByTimeAsync(3000);
    await settle(runner, (s) => s.status === "done");
    expect(runner.getState().status).toBe("done");
    expect(peak).toBe(1);
    expect(vi.mocked(deps.startUpload).mock.calls.map((c) => c[3])).toEqual([md5Of(1), md5Of(2), md5Of(3)]);
  });

  it("creates with source_md5 and the batch metadata, then subtitles, then complete", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums);
    const runner = run([makeItem(1, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(deps.startUpload).toHaveBeenCalledWith("media.mp4", 8, { ...META, title: "T1" }, md5Of(1));
    expect(deps.putSubtitles).toHaveBeenCalledWith("up-01", expect.any(Blob), "subtitle.srt");
    expect(deps.completeUpload).toHaveBeenCalledWith("up-01");
    expect(runner.getState().results).toEqual([{ sourceMd5: md5Of(1), title: "T1", outcome: { kind: "created" } }]);
  });

  it("overwrite replaces media in place with startReplace and never cancels or deletes the item", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums);
    const runner = run([makeItem(1, { action: "replace", catalogId: "old-1" }, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(deps.startReplace).toHaveBeenCalledWith("old-1", "media.mp4", 8);
    expect(deps.startUpload).not.toHaveBeenCalled();
    expect(deps.uploadChunks).toHaveBeenCalledWith("old-1", expect.any(Blob), CHUNK, expect.any(Function), expect.any(AbortSignal), undefined, 0);
    expect(deps.completeUpload).toHaveBeenCalledWith("old-1");
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(runner.getState().results[0].outcome).toEqual({ kind: "replaced" });
  });

  it("resumes an interrupted upload from floor(received / chunk) using the same id", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums);
    const runner = run([makeItem(1, { action: "resume", catalogId: "keep-1", uploadReceived: 6 }, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(deps.startUpload).not.toHaveBeenCalled();
    expect(deps.uploadChunks).toHaveBeenCalledWith("keep-1", expect.any(Blob), CHUNK, expect.any(Function), expect.any(AbortSignal), undefined, 1);
    expect(runner.getState().results[0].outcome).toEqual({ kind: "resumed" });
  });

  it("an md5 mismatch fails the item before any request", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums);
    const bad = makeItem(1, { mediaMd5: md5Of(999) }, sums);
    const runner = run([bad], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(runner.getState().results[0].outcome).toEqual({ kind: "failed", reason: "checksum" });
    expect(deps.startUpload).not.toHaveBeenCalled();
    expect(deps.uploadChunks).not.toHaveBeenCalled();
  });

  it("keeps at most two uploads waiting in the queue and resumes when one of them is ready", async () => {
    vi.useFakeTimers();
    const sums = new Map<Blob, string>();
    const ids: string[] = [];
    const rowsNow: CatalogRow[] = [];
    const deps = fakeDeps(sums, {
      startUpload: vi.fn(async (_f: string, _s: number, _m: unknown, md5: string) => {
        const id = `q-${md5.slice(-2)}`;
        ids.push(id);
        return { catalogId: id, chunkBytes: CHUNK };
      }),
      fetchCatalog: vi.fn(async () => ({ items: rowsNow.slice(), state: {} as never })),
    });
    const items = [1, 2, 3].map((n) => makeItem(n, {}, sums));
    const runner = run(items, deps);
    runner.start();
    await settle(runner, () => ids.length === 2);
    expect(ids).toEqual(["q-01", "q-02"]);
    // 第 3 条必须等待:两条都还在排队 / 处理中
    rowsNow.push(rowOf("q-01", "queued"), rowOf("q-02", "processing"));
    await settle(runner, () => runner.getState().waiting);
    expect(runner.getState().waiting).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(ids).toHaveLength(2);
    // 一条处理完(ready),剩一条在排队 → 允许开始第 3 条
    rowsNow.splice(0, rowsNow.length, rowOf("q-01", "ready"), rowOf("q-02", "queued"));
    await vi.advanceTimersByTimeAsync(3000);
    await settle(runner, () => ids.length === 3);
    expect(ids).toEqual(["q-01", "q-02", "q-03"]);
    expect(deps.fetchCatalog).toHaveBeenCalled();
  });

  it("503 media tools missing pauses the whole batch", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, { startUpload: vi.fn(async () => { throw new ApiError(503, "Media tools are not installed"); }) });
    const runner = run([makeItem(1, {}, sums), makeItem(2, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "paused");
    expect(runner.getState()).toMatchObject({ status: "paused", paused: "unavailable" });
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
  });

  it("401 pauses for re-login; continuing resumes the same item with its existing id", async () => {
    const sums = new Map<Blob, string>();
    const rows: CatalogRow[] = [];
    let failChunks = true;
    const deps = fakeDeps(sums, {
      uploadChunks: vi.fn(async () => {
        if (failChunks) throw new ApiError(401, "Unauthorized");
        return null;
      }),
      fetchCatalog: vi.fn(async () => ({ items: rows.slice(), state: {} as never })),
    });
    const runner = run([makeItem(1, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "paused");
    expect(runner.getState()).toMatchObject({ status: "paused", paused: "auth" });
    // 重新登录后,服务端已收 4 字节
    failChunks = false;
    rows.push(rowOf("up-01", "uploading", { uploadReceived: 4, segCount: 0, uploadTotal: 8 }));
    runner.resume();
    await settle(runner, (s) => s.status === "done");
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
    expect(deps.uploadChunks).toHaveBeenLastCalledWith("up-01", expect.any(Blob), CHUNK, expect.any(Function), expect.any(AbortSignal), undefined, 1);
    expect(runner.getState().results[0].outcome).toEqual({ kind: "created" });
  });

  it("a network error pauses; continuing uploads from what the server has (no second create)", async () => {
    const sums = new Map<Blob, string>();
    const rows: CatalogRow[] = [];
    let netFail = true;
    const deps = fakeDeps(sums, {
      uploadChunks: vi.fn(async () => {
        if (netFail) throw new ApiError(0, "网络异常");
        return null;
      }),
      fetchCatalog: vi.fn(async () => ({ items: rows.slice(), state: {} as never })),
    });
    const runner = run([makeItem(1, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "paused");
    expect(runner.getState()).toMatchObject({ paused: "network" });
    netFail = false;
    rows.push(rowOf("up-01", "uploading", { uploadReceived: 8, segCount: 0, uploadTotal: 8 }));
    runner.resume();
    await settle(runner, (s) => s.status === "done");
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
    expect(runner.getState().results[0].outcome.kind).toBe("created");
  });

  it("a rejected subtitle file fails that item, cancels the new item, and goes on", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, {
      putSubtitles: vi.fn(async (id: string) => {
        if (id === "up-01") throw new ApiError(400, "Invalid subtitle file");
        return { cueCount: 3 };
      }),
    });
    const runner = run([makeItem(1, {}, sums), makeItem(2, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(deps.cancel).toHaveBeenCalledWith("up-01");
    const [first, second] = runner.getState().results;
    expect(first.outcome).toEqual({ kind: "failed", reason: "Invalid subtitle file" });
    expect(second.outcome).toEqual({ kind: "created" });
  });

  it("a rejected subtitle during overwrite cancels the replace (server restores ready) and fails the item", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, { putSubtitles: vi.fn(async () => { throw new ApiError(400, "Invalid subtitle file"); }) });
    const runner = run([makeItem(1, { action: "replace", catalogId: "old-1" }, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(deps.cancel).toHaveBeenCalledWith("old-1");
    expect(runner.getState().results[0].outcome).toEqual({ kind: "failed", reason: "Invalid subtitle file" });
  });

  it("409 Item already imported counts as exists and does not cancel anything", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, { startUpload: vi.fn(async () => { throw new ApiError(409, "Item already imported"); }) });
    const runner = run([makeItem(1, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(runner.getState().results[0].outcome).toEqual({ kind: "exists" });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("409 Item is published during overwrite is a skip with a reason, not a failure", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, { startReplace: vi.fn(async () => { throw new ApiError(409, "Item is published"); }) });
    const runner = run([makeItem(1, { action: "replace", catalogId: "old-1" }, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(runner.getState().results[0].outcome).toEqual({ kind: "published" });
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("a generic 4xx fails the item and continues", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, { startUpload: vi.fn(async () => { throw new ApiError(400, "Unsupported file type"); }) });
    const runner = run([makeItem(1, {}, sums), makeItem(2, {}, sums)], deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(runner.getState().results.map((r) => r.outcome.kind)).toEqual(["failed", "failed"]);
  });

  it("stop aborts the current upload, leaves it in uploading (no cancel), and ends the batch", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, {
      uploadChunks: vi.fn(async (_id: string, _f: Blob, _c: number, _p: unknown, signal?: AbortSignal) => {
        await new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
        return null;
      }),
    });
    const runner = run([makeItem(1, {}, sums), makeItem(2, {}, sums)], deps);
    runner.start();
    await settle(runner, () => vi.mocked(deps.uploadChunks).mock.calls.length > 0);
    runner.stop();
    await settle(runner, (s) => s.status === "stopped");
    expect(runner.getState().status).toBe("stopped");
    expect(deps.cancel).not.toHaveBeenCalled();
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
    expect(runner.getState().results).toHaveLength(0);
  });

  it("summarize counts each outcome and the not-started items", async () => {
    const sums = new Map<Blob, string>();
    const deps = fakeDeps(sums, {
      startUpload: vi.fn(async (_f: string, _s: number, _m: unknown, md5: string) => {
        if (md5 === md5Of(2)) throw new ApiError(409, "Item already imported");
        if (md5 === md5Of(3)) throw new ApiError(400, "Unsupported file type");
        return { catalogId: `s-${md5.slice(-2)}`, chunkBytes: CHUNK };
      }),
    });
    const items = [makeItem(1, {}, sums), makeItem(2, {}, sums), makeItem(3, {}, sums), makeItem(4, { action: "replace", catalogId: "r-4" }, sums)];
    const runner = run(items, deps);
    runner.start();
    await settle(runner, (s) => s.status === "done");
    const sum = summarize(runner.getState().results, items.length);
    expect(sum).toMatchObject({ created: 1, replaced: 1, resumed: 0, exists: 1, published: 0, busy: 0, notStarted: 0 });
    expect(sum.failed.map((f) => f.title)).toEqual(["T3"]);
  });

  it("never writes anything to localStorage or sessionStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const sums = new Map<Blob, string>();
    const runner = run([makeItem(1, {}, sums)], fakeDeps(sums));
    runner.start();
    await settle(runner, (s) => s.status === "done");
    expect(setItem).not.toHaveBeenCalled();
  });
});
