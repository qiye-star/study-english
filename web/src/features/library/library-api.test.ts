import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import {
  CHUNK_TIMEOUT_MS, LIBRARY_SERVER_ERRORS, MAX_TRANSLATE_BATCH, analyzeSegment, cancelItem, completeUpload, deleteItem, extOf, fetchPoster,
  getItem, importLink, isAiLimited, limitsOrDefault, listItems, mediaTicket, patchItem, putChunk, putItemSubtitles, putUploadSubtitles,
  reprocessItem, retryItem, startUpload, stemOf, translateSegments, uploadStatus,
} from "./library-api";
import { detailRaw, itemRaw } from "./test-fixtures";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const formOf = (c: RecordedCall) => c.body as FormData;

describe("library api (spec §8, §9)", () => {
  it("lists items with an opaque cursor in the query and nothing else", async () => {
    const { mock, api } = client({
      "GET /api/library/items": (c) => json(c.url.searchParams.get("cursor") ? { items: [], next_cursor: null } : { items: [itemRaw()], next_cursor: "c2" }),
    });
    const first = await listItems(api);
    expect(first.items[0]).toMatchObject({ id: "i1", segCount: 3, libraryBytes: 5 * 1024 * 1024, ratePct: 100, errorKind: null });
    expect(first.nextCursor).toBe("c2");
    expect(mock.calls[0].url.search).toBe("");
    const next = await listItems(api, "c2");
    expect(next).toEqual({ items: [], nextCursor: null });
    expect(mock.calls[1].url.search).toBe("?cursor=c2");
  });

  it("encodes ids in the path, camelCases the detail and keeps sentence text untouched", async () => {
    const { mock, api } = client({ "GET /api/library/items/a%2Fb": () => json(detailRaw({ id: "a/b", resume_idx: 2 })) });
    const detail = await getItem(api, "a/b");
    expect(detail.resumeIdx).toBe(2);
    expect(detail.segments[1]).toEqual({
      idx: 1, startMs: 3200, endMs: 6000, text: "How are you today?", zh: "你今天好吗?", zhLang: "zh-CN", hasAnalysis: false, analysisLang: null,
    });
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
  });

  it("sends patches, retries, cancels and deletes without a query string", async () => {
    const { mock, api } = client({
      "PATCH /api/library/items/i1": () => json(itemRaw({ rate_pct: 75 })),
      "POST /api/library/items/i1/retry": () => json(itemRaw({ status: "queued" })),
      "POST /api/library/items/i1/cancel": () => json(itemRaw({ status: "canceled" })),
      "DELETE /api/library/items/i1": () => new Response(null, { status: 204 }),
    });
    expect((await patchItem(api, "i1", { ratePct: 75 })).ratePct).toBe(75);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ rate_pct: 75 });
    await patchItem(api, "i1", { resumeMs: 12_000, resumeIdx: 3 });
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ resume_ms: 12_000, resume_idx: 3 });
    expect((await retryItem(api, "i1")).status).toBe("queued");
    expect((await cancelItem(api, "i1")).status).toBe("canceled");
    await deleteItem(api, "i1");
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("reprocesses with a bodyless POST and unwraps the queued item", async () => {
    const { mock, api } = client({
      "POST /api/library/items/i1/reprocess": () => json({ item: itemRaw({ status: "queued", progress: 0, sub_source: "asr" }) }),
    });
    const next = await reprocessItem(api, "i1");
    expect(next).toMatchObject({ id: "i1", status: "queued", subSource: "asr", lowConfidence: false });
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].body ?? null).toBeNull();
  });

  it("maps the three reprocess errors to their texts", () => {
    for (const text of ["Item cannot be reprocessed", "Transcription is not available", "Daily transcription limit reached"]) {
      expect(LIBRARY_SERVER_ERRORS).toHaveProperty([text]);
    }
  });

  it("starts uploads with the filename only in the JSON body and sends chunks with a neutral multipart name", async () => {
    const { mock, api } = client({
      "POST /api/library/uploads": () => json({ item_id: "u1", chunk_bytes: 8388608 }),
      "GET /api/library/uploads/u1": () => json({ upload_received: 4, upload_total: 10 }),
      "PUT /api/library/uploads/u1/chunks/3": () => json({ upload_received: 10, upload_total: 10 }),
      "PUT /api/library/uploads/u1/subtitles": () => json({}),
      "POST /api/library/uploads/u1/complete": () => json(itemRaw({ id: "u1", status: "queued" })),
    });
    expect(await startUpload(api, { filename: "My Talk.mp4", size: 10, title: undefined })).toEqual({ itemId: "u1", chunkBytes: 8388608 });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ filename: "My Talk.mp4", size: 10 });
    expect(await uploadStatus(api, "u1")).toEqual({ uploadReceived: 4, uploadTotal: 10 });
    await putChunk(api, "u1", 3, new Blob([new Uint8Array(6)]));
    const chunk = formOf(mock.calls[2]).get("chunk") as File;
    expect(chunk.name).toBe("chunk");
    expect(chunk.size).toBe(6);
    await putUploadSubtitles(api, "u1", new Blob(["WEBVTT\n"]), "My Talk.en.VTT");
    expect((formOf(mock.calls[3]).get("file") as File).name).toBe("subtitles.vtt");
    expect((await completeUpload(api, "u1")).status).toBe("queued");
    expect(mock.calls.map((c) => c.url.pathname).join(" ")).not.toContain("Talk");
    expect(CHUNK_TIMEOUT_MS).toBe(180_000);
  });

  it("replaces subtitles, issues tickets, fetches posters as blobs and imports links in the body", async () => {
    const { mock, api } = client({
      "PUT /api/library/items/f1/subtitles": () => json(itemRaw({ id: "f1", status: "queued" })),
      "POST /api/library/items/i1/media-ticket": () => json({ url: "/api/library/items/i1/media?ticket=abc", expires_in: 1800 }),
      // Response 要给字节而不是 jsdom 的 Blob(Node 的 Response 认不出 jsdom 的 Blob,会把它转成字符串 "[object Blob]")
      "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "image/jpeg" } }),
      "POST /api/library/imports": () => json(itemRaw({ id: "l1", source: "link", status: "queued" })),
    });
    await putItemSubtitles(api, "f1", new Blob(["1\n"]), "whatever.srt");
    expect((formOf(mock.calls[0]).get("file") as File).name).toBe("subtitles.srt");
    expect(await mediaTicket(api, "i1")).toEqual({ url: "/api/library/items/i1/media?ticket=abc", expiresIn: 1800 });
    expect((await fetchPoster(api, "i1")).size).toBe(2);
    const item = await importLink(api, { url: "https://www.youtube.com/watch?v=x", title: "T" });
    expect(item.source).toBe("link");
    expect(mock.calls[3].url.search).toBe("");
    expect(JSON.parse(String(mock.calls[3].body))).toEqual({ url: "https://www.youtube.com/watch?v=x", title: "T" });
  });

  it("asks for translations with the language in the body only and accepts both reply shapes (D8, E12)", async () => {
    const { mock, api } = client({
      "POST /api/library/items/i1/translate": (c) =>
        json(JSON.parse(String(c.body)).indices.length === 1
          ? [{ idx: 0, zh: "你好。" }]
          : { items: [{ idx: 0, zh: "你好。" }, { idx: 1, zh: "你今天好吗?" }], limited: true }),
    });
    expect(await translateSegments(api, "i1", [0], "zh-CN")).toEqual({ items: [{ idx: 0, zh: "你好。" }], limited: false });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ indices: [0], native_language: "zh-CN" });
    expect(mock.calls[0].url.pathname).toBe("/api/library/items/i1/translate");
    expect(mock.calls[0].url.search).toBe("");
    const second = await translateSegments(api, "i1", [0, 1], "zh-CN");
    expect(second.limited).toBe(true);
    expect(second.items).toHaveLength(2);
  });

  it("refuses more than 20 sentences per translate call and sends nothing", async () => {
    const { mock, api } = client({});
    await expect(translateSegments(api, "i1", Array.from({ length: 21 }, (_, i) => i), "zh-CN")).rejects.toBeInstanceOf(RangeError);
    expect(mock.calls).toHaveLength(0);
    expect(MAX_TRANSLATE_BATCH).toBe(20);
  });

  it("asks for one analysis by sentence number and recognises a spent allowance (D8)", async () => {
    let status = 200;
    const { mock, api } = client({
      "POST /api/library/items/i1/segments/4/analysis": () =>
        (status === 200 ? json({ analysis: "Structure: ...", cached: false }) : json({ error: "Daily AI limit reached" }, 429)),
    });
    expect(await analyzeSegment(api, "i1", 4, "zh-CN")).toEqual({ analysis: "Structure: ...", cached: false });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ native_language: "zh-CN" });
    expect(mock.calls[0].url.search).toBe("");
    status = 429;
    const err = await analyzeSegment(api, "i1", 4, "zh-CN").catch((e: unknown) => e);
    expect(isAiLimited(err)).toBe(true);
    expect(isAiLimited(new Error("x"))).toBe(false);
    expect(LIBRARY_SERVER_ERRORS["Daily AI limit reached"]).toBe("web.library.errors.aiLimited");
  });

  it("derives extensions and default titles from file names", () => {
    expect(extOf("Talk.MP4")).toBe("mp4");
    expect(extOf("no-extension")).toBe("");
    expect(stemOf("C:\\videos\\Lesson 3.final.mkv")).toBe("Lesson 3.final");
    expect(stemOf(".hidden")).toBe(".hidden");
    expect(stemOf(`${"a".repeat(300)}.mp3`)).toHaveLength(200);
  });

  it("falls back to the spec defaults when the server sends no limits", () => {
    expect(limitsOrDefault(null)).toMatchObject({ maxUploadMb: 500, quotaMb: 2000, chunkBytes: 8388608, usedBytes: 0 });
  });

  it("maps the fixed server error texts to library keys", () => {
    expect(LIBRARY_SERVER_ERRORS["Library storage quota reached"]).toBe("web.library.errors.quota");
    expect(LIBRARY_SERVER_ERRORS["Invalid URL"]).toBe("web.library.errors.badUrl");
    expect(Object.values(LIBRARY_SERVER_ERRORS).every((k) => k.startsWith("web.library.errors."))).toBe(true);
  });
});
