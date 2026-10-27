import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "./strings";
import { camel, checkPackage, deletePhrase, exportBundle, fetchCatalog, importBundle, importLink, listBundles, patchMeta, purgePhrase, putChunk, startReplace, startUpload } from "./api";

const ID = "3f2a9c1e-0000-4000-8000-000000000001";
function stub(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("catalog admin api", () => {
  it("phrases match the server", () => {
    expect(deletePhrase(ID)).toBe("DELETE 3f2a9c1e");
    expect(purgePhrase(ID)).toBe("PURGE 3f2a9c1e");
  });
  it("reads the list and state in camelCase", async () => {
    stub({ items: [{ id: ID, license_note: "VOA", media_missing: false, upload_total: 0 }], state: { proxy_configured: true, ai_today: 3 } });
    const out = await fetchCatalog();
    expect(out.items[0]).toMatchObject({ id: ID, licenseNote: "VOA", mediaMissing: false });
    expect(out.state).toMatchObject({ proxyConfigured: true, aiToday: 3 });
  });
  it("sends snake_case metadata and only the keys given", async () => {
    const calls = stub({ item: { id: ID } });
    await importLink("https://example.invalid/a", { licenseNote: "TED", aiLang: "zh-CN", level: null });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://example.invalid/a", license_note: "TED", ai_lang: "zh-CN", level: null });
    await patchMeta(ID, { tags: ["a"] });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ tags: ["a"] });
    expect(calls[1].init.method).toBe("PATCH");
  });
  it("puts chunks as multipart", async () => {
    const calls = stub({ catalog_id: ID, status: "uploading", upload_received: 3, upload_total: 3, chunk_bytes: 8 });
    const state = await putChunk(ID, 0, new Blob([new Uint8Array([1, 2, 3])]));
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect(state.uploadReceived).toBe(3);
  });
  it("starts a media replacement on the same item", async () => {
    const calls = stub({ catalog_id: ID, chunk_bytes: 8388608 });
    const out = await startReplace(ID, "talk.mp4", 1234);
    expect(calls[0].url).toBe(`/api/admin/library/catalog/${ID}/replace-media`);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ filename: "talk.mp4", size: 1234 });
    expect(out).toEqual({ catalogId: ID, chunkBytes: 8388608 });
  });
  it("camel keeps arrays", () => expect(camel({ a_b: [{ c_d: 1 }] })).toEqual({ aB: [{ cD: 1 }] }));
  it("exports a bundle with an empty JSON body and reads the counts", async () => {
    const calls = stub({ catalog_id: ID, segments: 2, bytes: 4096 });
    expect(await exportBundle(ID)).toEqual({ catalogId: ID, segments: 2, bytes: 4096 });
    expect(calls[0].url).toBe(`/api/admin/library/catalog/${ID}/bundle`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});
  });
  it("lists bundles with the importable flag", async () => {
    stub({ bundles: [{ catalog_id: ID, bytes: 10, exported_at: "2026-10-21T00:00:00+00:00", importable: true }] });
    expect(await listBundles()).toEqual([{ catalogId: ID, bytes: 10, exportedAt: "2026-10-21T00:00:00+00:00", importable: true }]);
  });
  it("imports with a reason and sends it as the only field", async () => {
    const calls = stub({ id: ID, segments: 2, status: "ready", published: false });
    expect(await importBundle(ID, "restore")).toEqual({ id: ID, segments: 2, status: "ready", published: false });
    expect(calls[0].url).toBe(`/api/admin/library/catalog/bundles/${ID}/import`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reason: "restore" });
  });
  it("startUpload omits source_md5 unless given (body unchanged from today)", async () => {
    const calls = stub({ catalog_id: ID, chunk_bytes: 8 });
    await startUpload("a.mp4", 10, { title: "T" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ filename: "a.mp4", size: 10, title: "T" });
  });
  it("startUpload sends source_md5 as a body field when given", async () => {
    const md5 = "0123456789abcdef0123456789abcdef";
    const calls = stub({ catalog_id: ID, chunk_bytes: 8 });
    const out = await startUpload("media.mp4", 10, { title: "T" }, md5);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ filename: "media.mp4", size: 10, title: "T", source_md5: md5 });
    expect(out).toEqual({ catalogId: ID, chunkBytes: 8 });
    expect(calls[0].url).not.toContain(md5);
  });
  it("checkPackage posts the md5s in the body only, to a fixed URL, and camel-cases matches", async () => {
    const md5 = "0123456789abcdef0123456789abcdef";
    const calls = stub({ matches: [{ source_md5: md5, catalog_id: ID, title: "T", status: "ready", published: false, retired: false, seg_count: 3, duration_ms: 1000, media_missing: false, refs: 0, upload_received: 0, upload_total: 0 }] });
    const out = await checkPackage([md5]);
    expect(calls[0].url).toBe("/api/admin/library/catalog/packages/check");
    expect(calls[0].url).not.toContain(md5);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ source_md5s: [md5] });
    expect(out[0]).toMatchObject({ sourceMd5: md5, catalogId: ID, segCount: 3, mediaMissing: false });
  });
  it("checkPackage splits 1500 md5s into two requests of at most 1000", async () => {
    const md5s = Array.from({ length: 1500 }, (_, i) => i.toString(16).padStart(32, "0"));
    const calls = stub({ matches: [] });
    await checkPackage(md5s);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0].init.body)).source_md5s).toHaveLength(1000);
    expect(JSON.parse(String(calls[1].init.body)).source_md5s).toHaveLength(500);
  });
  it("maps the package-import server errors to Chinese", () => {
    expect(S.errors["Item already imported"]).toMatch(/[\u4e00-\u9fff]/);
    expect(S.errors["Item is published"]).toBeTruthy();
  });
});
