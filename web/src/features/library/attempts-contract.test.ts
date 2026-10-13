import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { analyzeSegment, listAttempts, patchSegment, translateSegments } from "./attempts-api";

/**
 * server/tests/fixtures/library_contract.json 由 S1 的 server/tests/test_library_contract.py 录制(spec §9)。
 * 键名是计划的假设(Task 0 Step 7 在 S1 合并后核对,PENDING);夹具不存在时整组跳过,缺某一项时对应用例跳过。
 */
const KEYS = {
  attempts: "attempts_list", attempt: "attempt_create", segment: "segment_patch", translate: "translate", analysis: "analysis",
} as const;
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/library_contract.json");
const HAS_FIXTURE = existsSync(FIXTURE);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<string, any> = HAS_FIXTURE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H: Record<string, any> = C.http ?? C;
const api = (routes: Parameters<typeof createFetchMock>[0]) => new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(routes).fetch });

describe.skipIf(!HAS_FIXTURE)("library shadowing payloads (recorded from the real server)", () => {
  it.skipIf(!H[KEYS.attempts])("attempt rows carry the fields the panel reads", async () => {
    const body = H[KEYS.attempts];
    const rows = Array.isArray(body) ? body : body.attempts;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(camelcaseKeys(rows[0], { deep: true }))).toEqual(expect.arrayContaining(["segIdx", "bestScore", "count", "lastAt"]));
    const parsed = await listAttempts(api({ "GET /api/library/items/i1/attempts": () => json(body) }), "i1");
    expect(parsed).toHaveLength(rows.length);
    expect(typeof parsed[0].segIdx).toBe("number");
  });

  it.skipIf(!H[KEYS.attempt])("the attempt create response exists (the client does not read it)", () => {
    expect(H[KEYS.attempt]).toBeDefined();
  });

  it.skipIf(!H[KEYS.segment])("the segment PATCH response parses into a segment", async () => {
    const body = H[KEYS.segment];
    const base = { idx: 0, startMs: 0, endMs: 1, text: "x" };
    const saved = await patchSegment(api({ "PATCH /api/library/items/i1/segments/0": () => json(body) }), "i1", 0, { endMs: 1 }, base);
    const raw = camelcaseKeys((body && body.segment) || body || {}, { deep: true }) as Record<string, unknown>;
    if (typeof raw.startMs === "number") expect(saved.startMs).toBe(raw.startMs);
    if (typeof raw.endMs === "number") expect(saved.endMs).toBe(raw.endMs);
    if (typeof raw.text === "string") expect(saved.text).toBe(raw.text);
    expect(saved.idx).toBe(0);
  });

  it.skipIf(!H[KEYS.translate])("the translate response parses into non-empty rows", async () => {
    const body = H[KEYS.translate];
    const parsed = await translateSegments(api({ "POST /api/library/items/i1/translate": () => json(body) }), "i1", [0], "zh-CN");
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(typeof parsed.items[0].idx).toBe("number");
    expect(parsed.items[0].zh.length).toBeGreaterThan(0);
  });

  it.skipIf(!H[KEYS.analysis])("the analysis response parses into text", async () => {
    const body = H[KEYS.analysis];
    const parsed = await analyzeSegment(api({ "POST /api/library/items/i1/segments/0/analysis": () => json(body) }), "i1", 0, "zh-CN");
    expect(parsed.analysis.length).toBeGreaterThan(0);
    expect(typeof parsed.cached).toBe("boolean");
  });
});
