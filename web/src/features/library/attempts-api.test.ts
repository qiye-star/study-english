import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import {
  BEST_TTL_MS, SHADOW_SERVER_ERRORS, bestBySegment, listAttempts, loadBest, mergeBest, mergeServerBest, noteAttempt,
  patchSegment, peekBest, recordAttempt, resetBestCache, type SavedSegment,
} from "./attempts-api";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const BASE: SavedSegment = { idx: 2, startMs: 1000, endMs: 3000, text: "Hello world." };

describe("library attempts api (spec §9)", () => {
  beforeEach(() => resetBestCache());

  it("lists best scores per sentence from a bare array, id encoded in the path, no query", async () => {
    const { api, mock } = client({
      "GET /api/library/items/i%2F1/attempts": () => json([
        { seg_idx: 0, best_score: 91, count: 2, last_at: "2026-10-13T00:00:00Z" },
        { seg_idx: 4, best_score: null, count: 0, last_at: null },
      ]),
    });
    expect(await listAttempts(api, "i/1")).toEqual([
      { segIdx: 0, bestScore: 91, count: 2, lastAt: "2026-10-13T00:00:00Z" },
      { segIdx: 4, bestScore: null, count: 0, lastAt: null },
    ]);
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
  });

  it("accepts a wrapped list and drops malformed rows", async () => {
    const { api } = client({
      "GET /api/library/items/i1/attempts": () => json({ attempts: [{ seg_idx: 1, best_score: 70, count: 1, last_at: null }, { best_score: 3 }] }),
    });
    expect(await listAttempts(api, "i1")).toEqual([{ segIdx: 1, bestScore: 70, count: 1, lastAt: null }]);
  });

  it("records an attempt with the assessment id in the JSON body", async () => {
    const { api, mock } = client({ "POST /api/library/items/i1/attempts": () => json({ seg_idx: 3, best_score: 82, count: 1 }) });
    await recordAttempt(api, "i1", { segIdx: 3, assessmentId: "a1" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ seg_idx: 3, assessment_id: "a1" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("patches only the given keys and returns the server's {segment} with its D8 fields", async () => {
    const { api, mock } = client({
      "PATCH /api/library/items/i1/segments/2": () => json({ segment: {
        idx: 2, start_ms: 1400, end_ms: 3000, text: "Hello world.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null,
      } }),
    });
    expect(await patchSegment(api, "i1", 2, { startMs: 1400 }, BASE)).toEqual({
      idx: 2, startMs: 1400, endMs: 3000, text: "Hello world.", zh: null, zhLang: null, hasAnalysis: false, analysisLang: null,
    });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ start_ms: 1400 });
  });

  it("falls back to the local edit when the response carries no segment, and also accepts a bare segment", async () => {
    const empty = client({ "PATCH /api/library/items/i1/segments/2": () => new Response(null, { status: 200 }) });
    expect(await patchSegment(empty.api, "i1", 2, { text: "Hello there." }, BASE)).toEqual({ ...BASE, text: "Hello there." });
    const wrapped = client({
      "PATCH /api/library/items/i1/segments/2": () => json({ idx: 2, start_ms: 1000, end_ms: 3200, text: "Hello world." }),
    });
    expect(await patchSegment(wrapped.api, "i1", 2, { endMs: 3200 }, BASE)).toEqual({ ...BASE, endMs: 3200 });
  });

  it("keeps best scores per sentence and merges a new attempt", () => {
    const map = bestBySegment([{ segIdx: 1, bestScore: 80, count: 2, lastAt: null }]);
    const next = mergeBest(map, 1, 86.6, "2026-10-13T01:00:00Z");
    expect(next.get(1)).toEqual({ segIdx: 1, bestScore: 87, count: 3, lastAt: "2026-10-13T01:00:00Z" });
    expect(map.get(1)!.count).toBe(2); // 不改原表
    expect(mergeBest(next, 1, 50, "x").get(1)!.bestScore).toBe(87);
    expect(mergeBest(new Map(), 5, 61.2, "y").get(5)).toEqual({ segIdx: 5, bestScore: 61, count: 1, lastAt: "y" });
  });

  it("prefers the server row unless this page has recorded more attempts", () => {
    const server = bestBySegment([{ segIdx: 1, bestScore: 90, count: 4, lastAt: null }, { segIdx: 2, bestScore: 70, count: 1, lastAt: null }]);
    const local = bestBySegment([{ segIdx: 1, bestScore: 60, count: 1, lastAt: null }, { segIdx: 3, bestScore: 75, count: 1, lastAt: null }]);
    const merged = mergeServerBest(server, local);
    expect(merged.get(1)!.bestScore).toBe(90);
    expect(merged.get(2)!.bestScore).toBe(70);
    expect(merged.get(3)!.bestScore).toBe(75);
  });
});

describe("best-score cache (plan W2 R-SH30)", () => {
  beforeEach(() => resetBestCache());

  it("fetches once per item, shares the in-flight request, and folds in local attempts", async () => {
    const { api, mock } = client({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 80, count: 2, last_at: null }]) });
    const [a, b] = await Promise.all([loadBest(api, "i1"), loadBest(api, "i1")]);
    expect(mock.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect((await loadBest(api, "i1")).get(1)!.bestScore).toBe(80);
    expect(mock.calls).toHaveLength(1);
    expect(peekBest("i1")!.get(1)!.bestScore).toBe(80);
    const noted = noteAttempt("i1", 1, 90.2, "2026-10-13T02:00:00Z");
    expect(noted.get(1)).toMatchObject({ bestScore: 90, count: 3 });
    expect(peekBest("i1")).toBe(noted);
  });

  it("refetches after the ttl and keeps a local attempt the server snapshot does not yet include", async () => {
    const { api, mock } = client({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 80, count: 2, last_at: null }]) });
    await loadBest(api, "i1", 1_000);
    noteAttempt("i1", 1, 95, "x");
    const again = await loadBest(api, "i1", 1_000 + BEST_TTL_MS + 1);
    expect(mock.calls).toHaveLength(2);
    expect(again.get(1)).toMatchObject({ bestScore: 95, count: 3 });
  });

  it("notes an attempt even when the list was never fetched, and a later fetch merges instead of replacing", async () => {
    const { api } = client({ "GET /api/library/items/i2/attempts": () => json([{ seg_idx: 7, best_score: 60, count: 1, last_at: null }]) });
    noteAttempt("i2", 3, 77, "x");
    const loaded = await loadBest(api, "i2");
    expect(loaded.get(3)).toMatchObject({ bestScore: 77, count: 1 });
    expect(loaded.get(7)).toMatchObject({ bestScore: 60, count: 1 });
  });

  it("does not cache a failed fetch", async () => {
    let fail = true;
    const { api, mock } = client({ "GET /api/library/items/i3/attempts": () => (fail ? json({ error: "boom" }, 500) : json([])) });
    await expect(loadBest(api, "i3")).rejects.toBeInstanceOf(ApiError);
    fail = false;
    expect((await loadBest(api, "i3")).size).toBe(0);
    expect(mock.calls).toHaveLength(2);
  });
});

describe("server error texts (real server/app/library/errors.py)", () => {
  it("maps the sentence errors the real server sends to the shadow strings", () => {
    expect(SHADOW_SERVER_ERRORS["Not Found"]).toBe("web.library.shadow.errors.notFound");
    expect(SHADOW_SERVER_ERRORS["Sentence not found"]).toBe("web.library.shadow.errors.notFound");
    expect(SHADOW_SERVER_ERRORS["Invalid sentence times"]).toBe("web.library.shadow.errors.badTimes");
    expect(SHADOW_SERVER_ERRORS["Invalid sentence text"]).toBe("web.library.shadow.errors.badText");
    expect(SHADOW_SERVER_ERRORS["Item is not ready"]).toBe("web.library.errors.notReady"); // 底表来自 W1
  });

  it("maps every server error to a key that exists in both languages", () => {
    const at = (d: unknown, key: string) => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], d);
    expect(Object.keys(SHADOW_SERVER_ERRORS).length).toBeGreaterThan(0);
    for (const key of Object.values(SHADOW_SERVER_ERRORS)) {
      expect(typeof at(en, key), `en ${key}`).toBe("string");
      expect(typeof at(zh, key), `zh ${key}`).toBe("string");
    }
  });
});
