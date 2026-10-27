import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { startWordSpell } from "./word-spell-api";

describe("word spelling API (plan 2026-10-27 R-W3)", () => {
  it("POSTs the count and the timezone offset, never a word in the URL", async () => {
    const mock = createFetchMock({ "POST /api/wordbook/word-spell/start": () => json({ set_id: "abc", book_id: "junior", items: [] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const set = await startWordSpell(api, 20);
    expect(set).toEqual({ setId: "abc", bookId: "junior", items: [] });
    const call = mock.calls[0];
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/api/wordbook/word-spell/start");
    const body = JSON.parse(String(call.body));
    expect(body.count).toBe(20);
    expect(typeof body.tz_offset_minutes).toBe("number");
  });

  it("defaults to ten words", async () => {
    const mock = createFetchMock({ "POST /api/wordbook/word-spell/start": () => json({ set_id: "abc", book_id: "junior", items: [] }) });
    await startWordSpell(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }));
    expect(JSON.parse(String(mock.calls[0].body)).count).toBe(10);
  });
});
