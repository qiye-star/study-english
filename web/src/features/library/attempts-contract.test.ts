import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { listAttempts, patchSegment, recordAttempt, SHADOW_SERVER_ERRORS } from "./attempts-api";
import { analyzeSegment, translateSegments } from "./library-api";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * server/tests/fixtures/library_contract.json 由 server/tests/test_library_contract.py 对真实应用录制(spec §9)。
 * 键名 = 夹具的真实键:`attempts`、`attempt_post`、`segment_patch`、`translate`、`analysis`、`item_detail_with_ai`、`errors`。
 * W2 在 S1 之后合并,夹具必须存在(不跳过)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/library_contract.json");
const HAS_FIXTURE = existsSync(FIXTURE);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<string, any> = HAS_FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};
const api = (routes: Parameters<typeof createFetchMock>[0]) => new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(routes).fetch });
const at = (d: unknown, key: string) => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], d);

describe("library shadowing payloads (recorded from the real server)", () => {
  it("has the server-recorded fixture (never skipped)", () => {
    expect(HAS_FIXTURE).toBe(true);
  });

  it("attempt rows carry the fields the panel reads", async () => {
    const rows = C.attempts.attempts;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(camelcaseKeys(rows[0], { deep: true })).sort()).toEqual(["bestScore", "count", "lastAt", "segIdx"]);
    const parsed = await listAttempts(api({ "GET /api/library/items/i1/attempts": () => json(C.attempts) }), "i1");
    expect(parsed).toHaveLength(rows.length);
    expect(parsed[0]).toEqual({ segIdx: 0, bestScore: 88, count: 1, lastAt: "2026-01-01T00:00:00Z" });
  });

  it("the attempt create response is {seg_idx, score} and the client sends {seg_idx, assessment_id}", async () => {
    expect(Object.keys(C.attempt_post).sort()).toEqual(["score", "seg_idx"]);
    const mock = createFetchMock({ "POST /api/library/items/i1/attempts": () => json(C.attempt_post) });
    const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await recordAttempt(client, "i1", { segIdx: 0, assessmentId: "a1" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ seg_idx: 0, assessment_id: "a1" });
  });

  it("the segment PATCH response ({segment}) parses into a segment with its D8 fields", async () => {
    const raw = camelcaseKeys(C.segment_patch.segment, { deep: true }) as Record<string, unknown>;
    const base = { idx: 0, startMs: 500, endMs: 3000, text: "Hello there, my friend." };
    const saved = await patchSegment(api({ "PATCH /api/library/items/i1/segments/0": () => json(C.segment_patch) }), "i1", 0, { startMs: 400 }, base);
    expect(saved).toEqual({ ...raw });
    expect(saved.hasAnalysis).toBe(false);
  });

  it("translate replies {segments: [{idx, zh}], limited} and W1's client parses it", async () => {
    expect(Object.keys(C.translate).sort()).toEqual(["limited", "segments"]);
    const parsed = await translateSegments(api({ "POST /api/library/items/i1/translate": () => json(C.translate) }), "i1", [0, 1], "zh-CN");
    expect(parsed.items.length).toBe(C.translate.segments.length);
    expect(parsed.items[0].zh.length).toBeGreaterThan(0);
    expect(parsed.limited).toBe(false);
  });

  it("analysis replies {analysis, cached} and W1's client parses it", async () => {
    const parsed = await analyzeSegment(api({ "POST /api/library/items/i1/segments/0/analysis": () => json(C.analysis) }), "i1", 0, "zh-CN");
    expect(parsed.analysis.length).toBeGreaterThan(0);
    expect(typeof parsed.cached).toBe("boolean");
  });

  it("segment details carry has_analysis (boolean), not the analysis text", () => {
    for (const seg of C.item_detail_with_ai) {
      expect(typeof seg.has_analysis).toBe("boolean");
      expect(seg).not.toHaveProperty("analysis");
    }
  });

  it("every server error text the shadow panel can meet maps to a string that exists in both languages", () => {
    const errors = C.errors as Record<string, string>;
    for (const code of ["not_found", "segment_missing", "bad_times", "bad_text", "no_changes", "not_ready", "assessment", "ai_disabled", "ai_user_cap", "ai_global_cap", "ai_unavailable", "language"]) {
      const key = SHADOW_SERVER_ERRORS[errors[code]];
      expect(key, `${code}: ${errors[code]}`).toBeTruthy();
      expect(typeof at(en, key), `en ${key}`).toBe("string");
      expect(typeof at(zh, key), `zh ${key}`).toBe("string");
    }
  });
});
