import { describe, expect, it, vi } from "vitest";
import { uploadChunks } from "./upload";

describe("uploadChunks", () => {
  it("sends every chunk in order and reports progress", async () => {
    const send = vi.fn(async (_id: string, n: number) => ({ catalogId: "x", status: "uploading" as const, uploadReceived: (n + 1) * 4, uploadTotal: 10, chunkBytes: 4 }));
    const seen: number[] = [];
    await uploadChunks("x", new Blob([new Uint8Array(10)]), 4, (p) => seen.push(p.sent), undefined, send);
    expect(send.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);
    expect(seen).toEqual([4, 8, 10]);
  });
  it("retries a chunk twice, then gives up", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net"))
      .mockResolvedValue({ catalogId: "x", status: "uploading", uploadReceived: 4, uploadTotal: 4, chunkBytes: 4 });
    await uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, undefined, send);
    expect(send).toHaveBeenCalledTimes(3);
    const fail = vi.fn().mockRejectedValue(new Error("net"));
    await expect(uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, undefined, fail)).rejects.toThrow("net");
    expect(fail).toHaveBeenCalledTimes(3);
  });
  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, ctrl.signal, vi.fn())).rejects.toThrow("aborted");
  });
  it("starts at a given chunk (resume) and keeps progress counted from the file start", async () => {
    const send = vi.fn(async (_id: string, n: number) => ({ catalogId: "x", status: "uploading" as const, uploadReceived: (n + 1) * 4, uploadTotal: 10, chunkBytes: 4 }));
    const seen: number[] = [];
    await uploadChunks("x", new Blob([new Uint8Array(10)]), 4, (p) => seen.push(p.sent), undefined, send, 1);
    expect(send.mock.calls.map((c) => c[1])).toEqual([1, 2]);
    expect(seen).toEqual([8, 10]);
  });
});
