import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { createFetchMock, json } from "~/test/fetch-mock";
import { CHAT_HOME_SERVER_ERRORS, getChatHomeConfig, getChatPrefs, markGreetingSeen, patchChatPrefs, postToday } from "./chat-home-api";

const CONV = { id: "c1", name: "2026-10-23", daily_date: "2026-10-23", config: {} };
function setup() {
  const mock = createFetchMock({
    "GET /api/chat-home/config": () => json({ enabled: true, llm: false }),
    "GET /api/chat-home/settings": () => json({ greeting_trigger: "off", language: "zh", daily_persona_id: "builtin:partner", include_stats: false }),
    "PATCH /api/chat-home/settings": () => json({ greeting_trigger: "every_open", language: "en", daily_persona_id: "builtin:partner", include_stats: true }),
    "POST /api/chat-home/today": () => json({ local_date: "2026-10-23", status: "off", conversation: CONV, greeting: null }),
    "POST /api/chat-home/greetings/g%2F1/seen": () => json({ first_seen_at: "2026-10-23T00:00:00Z" }),
  });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

describe("chat home api", () => {
  it("GET config / settings carry no query and no body", async () => {
    const { api, mock } = setup();
    expect(await getChatHomeConfig(api)).toEqual({ enabled: true, llm: false });
    expect(await getChatPrefs(api)).toMatchObject({ greetingTrigger: "off", includeStats: false });
    for (const c of mock.calls) {
      expect(c.url.search).toBe("");
      expect(c.body).toBeUndefined();
    }
  });

  it("PATCH settings sends snake_case partial keys", async () => {
    const { api, mock } = setup();
    await patchChatPrefs(api, { includeStats: false });
    await patchChatPrefs(api, { greetingTrigger: "every_open", dailyPersonaId: "builtin:coach" });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ include_stats: false });
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ greeting_trigger: "every_open", daily_persona_id: "builtin:coach" });
  });

  it("POST today sends only the offset and the request id, with no query", async () => {
    const { api, mock } = setup();
    const r = await postToday(api, { tzOffsetMinutes: 480, clientRequestId: "req-1" });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ tz_offset_minutes: 480, client_request_id: "req-1" });
    expect(mock.calls[0].url.search).toBe("");
    expect(r.greeting).toBeNull();
    expect(r.conversation.dailyDate).toBe("2026-10-23");
  });

  it("seen encodes the id into the path and posts no body", async () => {
    const { api, mock } = setup();
    expect(await markGreetingSeen(api, "g/1")).toEqual({ firstSeenAt: "2026-10-23T00:00:00Z" });
    expect(mock.calls[0].url.pathname).toBe("/api/chat-home/greetings/g%2F1/seen");
    expect(mock.calls[0].body).toBeUndefined();
  });

  it("a 422 invalid surfaces as an ApiError whose text maps to a known key", async () => {
    const mock = createFetchMock({ "PATCH /api/chat-home/settings": () => json({ error: "invalid", field: "language" }, 422) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const err = await patchChatPrefs(api, { language: "zh" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect(Object.keys(CHAT_HOME_SERVER_ERRORS)).toContain((err as ApiError).message);
    const t = ((key: string) => key) as never;
    expect(translateServerError(t, err, CHAT_HOME_SERVER_ERRORS)).toBe("web.chat.home.errors.invalid");
  });
});
