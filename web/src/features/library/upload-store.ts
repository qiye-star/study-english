import { useSyncExternalStore } from "react";
import type { ApiClient } from "~/api/client";
import { deleteItem, stemOf, type LibraryItem } from "./library-api";
import { uploadFile, type UploadInput } from "./upload-client";

/** 一个本地上传任务(只在本标签页内存里;刷新后只剩服务端的 uploading 条目,R-L10)。 */
export interface UploadJob {
  key: string;
  itemId: string | null;
  filename: string;
  title: string;
  size: number;
  sent: number;
  state: "uploading" | "failed";
  error: unknown;
  input: UploadInput;
  chunkBytes?: number;
}

export interface StartOptions {
  resumeItemId?: string;
  chunkBytes?: number;
  onDone?: (item: LibraryItem) => void;
  onError?: (err: unknown) => void;
}

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Win = Pick<Window, "addEventListener" | "removeEventListener">;
interface Deps {
  upload: typeof uploadFile;
  remove: typeof deleteItem;
  storage: () => KV | null;
  win: () => Win | null;
}

const nameKey = (itemId: string) => `enjoy-web.library.upload.${itemId}`;
const sessionKV = (): KV | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const browserWin = (): Win | null => (typeof window === "undefined" ? null : window);

/**
 * 模块级上传任务表(R-L9):应用内切页时上传继续;有进行中的任务时挂 beforeunload 提示。
 * 取消 = 中止 + 删除条目;失败保留本地卡(可「重试」= 用同一个文件续传,或「关闭」)。
 */
export function createUploadStore(over: Partial<Deps> = {}) {
  const deps: Deps = { upload: uploadFile, remove: deleteItem, storage: sessionKV, win: browserWin, ...over };
  let jobs: readonly UploadJob[] = [];
  let seq = 0;
  let guarded = false;
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const onBeforeUnload = (e: Event) => {
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = "";
  };

  const emit = () => {
    const active = jobs.some((j) => j.state === "uploading");
    const win = deps.win();
    if (win && active !== guarded) {
      if (active) win.addEventListener("beforeunload", onBeforeUnload);
      else win.removeEventListener("beforeunload", onBeforeUnload);
      guarded = active;
    }
    for (const l of [...listeners]) l();
  };
  const update = (key: string, patch: Partial<UploadJob>) => {
    jobs = jobs.map((j) => (j.key === key ? { ...j, ...patch } : j));
    emit();
  };
  const drop = (key: string) => {
    controllers.delete(key);
    jobs = jobs.filter((j) => j.key !== key);
    emit();
  };
  const remember = (itemId: string, name: string) => {
    try { deps.storage()?.setItem(nameKey(itemId), name); } catch { /* 本机存储不可用:只是少了文件名核对 */ }
  };
  const forget = (itemId: string) => {
    try { deps.storage()?.removeItem(nameKey(itemId)); } catch { /* 同上 */ }
  };

  function start(api: ApiClient, input: UploadInput, opts: StartOptions = {}): string {
    seq += 1;
    const key = `upload-${seq}`;
    const ctl = new AbortController();
    controllers.set(key, ctl);
    const job: UploadJob = {
      key, itemId: opts.resumeItemId ?? null, filename: input.filename, title: input.title?.trim() || stemOf(input.filename),
      size: input.file.size, sent: 0, state: "uploading", error: null, input, chunkBytes: opts.chunkBytes,
    };
    jobs = [job, ...jobs];
    emit();
    deps.upload(api, input, {
      resumeItemId: opts.resumeItemId,
      chunkBytes: opts.chunkBytes,
      signal: ctl.signal,
      onItem: (itemId) => {
        remember(itemId, input.filename);
        update(key, { itemId });
      },
      onProgress: (sent) => update(key, { sent }),
    }).then(
      (item) => {
        forget(item.id);
        drop(key);
        opts.onDone?.(item);
      },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        controllers.delete(key);
        update(key, { state: "failed", error: err });
        opts.onError?.(err);
      },
    );
    return key;
  }

  return {
    snapshot: (): readonly UploadJob[] => jobs,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    rememberedName(itemId: string): string | null {
      try {
        return deps.storage()?.getItem(nameKey(itemId)) ?? null;
      } catch {
        return null;
      }
    },
    start,
    /** 失败的任务用同一个文件续传(没有条目 id 时从头开始)。 */
    retry(api: ApiClient, key: string, opts: StartOptions = {}): string | null {
      const job = jobs.find((j) => j.key === key);
      if (!job || job.state !== "failed") return null;
      drop(key);
      return start(api, job.input, { ...opts, resumeItemId: job.itemId ?? undefined, chunkBytes: job.chunkBytes });
    },
    async cancel(api: ApiClient, key: string): Promise<void> {
      const job = jobs.find((j) => j.key === key);
      controllers.get(key)?.abort();
      drop(key);
      if (!job?.itemId) return;
      forget(job.itemId);
      try {
        await deps.remove(api, job.itemId);
      } catch {
        /* 删除失败:列表里仍有那条「上传未完成」,用户可以再删 */
      }
    },
    dismiss(key: string): void {
      drop(key);
    },
  };
}

export type UploadStore = ReturnType<typeof createUploadStore>;

/** 应用内唯一的上传任务表。 */
export const uploads: UploadStore = createUploadStore();

export function useUploads(store: UploadStore = uploads): readonly UploadJob[] {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
