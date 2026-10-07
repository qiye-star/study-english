import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import * as grammarApi from "~/features/grammar/grammar-api";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { GRAMMAR_FOR_VOICE, TurnResults, type TurnChange } from "./turn-results";

vi.mock("~/features/grammar/grammar-api", async (orig) => {
  const actual = await orig<typeof import("~/features/grammar/grammar-api")>();
  return { ...actual, cachedGrammar: vi.fn(actual.cachedGrammar) };
});
const grammarSignal = (n = 0) => vi.mocked(grammarApi.cachedGrammar).mock.calls[n][2] as AbortSignal;

const WAV = new Blob(["RIFF"], { type: "audio/wav" });
const ASSESSED = {
  pronunciation_score: 82.4, accuracy_score: 80, fluency_score: 85, completeness_score: 90, assessment_id: "a1",
  detail_result: { display: "", words: [{ word: "like", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } }] },
};

function gated(response: () => Response) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { handler: (async () => { await gate; return response(); }) as Handler, release };
}

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock({
    "PATCH /api/messages/m1": () => json({ id: "m1" }),
    "DELETE /api/assessments/a1": () => json({ id: "a1" }),
    ...routes,
  });
  const changes: Array<[string, TurnChange]> = [];
  const results = new TurnResults(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), (key, change) => changes.push([key, change]));
  const calls = (method: string, path: string) => mock.calls.filter((c) => c.method === method && c.url.pathname === path);
  return { mock, results, changes, calls };
}

describe("TurnResults (assessment)", () => {
  it("skips non-English and over-long transcripts without uploading", () => {
    const { results, changes, mock } = setup({});
    results.start("u1", { text: "我想喝咖啡", wav: WAV });
    results.start("u2", { text: "word ".repeat(450), wav: WAV });
    expect(changes).toEqual([
      ["u1", { assessment: { status: "skipped", reason: "non-english" } }],
      ["u2", { assessment: { status: "skipped", reason: "too-long" } }],
    ]);
    expect(mock.calls).toHaveLength(0);
  });

  it("does nothing for typed messages", () => {
    const { results, changes, mock } = setup({});
    results.start("u1", { text: "I like apples very much" });
    expect(changes).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });

  it("assesses with save=true and source=chat, once per turn, and reports the view", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    results.start("u1", { text: "I like it", wav: WAV }); // 重试回复:不重复评测
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    const form = calls("POST", "/api/speech/assessments")[0].body as FormData;
    expect([form.get("reference"), form.get("language"), form.get("save"), form.get("source")]).toEqual(["I like it", "en-US", "true", "chat"]);
    expect(calls("POST", "/api/speech/assessments")).toHaveLength(1);
    expect(changes[0]).toEqual(["u1", { assessment: { status: "pending" } }]);
    expect(changes[1]).toEqual(["u1", {
      assessmentId: "a1",
      assessment: { status: "done", scores: { pronunciationScore: 82.4, accuracyScore: 80, fluencyScore: 85, completenessScore: 90 },
        words: [{ word: "like", accuracyScore: 40, errorType: "Mispronunciation" }] },
    }]);
  });

  it("puts an early result into the save and never patches it", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1" });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("patches a result that arrives after the save", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    expect(results.fieldsForSave("u1")).toEqual({});
    await results.saved("u1", "m1");
    assess.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH", "/api/messages/m1")[0].body as string)).toEqual({ assessment_id: "a1" });
  });

  it("patches a result that arrives while the save is in flight", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    expect(results.fieldsForSave("u1")).toEqual({});
    assess.release();
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1);
    expect(JSON.parse(calls("PATCH", "/api/messages/m1")[0].body as string)).toEqual({ assessment_id: "a1" });
  });

  it("deletes the chat assessment of an abandoned turn, even when it arrives later", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    results.abandon("u1");
    assess.release();
    await vi.waitFor(() => expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(1));
    expect(changes).toEqual([["u1", { assessment: { status: "pending" } }]]); // 放弃后不再更新界面
  });

  it("abandonOpen leaves saving and saved turns alone", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    results.fieldsForSave("u1");
    results.abandonOpen();
    await results.saved("u1", "m1");
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(0);
  });

  it("abandonOpen abandons turns that were never saved", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    results.abandonOpen();
    assess.release();
    await vi.waitFor(() => expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(1));
  });

  it("a failed save keeps the assessment; the retry save carries it", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1" });
    results.saveFailed("u1");
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(0);
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1" });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(0);
  });

  it("a result arriving after saveFailed is delivered and attached by the retry", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    results.fieldsForSave("u1");
    results.saveFailed("u1");
    assess.release();
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(changes[1][1].assessment?.status).toBe("done");
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1" });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(0);
  });

  it("a result arriving after saveFailed is patched when the retry saved without it", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, calls } = setup({ "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: "I like it", wav: WAV });
    results.fieldsForSave("u1");
    results.saveFailed("u1");
    expect(results.fieldsForSave("u1")).toEqual({});
    await results.saved("u1", "m1");
    assess.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
  });

  it("explicit abandon after a failed save deletes exactly once", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    results.fieldsForSave("u1");
    results.saveFailed("u1");
    results.abandon("u1");
    results.abandon("u1");
    results.abandonOpen();
    await vi.waitFor(() => expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(1);
  });

  it("a failed assessment request leaves nothing to delete", async () => {
    const { results, changes, mock } = setup({ "POST /api/speech/assessments": () => json({ error: "Upstream unavailable" }, 502) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    results.abandon("u1");
    await new Promise((r) => setTimeout(r, 20));
    expect(mock.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });

  it("an exception in onChange does not become an unhandled rejection and cleanup still works", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const mock = createFetchMock({ "POST /api/speech/assessments": () => json(ASSESSED), "DELETE /api/assessments/a1": () => json({ id: "a1" }) });
    const results = new TurnResults(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), (_k, c) => {
      if (c.assessment?.status === "done") throw new Error("ui boom");
    });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(mock.calls.some((c) => c.method === "POST")).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    results.abandon("u1");
    await vi.waitFor(() => expect(mock.calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("forget never deletes: open with a result, saving, and a late result", async () => {
    const a = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    a.results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(a.changes).toHaveLength(2));
    a.results.forget("u1");
    a.results.abandonOpen();
    a.results.abandon("u1");

    const b = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    b.results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(b.changes).toHaveLength(2));
    b.results.fieldsForSave("u1");
    b.results.saveFailed("u1");
    b.results.forget("u1");

    const late = gated(() => json(ASSESSED));
    const c = setup({ "POST /api/speech/assessments": late.handler });
    c.results.start("u1", { text: "I like it", wav: WAV });
    c.results.forget("u1");
    late.release();
    await new Promise((r) => setTimeout(r, 30));
    expect(c.changes).toEqual([["u1", { assessment: { status: "pending" } }]]); // 之后到达的结果被忽略

    await new Promise((r) => setTimeout(r, 20));
    for (const s of [a, b, c]) expect(s.mock.calls.filter((x) => x.method === "DELETE" || x.method === "PATCH")).toHaveLength(0);
  });

  it("a throwing onChange cannot skip the late PATCH", async () => {
    const assess = gated(() => json(ASSESSED));
    const mock = createFetchMock({ "POST /api/speech/assessments": assess.handler, "PATCH /api/messages/m1": () => json({ id: "m1" }) });
    const results = new TurnResults(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), (_k, c) => {
      if (c.assessment?.status === "done") throw new Error("ui boom");
    });
    results.start("u1", { text: "I like it", wav: WAV });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    assess.release();
    await vi.waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
  });

  it("ignores a second saved() with a different message id", async () => {
    const assess = gated(() => json(ASSESSED));
    const { results, calls } = setup({ "POST /api/speech/assessments": assess.handler, "PATCH /api/messages/m2": () => json({ id: "m2" }) });
    results.start("u1", { text: "I like it", wav: WAV });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    await results.saved("u1", "m2");
    assess.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    expect(calls("PATCH", "/api/messages/m2")).toHaveLength(0);
  });

  it("does not delete the assessment of a saved turn when abandon is called afterwards", async () => {
    const { results, changes, calls } = setup({ "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    results.abandon("u1");
    expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(0);
  });

  it("reports assessment failures and ignores PATCH failures", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const { results, changes } = setup({ "POST /api/speech/assessments": () => json({ error: "Upstream unavailable" }, 502) });
    results.start("u1", { text: "I like it", wav: WAV });
    await vi.waitFor(() => expect(changes.at(-1)?.[1].assessment).toMatchObject({ status: "error", error: { status: 502, message: "Upstream unavailable" } }));
    const late = setup({ "POST /api/speech/assessments": () => json(ASSESSED), "PATCH /api/messages/m1": () => json({ error: "boom" }, 500) });
    late.results.start("u2", { text: "I like it", wav: WAV });
    await late.results.saved("u2", "m1");
    await vi.waitFor(() => expect(late.calls("PATCH", "/api/messages/m1")).toHaveLength(1)); // 不抛出
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});

const GRAMMAR = { has_errors: true, corrected: "She doesn't like it.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] };
const GRAMMAR_VIEW = { hasErrors: true, corrected: "She doesn't like it.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] };
const on = (context = "") => ({ enabled: true, context });
const TEXT = "She don't like it.";

describe("TurnResults (grammar)", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("enjoy-web");
    resetKvCacheForTests();
    localStorage.clear();
    vi.mocked(grammarApi.cachedGrammar).mockClear();
  });

  it("checks a typed message with the previous reply as context and saves the result with it", async () => {
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR) });
    results.start("u1", { text: TEXT, grammar: on("Does she like tea?") });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(changes).toEqual([["u1", { grammar: { status: "pending" } }], ["u1", { grammar: { status: "done", result: GRAMMAR_VIEW } }]]);
    expect(JSON.parse(calls("POST", "/api/ai/grammar")[0].body as string)).toEqual({ text: TEXT, context: "Does she like tea?" });
    expect(results.fieldsForSave("u1")).toEqual({ grammar: GRAMMAR_VIEW });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("patches a grammar result that arrives after the save", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler });
    results.start("u1", { text: TEXT, grammar: on() });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    grammar.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH", "/api/messages/m1")[0].body as string)).toEqual({ grammar: GRAMMAR });
  });

  it("patches a grammar result that arrives while the save is in flight", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": grammar.handler });
    results.start("u1", { text: TEXT, grammar: on() });
    expect(results.fieldsForSave("u1")).toEqual({});
    grammar.release();
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
    await results.saved("u1", "m1");
    expect(JSON.parse(calls("PATCH", "/api/messages/m1")[0].body as string)).toEqual({ grammar: GRAMMAR });
  });

  it("carries both results in one PATCH when both arrive after the save", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const assess = gated(() => json(ASSESSED));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler, "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    grammar.release();
    assess.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    const bodies = calls("PATCH", "/api/messages/m1").map((c) => JSON.parse(c.body as string));
    expect(Object.assign({}, ...bodies)).toEqual({ assessment_id: "a1", grammar: GRAMMAR });
    expect(bodies.flatMap((b) => Object.keys(b)).sort()).toEqual(["assessment_id", "grammar"]); // each field sent exactly once
  });

  it("serializes patches: a second result waits for the first PATCH", async () => {
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((r) => (releasePatch = r));
    const grammar = gated(() => json(GRAMMAR));
    const assess = gated(() => json(ASSESSED));
    let inflight = 0;
    let maxInflight = 0;
    const { results, calls } = setup({
      "POST /api/ai/grammar": grammar.handler,
      "POST /api/speech/assessments": assess.handler,
      "PATCH /api/messages/m1": async () => { inflight++; maxInflight = Math.max(maxInflight, inflight); await patchGate; inflight--; return json({ id: "m1" }); },
    });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    grammar.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    assess.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1);
    releasePatch();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(2));
    expect(maxInflight).toBe(1);
  });

  it("both results arriving before the save go into the save payload", async () => {
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR), "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    await vi.waitFor(() => expect(changes).toHaveLength(4));
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1", grammar: GRAMMAR_VIEW });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it.each([
    ["disabled", { text: TEXT, grammar: { enabled: false, context: "" } }],
    ["too short", { text: "Hi there", grammar: on() }],
    ["not English", { text: "她不喜欢它今天", grammar: on() }],
    ["too long", { text: "word ".repeat(450), grammar: on() }],
    ["no grammar option", { text: TEXT }],
  ])("skips grammar when %s", (_name, input) => {
    const { results, changes, mock } = setup({});
    results.start("u1", input);
    expect(changes).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });

  it("checks voice messages too (GRAMMAR_FOR_VOICE)", async () => {
    expect(GRAMMAR_FOR_VOICE).toBe(true);
    const { results, calls } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR), "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    await vi.waitFor(() => expect(calls("POST", "/api/ai/grammar")).toHaveLength(1));
    expect(calls("POST", "/api/speech/assessments")).toHaveLength(1);
  });

  it("abandon aborts the grammar wait, reports nothing more, patches nothing, and still deletes the assessment", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const assess = gated(() => json(ASSESSED));
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": grammar.handler, "POST /api/speech/assessments": assess.handler });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    await vi.waitFor(() => expect(calls("POST", "/api/ai/grammar")).toHaveLength(1));
    expect(grammarSignal().aborted).toBe(false);
    results.abandon("u1");
    expect(grammarSignal().aborted).toBe(true);
    grammar.release();
    assess.release();
    await vi.waitFor(() => expect(calls("DELETE", "/api/assessments/a1")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(changes).toEqual([["u1", { assessment: { status: "pending" } }], ["u1", { grammar: { status: "pending" } }]]);
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("forget aborts grammar but never deletes or patches", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, changes, calls, mock } = setup({ "POST /api/ai/grammar": grammar.handler, "POST /api/speech/assessments": () => json(ASSESSED) });
    results.start("u1", { text: TEXT, wav: WAV, grammar: on() });
    await vi.waitFor(() => expect(changes.some(([, c]) => c.assessment?.status === "done")).toBe(true));
    results.forget("u1");
    expect(grammarSignal().aborted).toBe(true);
    grammar.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(changes.filter(([, c]) => c.grammar && c.grammar.status !== "pending")).toEqual([]); // UI stays pending; the page handles it
    expect(mock.calls.filter((c) => c.method === "DELETE" || c.method === "PATCH")).toHaveLength(0);
    expect(calls("POST", "/api/ai/grammar")).toHaveLength(1);
  });

  it("abandonOpen aborts the grammar of unsaved turns", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler });
    results.start("u1", { text: TEXT, grammar: on() });
    await vi.waitFor(() => expect(calls("POST", "/api/ai/grammar")).toHaveLength(1));
    results.abandonOpen();
    expect(grammarSignal().aborted).toBe(true);
    grammar.release(); // do not leave the shared in-flight request hanging for later tests
  });

  it("a grammar failure does not affect the assessment", async () => {
    const { results, changes, calls } = setup({
      "POST /api/ai/grammar": () => json({ error: "Upstream unavailable" }, 502),
      "POST /api/speech/assessments": () => json(ASSESSED),
    });
    results.start("u1", { text: "He go to school.", wav: WAV, grammar: on() }); // distinct text: no cache/in-flight sharing with other tests
    await vi.waitFor(() => expect(changes.filter(([, c]) => c.assessment?.status === "done" || c.grammar?.status === "error")).toHaveLength(2));
    expect(results.fieldsForSave("u1")).toEqual({ assessmentId: "a1" });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("reports errors with the original error for translation, and retries on demand", async () => {
    let fail = true;
    const { results, changes } = setup({ "POST /api/ai/grammar": () => (fail ? json({ error: "Upstream unavailable" }, 502) : json(GRAMMAR)) });
    results.start("u1", { text: TEXT, grammar: on() });
    await vi.waitFor(() => expect(changes.at(-1)?.[1].grammar?.status).toBe("error"));
    const err = changes.at(-1)![1].grammar!.error as { message: string };
    expect(err.message).toBe("Upstream unavailable");
    fail = false;
    results.retryGrammar("u1");
    await vi.waitFor(() => expect(changes.at(-1)).toEqual(["u1", { grammar: { status: "done", result: GRAMMAR_VIEW } }]));
  });

  it("saveFailed keeps the grammar result for the retry save", async () => {
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR) });
    results.start("u1", { text: TEXT, grammar: on() });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(results.fieldsForSave("u1")).toEqual({ grammar: GRAMMAR_VIEW });
    results.saveFailed("u1");
    expect(results.fieldsForSave("u1")).toEqual({ grammar: GRAMMAR_VIEW });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("a grammar result arriving after saveFailed is attached by the retry", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": grammar.handler });
    results.start("u1", { text: TEXT, grammar: on() });
    results.fieldsForSave("u1");
    results.saveFailed("u1");
    grammar.release();
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    expect(results.fieldsForSave("u1")).toEqual({ grammar: GRAMMAR_VIEW });
    await results.saved("u1", "m1");
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
  });

  it("ignores PATCH failures for grammar", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const grammar = gated(() => json(GRAMMAR));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler, "PATCH /api/messages/m1": () => json({ error: "boom" }, 500) });
    results.start("u1", { text: TEXT, grammar: on() });
    results.fieldsForSave("u1");
    await results.saved("u1", "m1");
    grammar.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("reuses the cached result for the same text", async () => {
    const { results, changes, calls } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR) });
    results.start("u1", { text: TEXT, grammar: on() });
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    results.start("u2", { text: TEXT, grammar: on() });
    await vi.waitFor(() => expect(changes).toHaveLength(4));
    expect(calls("POST", "/api/ai/grammar")).toHaveLength(1);
  });
});

describe("TurnResults.checkSaved (a message the server already saved, e.g. a realtime call turn)", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("enjoy-web");
    resetKvCacheForTests();
    localStorage.clear();
    vi.mocked(grammarApi.cachedGrammar).mockClear();
  });

  it("checks grammar with the context and resolves only after the PATCH onto that message", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const patch = gated(() => json({ id: "m1" }));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler, "PATCH /api/messages/m1": patch.handler });
    let done = false;
    const settled = results.checkSaved("c1", "m1", { text: TEXT, grammar: on("Does she like tea?") }).then(() => { done = true; });
    await vi.waitFor(() => expect(calls("POST", "/api/ai/grammar")).toHaveLength(1));
    expect(JSON.parse(calls("POST", "/api/ai/grammar")[0].body as string)).toEqual({ text: TEXT, context: "Does she like tea?" });
    grammar.release();
    await vi.waitFor(() => expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false); // PATCH 还在途
    patch.release();
    await settled;
    expect(JSON.parse(calls("PATCH", "/api/messages/m1")[0].body as string)).toEqual({ grammar: GRAMMAR });
  });

  it("resolves at once and requests nothing when grammar is off, the text is not English, or the key is known", async () => {
    const { results, mock } = setup({ "POST /api/ai/grammar": () => json(GRAMMAR) });
    await results.checkSaved("c1", "m1", { text: TEXT, grammar: { enabled: false, context: "" } });
    await results.checkSaved("c2", "m1", { text: "我想喝咖啡", grammar: on() });
    await results.checkSaved("c2", "m1", { text: TEXT, grammar: on() });
    expect(mock.calls).toHaveLength(0);
  });

  it("a failed check or PATCH still resolves (silently) and patches nothing on failure", async () => {
    const { results, calls } = setup({ "POST /api/ai/grammar": () => json({ error: "boom" }, 500) });
    await results.checkSaved("c1", "m1", { text: TEXT, grammar: on() });
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(0);
    const second = setup({ "POST /api/ai/grammar": () => json(GRAMMAR), "PATCH /api/messages/m1": () => json({ error: "boom" }, 500) });
    await expect(second.results.checkSaved("c1", "m1", { text: TEXT, grammar: on() })).resolves.toBeUndefined();
    expect(second.calls("PATCH", "/api/messages/m1")).toHaveLength(1);
  });

  it("is never abandoned by abandonOpen (the message is already saved)", async () => {
    const grammar = gated(() => json(GRAMMAR));
    const { results, calls } = setup({ "POST /api/ai/grammar": grammar.handler });
    const settled = results.checkSaved("c1", "m1", { text: TEXT, grammar: on() });
    results.abandonOpen();
    grammar.release();
    await settled;
    expect(calls("PATCH", "/api/messages/m1")).toHaveLength(1);
  });
});
