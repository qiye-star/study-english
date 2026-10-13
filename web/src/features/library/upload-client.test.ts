import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json, type Handler, type RecordedCall } from "~/test/fetch-mock";
import { itemRaw } from "./test-fixtures";
import { UploadMismatchError, isRetryable, sleepFor, uploadFile } from "./upload-client";

const FILE = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]);
const BASE = "/api/library/uploads/u1";

function setup(extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "POST /api/library/uploads": () => json({ item_id: "u1", chunk_bytes: 4 }),
    [`PUT ${BASE}/chunks/0`]: () => json({ upload_received: 4, upload_total: 10 }),
    [`PUT ${BASE}/chunks/1`]: () => json({ upload_received: 8, upload_total: 10 }),
    [`PUT ${BASE}/chunks/2`]: () => json({ upload_received: 10, upload_total: 10 }),
    [`PUT ${BASE}/subtitles`]: () => json({}),
    [`POST ${BASE}/complete`]: () => json(itemRaw({ id: "u1", status: "queued" })),
    ...extra,
  });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
const route = (c: RecordedCall) => `${c.method} ${c.url.pathname}`;
const chunkSize = (c: RecordedCall) => ((c.body as FormData).get("chunk") as File).size;
const calls = (mock: { calls: RecordedCall[] }, suffix: string) => mock.calls.filter((c) => c.url.pathname.endsWith(suffix));

describe("uploadFile (spec §8, R-L7, R-L8)", () => {
  it("starts, sends subtitles first, then every chunk in order and completes", async () => {
    const { mock, api } = setup();
    const progress: number[] = [];
    const onItem = vi.fn();
    const item = await uploadFile(api, {
      file: FILE, filename: "talk.mp4", title: " Talk ", subtitles: { file: new Blob(["WEBVTT\n"]), filename: "talk.en.vtt" },
    }, { onItem, onProgress: (sent) => progress.push(sent), sleep: vi.fn(async () => {}) });
    expect(item).toMatchObject({ id: "u1", status: "queued" });
    expect(mock.calls.map(route)).toEqual([
      "POST /api/library/uploads", `PUT ${BASE}/subtitles`, `PUT ${BASE}/chunks/0`, `PUT ${BASE}/chunks/1`, `PUT ${BASE}/chunks/2`,
      `POST ${BASE}/complete`,
    ]);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ filename: "talk.mp4", size: 10, title: "Talk" });
    expect(mock.calls.slice(2, 5).map(chunkSize)).toEqual([4, 4, 2]);
    expect(progress).toEqual([0, 4, 8, 10]);
    expect(onItem).toHaveBeenCalledWith("u1");
  });

  it("retries the same chunk after 5xx with 1 s / 2 s back-off", async () => {
    let n = 0;
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({
      [`PUT ${BASE}/chunks/1`]: () => (++n < 3 ? json({ error: "Service Unavailable" }, 503) : json({ upload_received: 8, upload_total: 10 })),
    });
    await uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep });
    expect(calls(mock, "/chunks/1")).toHaveLength(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("gives up after three retries and never completes", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({ [`PUT ${BASE}/chunks/0`]: () => json({ error: "boom" }, 500) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep })).rejects.toMatchObject({ status: 500 });
    expect(calls(mock, "/chunks/0")).toHaveLength(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(calls(mock, "/complete")).toHaveLength(0);
  });

  it("does not retry other client errors", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const { mock, api } = setup({ [`PUT ${BASE}/chunks/0`]: () => json({ error: "Chunk too large" }, 413) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep })).rejects.toMatchObject({ status: 413 });
    expect(calls(mock, "/chunks/0")).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("resumes from the server's received count without starting again or resending subtitles", async () => {
    const { mock, api } = setup({ [`GET ${BASE}`]: () => json({ upload_received: 4, upload_total: 10 }) });
    const progress: number[] = [];
    await uploadFile(api, { file: FILE, filename: "a.mp3", subtitles: { file: new Blob(["x"]), filename: "a.srt" } },
      { resumeItemId: "u1", chunkBytes: 4, onProgress: (s) => progress.push(s), sleep: vi.fn(async () => {}) });
    expect(mock.calls.map(route)).toEqual([`GET ${BASE}`, `PUT ${BASE}/chunks/1`, `PUT ${BASE}/chunks/2`, `POST ${BASE}/complete`]);
    expect(progress).toEqual([4, 8, 10]);
  });

  it("refuses to resume with a file of another size", async () => {
    const { mock, api } = setup({ [`GET ${BASE}`]: () => json({ upload_received: 4, upload_total: 11 }) });
    await expect(uploadFile(api, { file: FILE, filename: "a.mp3" }, { resumeItemId: "u1", chunkBytes: 4 }))
      .rejects.toBeInstanceOf(UploadMismatchError);
    expect(mock.calls.map(route)).toEqual([`GET ${BASE}`]);
  });

  it("re-aligns with the server after a 409 out-of-order answer", async () => {
    const { mock, api } = setup({
      [`PUT ${BASE}/chunks/1`]: () => json({ error: "Unexpected chunk" }, 409),
      [`GET ${BASE}`]: () => json({ upload_received: 8, upload_total: 10 }),
    });
    await uploadFile(api, { file: FILE, filename: "a.mp3" }, { sleep: vi.fn(async () => {}) });
    expect(mock.calls.map(route)).toEqual([
      "POST /api/library/uploads", `PUT ${BASE}/chunks/0`, `PUT ${BASE}/chunks/1`, `GET ${BASE}`, `PUT ${BASE}/chunks/2`,
      `POST ${BASE}/complete`,
    ]);
  });

  it("classifies retryable errors and never retries a user abort", () => {
    const aborted = new AbortController();
    aborted.abort();
    expect(isRetryable(new ApiError(0, "Network error"))).toBe(true);
    expect(isRetryable(new ApiError(0, "Request timed out"))).toBe(true);
    expect(isRetryable(new ApiError(429, "Too many requests, please try again later"))).toBe(true);
    expect(isRetryable(new ApiError(502, "HTTP 502"))).toBe(true);
    expect(isRetryable(new ApiError(404, "Not Found"))).toBe(false);
    expect(isRetryable(new ApiError(0, "Request aborted"), aborted.signal)).toBe(false);
    expect(isRetryable(new Error("x"))).toBe(false);
  });

  it("sleepFor rejects as soon as the upload is aborted", async () => {
    vi.useFakeTimers();
    const ctl = new AbortController();
    const waiting = sleepFor(4000, ctl.signal);
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ status: 0, message: "Request aborted" });
    vi.useRealTimers();
  });
});
