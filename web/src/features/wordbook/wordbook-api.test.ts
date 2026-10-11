import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import en from "./i18n/en.json";
import zh from "./i18n/zh-CN.json";
import { createFetchMock, json } from "~/test/fetch-mock";
import { type Card, fetchLearned, fetchLearnedCard, fetchLearnedSummary, fetchToday, startFree, reviewBatch, submitAnswer, submitSpell, WORDBOOK_SERVER_ERRORS } from "./wordbook-api";

const api = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

const lookup = (dict: unknown, key: string) =>
  key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);

describe("wordbook api", () => {
  it("sends the local offset and camelCases today", async () => {
    const { mock, api: client } = api({
      "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0 }),
    });
    expect(await fetchToday(client)).toEqual({ enrollment: null, book: null, plan: null, progress: null, tomorrowDue: 0 });
    expect(mock.calls[0].url.searchParams.get("tz_offset_minutes")).toMatch(/^-?\d+$/);
  });

  it("snake_cases answers and adds tz_offset_minutes", async () => {
    const { mock, api: client } = api({
      "POST /api/wordbook/answers": () => json({ correct: true, outcome: "correct", grade: "good", expected: "talk", diff: null, item: null, applied: false }),
    });
    await submitAnswer(client, { bookId: "cet4", key: "talk", mode: "review", qtype: "spell", typed: "talk", hinted: false });
    const body = JSON.parse(String(mock.calls[0].body));
    expect(body).toMatchObject({ book_id: "cet4", key: "talk", mode: "review", qtype: "spell", typed: "talk", hinted: false });
    expect(typeof body.tz_offset_minutes).toBe("number");
  });

  it("keeps sentence ids and blank answers in order", async () => {
    const { mock, api: client } = api({ "POST /api/wordbook/spell/submit": () => json({ credit: 100, counted: true, words: [] }) });
    await submitSpell(client, { bookId: "junior", setId: "s1", lines: [{ key: "used to", sentenceId: "abcd", answers: [{ typed: "used", hinted: false }, { typed: "to", hinted: true }] }] });
    const body = JSON.parse(String(mock.calls[0].body));
    expect(body).toMatchObject({ book_id: "junior", set_id: "s1" });
    expect(body.lines[0]).toEqual({ key: "used to", sentence_id: "abcd", answers: [{ typed: "used", hinted: false }, { typed: "to", hinted: true }] });
  });

  it("re-keys review cards by their own key (word keys survive the camelCase conversion)", async () => {
    const card = (key: string): Card => ({ key, word: key, us: "", uk: "", senses: [], phrases: [], examples: [] });
    const { api: client } = api({
      // 服务端发的是列表(review m11)
      "POST /api/wordbook/review/batch": () => json({ book_id: "junior", questions: [], cards: [card("used to"), card("well-known")] }),
    });
    const res = await reviewBatch(client);
    expect(res.bookId).toBe("junior");
    expect(Object.keys(res.cards).sort()).toEqual(["used to", "well-known"]);
    expect(res.cards["used to"].word).toBe("used to");
  });

  it("asks for quick recall only when told to and sends ratings as snake_case", async () => {
    const { mock, api: client } = api({
      "POST /api/wordbook/review/batch": () => json({ book_id: "cet4", questions: [], cards: [] }),
      "POST /api/wordbook/answers": () => json({ correct: true, outcome: "know", grade: "good", expected: "talk", correct_option: null, diff: null, item: { box: 2, due_at: "x" }, applied: true, rating: "know", spot_check: false, check: null }),
    });
    await reviewBatch(client, 20, { recall: true });
    await reviewBatch(client);
    const bodies = mock.calls.map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ size: 20, recall: true });
    expect(bodies[1]).not.toHaveProperty("recall");
    const res = await submitAnswer(client, { bookId: "cet4", key: "talk", mode: "learn", qtype: "recall", rating: "know", revealedBefore: false, elapsedMs: 2400 });
    expect(JSON.parse(String(mock.calls[2].body))).toMatchObject({ qtype: "recall", rating: "know", revealed_before: false, elapsed_ms: 2400 });
    expect(res.spotCheck).toBe(false);
    expect(res.rating).toBe("know");
  });

  it("maps every server error to an i18n key present in both languages", () => {
    expect(Object.keys(WORDBOOK_SERVER_ERRORS).sort()).toEqual([
      "AI explanation unavailable", "Book is not active", "Book not found", "Daily answer limit reached",
      "Daily new-word limit reached", "Daily report limit reached",
      "No active book", "Question type mismatch", "Rating is required", "Sentence changed", "Word not found", "Wordbook data unavailable", "Wordbook is disabled",
      // goals v2(spec 2026-10-11 §9)
      "Book not enrolled", "Clear the review backlog first", "Confirmation does not match", "Conflicting review cap",
      "Daily bonus limit reached", "Daily new words out of range", "Daily reset limit reached", "Finish today's new words first",
      "No changes", "No new words left in this book", "Review cap out of range", "Too many settings changes today", "Unlimited reviews are off",
      // learned words and free review
      "Invalid cursor", "Invalid date", "Invalid scope", "No words to review", "Daily free-review limit reached",
    ].sort());
    for (const key of Object.values(WORDBOOK_SERVER_ERRORS)) {
      expect(typeof lookup(en, key), key).toBe("string");
      expect(typeof lookup(zh, key), key).toBe("string");
    }
  });
});

describe("learned words and free review api", () => {
  it("sends the prefix and every filter in the POST body, never in the URL", async () => {
    const { mock, api: client } = api({ "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }) });
    await fetchLearned(client, { q: "ab", tier: "growing", weak: true, since: "2026-10-01" });
    const call = mock.calls[0];
    expect(call.url.search).toBe("");
    expect(call.url.pathname).toBe("/api/wordbook/learned/query");
    expect(JSON.parse(String(call.body))).toEqual({ q: "ab", tier: "growing", weak: true, since: "2026-10-01", tz_offset_minutes: expect.any(Number) });
  });

  it("camelCases the summary and keeps by_book a list", async () => {
    const { api: client } = api({
      "GET /api/wordbook/learned/summary": () => json({
        total: 3, by_box: [1, 1, 1, 0, 0, 0], by_tier: { learning: 2, growing: 1, mastered: 0 }, by_book: [{ book_id: "junior", count: 3 }],
        weak: 1, yesterday: 0, last7: 3,
      }),
    });
    expect(await fetchLearnedSummary(client)).toEqual({
      total: 3, byBox: [1, 1, 1, 0, 0, 0], byTier: { learning: 2, growing: 1, mastered: 0 }, byBook: [{ bookId: "junior", count: 3 }],
      weak: 1, yesterday: 0, last7: 3,
    });
  });

  it("posts the card lookup and the free draw with snake_case bodies and no word in the URL", async () => {
    const { mock, api: client } = api({
      "POST /api/wordbook/learned/card": () => json({ key: "talk" }),
      "POST /api/wordbook/free/start": () => json({ set_id: "abc", scope: "all", mode: "browse", items: [] }),
    });
    await fetchLearnedCard(client, "junior", "talk");
    await startFree(client, { scope: "book", mode: "choice", count: 20, book: "junior" });
    expect(mock.calls.map((c) => c.url.search)).toEqual(["", ""]);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ book_id: "junior", key: "talk" });
    expect(JSON.parse(String(mock.calls[1].body))).toMatchObject({ scope: "book", mode: "choice", count: 20, book: "junior" });
  });

  it("answers can be sent in free mode", async () => {
    const { mock, api: client } = api({ "POST /api/wordbook/answers": () => json({ correct: true, outcome: "correct", grade: "good", expected: "talk", diff: null, item: null, applied: false }) });
    await submitAnswer(client, { bookId: "junior", key: "talk", mode: "free", qtype: "word", choice: "talk" });
    expect(JSON.parse(String(mock.calls[0].body)).mode).toBe("free");
  });
});
