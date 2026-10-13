import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import type { LibraryItem } from "./library-api";
import type { UploadInput, UploadOptions } from "./upload-client";
import { createUploadStore } from "./upload-store";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function fakeStorage() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const api = new ApiClient({ getToken: () => "t" });
const INPUT: UploadInput = { file: new Blob([new Uint8Array(10)]), filename: "Talk.mp4" };
const ITEM = { id: "u1", status: "queued" } as LibraryItem;

function setup() {
  const runs: { input: UploadInput; opts: UploadOptions; d: ReturnType<typeof deferred<LibraryItem>> }[] = [];
  const upload = vi.fn((_api: ApiClient, input: UploadInput, opts: UploadOptions = {}) => {
    const d = deferred<LibraryItem>();
    runs.push({ input, opts, d });
    return d.promise;
  });
  const remove = vi.fn(async () => {});
  const storage = fakeStorage();
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const store = createUploadStore({ upload, remove, storage: () => storage, win: () => win });
  return { store, runs, upload, remove, storage, win };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("upload store (R-L9, R-L10)", () => {
  it("tracks a job from start to done, remembers the file name meanwhile and guards page unload", async () => {
    const { store, runs, storage, win } = setup();
    const onDone = vi.fn();
    const key = store.start(api, { ...INPUT, title: "" }, { onDone });
    expect(store.snapshot()).toMatchObject([{ key, itemId: null, title: "Talk", size: 10, sent: 0, state: "uploading" }]);
    expect(win.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    runs[0].opts.onItem?.("u1");
    runs[0].opts.onProgress?.(4, 10);
    expect(store.snapshot()[0]).toMatchObject({ itemId: "u1", sent: 4 });
    expect(storage.m.get("enjoy-web.library.upload.u1")).toBe("Talk.mp4");
    expect(store.rememberedName("u1")).toBe("Talk.mp4");
    runs[0].d.resolve(ITEM);
    await flush();
    expect(store.snapshot()).toEqual([]);
    expect(onDone).toHaveBeenCalledWith(ITEM);
    expect(storage.m.size).toBe(0);
    expect(win.removeEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("keeps a failed job with its error and stops guarding unload", async () => {
    const { store, runs, win } = setup();
    const onError = vi.fn();
    store.start(api, INPUT, { onError });
    runs[0].opts.onItem?.("u1");
    const err = new ApiError(500, "boom");
    runs[0].d.reject(err);
    await flush();
    expect(store.snapshot()[0]).toMatchObject({ itemId: "u1", state: "failed", error: err });
    expect(onError).toHaveBeenCalledWith(err);
    expect(win.removeEventListener).toHaveBeenCalled();
  });

  it("retries a failed job as a resume of the same item with the same file", async () => {
    const { store, runs } = setup();
    const key = store.start(api, INPUT, { chunkBytes: 4 });
    runs[0].opts.onItem?.("u1");
    runs[0].d.reject(new ApiError(0, "Network error"));
    await flush();
    const next = store.retry(api, key);
    expect(next).not.toBeNull();
    expect(runs[1].input).toBe(runs[0].input);
    expect(runs[1].opts).toMatchObject({ resumeItemId: "u1", chunkBytes: 4 });
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0].state).toBe("uploading");
  });

  it("cancel aborts the upload, deletes the item and ignores the late rejection", async () => {
    const { store, runs, remove, storage } = setup();
    const onError = vi.fn();
    const key = store.start(api, INPUT, { onError });
    runs[0].opts.onItem?.("u1");
    await store.cancel(api, key);
    expect(runs[0].opts.signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith(api, "u1");
    expect(store.snapshot()).toEqual([]);
    expect(storage.m.size).toBe(0);
    runs[0].d.reject(new ApiError(0, "Request aborted"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([]);
  });

  it("dismiss only drops the local card", async () => {
    const { store, runs, remove } = setup();
    const key = store.start(api, INPUT);
    runs[0].d.reject(new ApiError(500, "boom"));
    await flush();
    store.dismiss(key);
    expect(store.snapshot()).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("survives a storage that throws", () => {
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    const store = createUploadStore({ upload: vi.fn(() => new Promise<LibraryItem>(() => {})), storage: () => throwing, win: () => null });
    store.start(api, INPUT);
    expect(store.rememberedName("u1")).toBeNull();
  });
});
