import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { addVocabularyItem, listVocabulary, reviewVocabularyItem } from "./vocabulary-api";

const ITEM = { id: "v1", word: "look up", meaning: "查找", example: null as string | null, source: "lookup", box: 0, due_at: "2026-10-05T00:00:00+00:00", reps: 0, lapses: 0, last_reviewed_at: null as string | null, created_at: "2026-10-05T00:00:00+00:00" };

describe("vocabulary api", () => {
  it("lists with the due filter only when asked, and camelCases the page", async () => {
    const mock = createFetchMock({ "GET /api/vocabulary": () => json({ vocabulary_items: [ITEM], page: 1, next: null, due_count: 1 }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const page = await listVocabulary(api, { perPage: 20, due: true });
    expect(mock.calls[0].url.search).toBe("?page=1&per_page=20&due=true");
    expect(page.dueCount).toBe(1);
    expect(page.vocabularyItems[0]).toMatchObject({ word: "look up", dueAt: ITEM.due_at, lastReviewedAt: null });
    await listVocabulary(api);
    expect(mock.calls[1].url.search).toBe("?page=1&per_page=50");
  });

  it("clips input to the server limits and sends the grade", async () => {
    const mock = createFetchMock({ "POST /api/vocabulary": () => json(ITEM), "POST /api/vocabulary/v1/review": () => json(ITEM) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await addVocabularyItem(api, { word: `  ${"w".repeat(120)} `, meaning: "m".repeat(1200), example: "e".repeat(600), source: "recap" });
    const body = JSON.parse(mock.calls[0].body as string);
    expect([body.word.length, body.meaning.length, body.example.length, body.source]).toEqual([100, 1000, 500, "recap"]);
    await reviewVocabularyItem(api, "v1", "hard");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ grade: "hard" });
  });

  it("clips by code point (never splitting a surrogate pair) and drops control characters", async () => {
    const mock = createFetchMock({ "POST /api/vocabulary": () => json(ITEM) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await addVocabularyItem(api, { word: `a\u0007b ${"😀".repeat(150)}`, meaning: "😀".repeat(1100), source: "manual" });
    const body = JSON.parse(mock.calls[0].body as string);
    expect(Array.from(body.word)).toHaveLength(100);
    expect(body.word.startsWith("ab 😀")).toBe(true);
    expect(Array.from(body.meaning)).toHaveLength(1000);
    expect(body).not.toHaveProperty("example");
  });
});
