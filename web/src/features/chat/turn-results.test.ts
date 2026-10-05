import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TurnResults, type TurnChange } from "./turn-results";

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
    await vi.waitFor(() => expect(changes.at(-1)).toEqual(["u1", { assessment: { status: "error" } }]));
    const late = setup({ "POST /api/speech/assessments": () => json(ASSESSED), "PATCH /api/messages/m1": () => json({ error: "boom" }, 500) });
    late.results.start("u2", { text: "I like it", wav: WAV });
    await late.results.saved("u2", "m1");
    await vi.waitFor(() => expect(late.calls("PATCH", "/api/messages/m1")).toHaveLength(1)); // 不抛出
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});
