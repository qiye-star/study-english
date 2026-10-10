import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import en from "./i18n/en.json";
import zh from "./i18n/zh-CN.json";
import { createFetchMock, json } from "~/test/fetch-mock";
import { type Card, fetchToday, reviewBatch, submitAnswer, submitSpell, WORDBOOK_SERVER_ERRORS } from "./wordbook-api";

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

  it("maps every server error to an i18n key present in both languages", () => {
    expect(Object.keys(WORDBOOK_SERVER_ERRORS).sort()).toEqual([
      "AI explanation unavailable", "Book is not active", "Book not found", "Daily answer limit reached",
      "Daily new-word limit reached", "Daily report limit reached",
      "No active book", "Question type mismatch", "Sentence changed", "Word not found", "Wordbook data unavailable", "Wordbook is disabled",
    ]);
    for (const key of Object.values(WORDBOOK_SERVER_ERRORS)) {
      expect(typeof lookup(en, key), key).toBe("string");
      expect(typeof lookup(zh, key), key).toBe("string");
    }
  });
});
