import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { assessPronunciation, briefWords, deleteAssessment, getAssessment, getAssessmentAudio, listAssessments } from "./assessment-api";

const api = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("assessment api", () => {
  it("uploads multipart with save=true only when requested", async () => {
    const { api: client, mock } = api({ "POST /api/speech/assessments": () => json({ pronunciation_score: 90, assessment_id: "a1" }) });
    const wav = new Blob(["RIFF"], { type: "audio/wav" });
    const res = await assessPronunciation(client, { wav, reference: "Hello", language: "en-US", save: true });
    expect(res).toMatchObject({ pronunciationScore: 90, assessmentId: "a1" });
    const form = mock.calls[0].body as FormData;
    expect(form.get("reference")).toBe("Hello");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.wav");
    expect(file.type).toBe("audio/wav");
    await assessPronunciation(client, { wav, reference: "Hello", language: "en-US", save: false });
    expect((mock.calls[1].body as FormData).has("save")).toBe(false);
  });

  it("lists, fetches, streams audio and deletes", async () => {
    const { api: client, mock } = api({
      "GET /api/assessments": () => json({ assessments: [{ id: "a1", reference_text: "Hi", duration_ms: 500, scores: { pronunciation_score: 80 } }], page: 1, next: null }),
      "GET /api/assessments/a1": () => json({ id: "a1", result: { detail_result: { words: [] } } }),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/wav" } }),
      "DELETE /api/assessments/a1": () => json({ id: "a1" }),
    });
    const page = await listAssessments(client, 2, 10);
    expect(mock.calls[0].url.search).toBe("?page=2&per_page=10");
    expect(page.assessments[0]).toMatchObject({ referenceText: "Hi", durationMs: 500, scores: { pronunciationScore: 80 } });
    expect((await getAssessment(client, "a1")).result.detailResult.words).toEqual([]);
    expect((await getAssessmentAudio(client, "a1")).size).toBe(2);
    expect(await deleteAssessment(client, "a1")).toEqual({ id: "a1" });
  });

  it("sends the source only when saving and condenses words", async () => {
    const mock = createFetchMock({ "POST /api/speech/assessments": () => json({ pronunciation_score: 80, assessment_id: "a1" }) });
    const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await assessPronunciation(client, { wav: new Blob(["RIFF"]), reference: "Hi there", language: "en-US", save: true, source: "chat" });
    expect((mock.calls[0].body as FormData).get("source")).toBe("chat");
    await assessPronunciation(client, { wav: new Blob(["RIFF"]), reference: "Hi there", language: "en-US", save: false, source: "chat" });
    expect((mock.calls[1].body as FormData).has("source")).toBe(false);
    expect(briefWords([{ word: "hi", pronunciationAssessment: { accuracyScore: 55, errorType: "Mispronunciation" } }] as never))
      .toEqual([{ word: "hi", accuracyScore: 55, errorType: "Mispronunciation" }]);
    expect(briefWords(undefined)).toEqual([]);
  });

  it("saves library shadowing with source=library", async () => {
    const mock = createFetchMock({ "POST /api/speech/assessments": () => json({ pronunciation_score: 70, assessment_id: "a2" }) });
    const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await assessPronunciation(client, { wav: new Blob(["RIFF"]), reference: "Hello world.", language: "en-US", save: true, source: "library" });
    const form = mock.calls[0].body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("reference")).toBe("Hello world.");
    expect(mock.calls[0].url.search).toBe("");
  });
});
