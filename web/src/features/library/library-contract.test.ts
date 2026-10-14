import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import type { LibraryConfig, LibraryLimits } from "./config";
import { ERROR_KINDS } from "./error-kinds";
import {
  LIBRARY_SERVER_ERRORS, unwrapDetail, unwrapItem, type LibraryItem, type LibraryItemDetail, type LibrarySegment, type MediaTicket, type UploadStart,
  type UploadStatus,
} from "./library-api";

/**
 * 契约(spec 2026-10-13-video-import §9):`server/tests/fixtures/library_contract.json` 由 S1 的 test_library_contract.py
 * 对真实应用录制(CONTRACT_UPDATE=1)。`Record<keyof T, true>` 在编译期把键表绑定到 library-api.ts 的类型。
 * W1 在 S1 之后合并,夹具必须存在(不跳过);`import` / `error_texts` / `error_kinds` 由 S2 / Z 补齐前跳过(计划 R-L21)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/library_contract.json");
const contract: Record<string, unknown> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
const c = contract ?? {};
const has = (key: string) => contract !== null && key in contract;
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const keysOf = (o: object) => Object.keys(o).sort();
const cc = <T>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;

const CONFIG: Record<keyof LibraryConfig, true> = { enabled: true, linkImport: true, asr: true, ai: true, limits: true };
const LIMITS: Record<keyof LibraryLimits, true> = {
  maxUploadMb: true, maxDurationMinutes: true, quotaMb: true, usedBytes: true, maxItems: true, chunkBytes: true, formats: true,
};
const ITEM: Record<keyof LibraryItem, true> = {
  id: true, kind: true, source: true, title: true, status: true, stage: true, progress: true, errorKind: true, durationMs: true,
  segCount: true, libraryBytes: true, subSource: true, resumeMs: true, resumeIdx: true, ratePct: true, hasPoster: true,
  lowConfidence: true, rebuildable: true, createdAt: true, lastOpenedAt: true,
};
const DETAIL: Record<keyof LibraryItemDetail, true> = { ...ITEM, segments: true };
const SEGMENT: Record<keyof LibrarySegment, true> = {
  idx: true, startMs: true, endMs: true, text: true, zh: true, zhLang: true, hasAnalysis: true, analysisLang: true,
  flags: true,
};
const START: Record<keyof UploadStart, true> = { itemId: true, chunkBytes: true };
const STATUS: Record<keyof UploadStatus, true> = { itemId: true, status: true, uploadReceived: true, uploadTotal: true, chunkBytes: true };
const TICKET: Record<keyof MediaTicket, true> = { url: true, expiresIn: true };
const STATUSES = ["uploading", "queued", "processing", "ready", "failed", "canceled"];

describe("library contract (server fixture)", () => {
  it("has the server-recorded fixture (S1 merged before W1; never skipped)", () => {
    expect(contract).not.toBeNull();
  });

  it("config matches", () => {
    const config = cc<LibraryConfig>(c.config);
    expect(keysOf(config)).toEqual(keys(CONFIG));
    expect(config.enabled).toBe(true);
    expect(keysOf(config.limits as LibraryLimits)).toEqual(keys(LIMITS));
    expect(config.limits?.chunkBytes).toBe(8388608);
    expect(config.limits?.formats.every((f) => typeof f === "string")).toBe(true);
  });

  it("list items and the detail match", () => {
    const page = cc<{ items: LibraryItem[]; nextCursor: string | null }>(c.items);
    expect(keysOf(page)).toEqual(["items", "nextCursor"]);
    expect(keysOf(page.items[0])).toEqual(keys(ITEM));
    expect(STATUSES).toContain(page.items[0].status);
    // 真实回包是 {item, segments} / {item}:经 library-api 的 unwrap 解开后与类型键表比对
    expect(keysOf(cc<object>(c.item_detail))).toEqual(["item", "segments"]);
    const detail = unwrapDetail(cc<unknown>(c.item_detail));
    expect(keysOf(detail)).toEqual(keys(DETAIL));
    expect(keysOf(detail.segments[0])).toEqual(keys(SEGMENT));
    expect(detail.segments[0].endMs).toBeGreaterThan(detail.segments[0].startMs);
    expect(keysOf(unwrapItem(cc<unknown>(c.item_patch)))).toEqual(keys(ITEM));
    expect(keysOf(unwrapItem(cc<unknown>(c.cancel)))).toEqual(keys(ITEM));
    expect(keysOf(unwrapDetail(cc<unknown>(c.subtitles_replace)))).toEqual(keys(DETAIL));
  });

  it("upload payloads match", () => {
    const start = cc<UploadStart>(c.upload_start);
    expect(keysOf(start)).toEqual(keys(START));
    expect(start.chunkBytes).toBe(8388608);
    expect(keysOf(cc<UploadStatus>(c.upload_state))).toEqual(keys(STATUS));
    expect(keysOf(cc<UploadStatus>(c.upload_chunk))).toEqual(keys(STATUS));
    const done = unwrapItem(cc<unknown>(c.upload_complete));
    expect(keysOf(done)).toEqual(keys(ITEM));
    expect(done.status).toBe("queued");
  });

  it("the media ticket is a same-origin path whose only query parameter is ticket", () => {
    const ticket = cc<MediaTicket>(c.media_ticket);
    expect(keysOf(ticket)).toEqual(keys(TICKET));
    expect(ticket.url).toMatch(/^\/api\/library\/items\/[^/?#]+\/media\?ticket=[^&#]+$/);
    expect(ticket.expiresIn).toBeGreaterThan(0);
  });

  it.skipIf(!has("import"))("link import returns an item (recorded by S2; Z removes the skip)", () => {
    expect(keysOf(unwrapItem(cc<unknown>(c.import)))).toEqual(keys(ITEM));
  });

  it("segments carry the D8 translation and analysis columns (S1's D8 addendum)", () => {
    const detail = unwrapDetail(cc<unknown>(c.item_detail));
    expect(detail.segments.length).toBeGreaterThan(0);
    for (const seg of detail.segments) {
      expect(keysOf(seg)).toEqual(keys(SEGMENT));
      expect(seg.zh === null || typeof seg.zh === "string").toBe(true);
      expect(seg.zhLang === null || typeof seg.zhLang === "string").toBe(true);
      expect(typeof seg.hasAnalysis).toBe("boolean");
      expect(seg.analysisLang === null || typeof seg.analysisLang === "string").toBe(true);
    }
  });

  it.skipIf(!has("translate"))("translate returns [{idx, zh}] items, bare or wrapped (S1 records it; Z removes the skip)", () => {
    const reply = cc<{ segments?: { idx: number; zh: string }[]; items?: { idx: number; zh: string }[]; limited?: boolean } | { idx: number; zh: string }[]>(c.translate);
    const items = Array.isArray(reply) ? reply : (reply.segments ?? reply.items ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) expect(keysOf(row)).toEqual(["idx", "zh"]);
  });

  it.skipIf(!has("analysis"))("analysis returns {analysis, cached} (S1 records it; Z removes the skip)", () => {
    expect(keysOf(cc<{ analysis: string; cached: boolean }>(c.analysis))).toEqual(["analysis", "cached"]);
  });

  it("reprocess returns the queued item, and refuses a non-recognized item with the fixed text (D7)", () => {
    const queued = unwrapItem(cc<unknown>(c.reprocess));
    expect(keysOf(queued)).toEqual(keys(ITEM));
    expect(queued.status).toBe("queued");
    expect(queued.lowConfidence).toBe(false);
    expect(c.reprocess_error).toEqual({ error: "Item cannot be reprocessed" });
  });

  it("rebuild returns the item with its new sentences, and refuses an item without a kept transcript (plan v2)", () => {
    const rebuilt = unwrapDetail(cc<unknown>(c.rebuild));
    expect(keysOf(rebuilt)).toEqual(keys(DETAIL));
    expect(rebuilt.rebuildable).toBe(true);
    expect(rebuilt.segments.length).toBeGreaterThan(0);
    for (const seg of rebuilt.segments) expect(Array.isArray(seg.flags) && seg.flags.every((f) => typeof f === "string")).toBe(true);
    expect(c.rebuild_error).toEqual({ error: "Item cannot be rebuilt" });
  });

  it("every item carries the low_confidence flag as a boolean", () => {
    const page = cc<{ items: LibraryItem[] }>(c.items);
    for (const item of page.items) expect(typeof item.lowConfidence).toBe("boolean");
    expect(typeof unwrapDetail(cc<unknown>(c.item_detail)).lowConfidence).toBe("boolean");
  });

  it("every fixed server error text is translated (fixture key `errors`: code -> text)", () => {
    for (const text of Object.values(c.errors as Record<string, string>)) expect(LIBRARY_SERVER_ERRORS, text).toHaveProperty([text]);
  });

  it.skipIf(!has("error_kinds"))("the server's error kinds equal the web list (Z removes the skip)", () => {
    expect([...(c.error_kinds as string[])].sort()).toEqual([...ERROR_KINDS].sort());
  });
});
