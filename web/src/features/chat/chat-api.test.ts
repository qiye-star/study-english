import { describe, expect, it } from "vitest";
import en from "./i18n/en.json";
import zh from "./i18n/zh-CN.json";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { CHAT_SERVER_ERRORS, createConversation, createMessages, patchMessage, deleteConversation, deleteMessage, listConversations, listMessages, updateConversation } from "./chat-api";

const CONFIG = { systemPrompt: "Be brief", model: "gpt-4o", temperature: 0.7, ttsModel: "openai/tts-1", ttsVoice: "alloy" };
const SNAKE = { system_prompt: "Be brief", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };

describe("chat api", () => {
  it("round-trips conversation config through snake_case", async () => {
    const mock = createFetchMock({
      "POST /api/conversations": () => json({ id: "c1", name: "New conversation", config: SNAKE, created_at: "t", updated_at: "t" }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: SNAKE }),
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => json({ id: "c1" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const created = await createConversation(api, { config: CONFIG });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ config: SNAKE });
    expect(created.config).toEqual(CONFIG);
    await updateConversation(api, "c1", { name: "Hi" });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ name: "Hi" });
    await listConversations(api, 3);
    expect(mock.calls[2].url.search).toBe("?page=3&per_page=20");
    expect(await deleteConversation(api, "c1")).toEqual({ id: "c1" });
  });

  it("saves message pairs", async () => {
    const mock = createFetchMock({
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", conversation_id: "c1", role: "user", content: "Hi" }] }),
      "GET /api/conversations/c1/messages": () => json({ messages: [] }),
      "DELETE /api/messages/m1": () => json({ id: "m1" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const saved = await createMessages(api, "c1", [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }]);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }] });
    expect(saved.messages[0].conversationId).toBe("c1");
    expect(await listMessages(api, "c1")).toEqual({ messages: [] });
    expect(await deleteMessage(api, "m1")).toEqual({ id: "m1" });
  });

  it("saves result fields with messages and patches late results", async () => {
    const grammar = { hasErrors: true, corrected: "She doesn't.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement" as const, explanation: "三单" }] };
    const mock = createFetchMock({
      "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1", role: "user", content: "She don't.", assessment_id: "a1",
        grammar: { has_errors: true, corrected: "She doesn't.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] },
        assessment: { id: "a1", scores: { pronunciation_score: 80 }, words: [{ word: "she", accuracy_score: 90, error_type: "None" }] } }] }),
      "PATCH /api/messages/m1": () => json({ id: "m1", role: "user", content: "She don't.", assessment_id: "a1", grammar: null, assessment: null }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const saved = await createMessages(api, "c1", [{ role: "user", content: "She don't.", assessmentId: "a1", grammar }, { role: "assistant", content: "Why?" }]);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ messages: [
      { role: "user", content: "She don't.", assessment_id: "a1",
        grammar: { has_errors: true, corrected: "She doesn't.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] } },
      { role: "assistant", content: "Why?" },
    ] });
    expect(saved.messages[0].grammar).toEqual(grammar);
    expect(saved.messages[0].assessment?.words).toEqual([{ word: "she", accuracyScore: 90, errorType: "None" }]);
    await patchMessage(api, "m1", { assessmentId: "a1" });
    expect(mock.calls[1].method).toBe("PATCH");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ assessment_id: "a1" });
  });

  it("has translated keys for every server error", () => {
    const lookup = (tree: Record<string, unknown>, key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);
    for (const [msg, key] of Object.entries(CHAT_SERVER_ERRORS)) {
      for (const tree of [en, zh] as Array<Record<string, unknown>>) {
        const text = lookup(tree, key);
        expect(typeof text, `${msg} -> ${key}`).toBe("string");
        expect(text, `${msg} -> ${key}`).not.toBe(msg);
        expect(text, key).not.toBe(key);
      }
    }
  });
});

describe("chat api additions for the chat home", () => {
  it("listConversations adds the optional drawer query only when asked", async () => {
    const mock = createFetchMock({ "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await listConversations(api, 1, 20, { hideIdleDaily: true, tzOffsetMinutes: 480 });
    expect(mock.calls[0].url.search).toBe("?page=1&per_page=20&hide_idle_daily=true&tz_offset_minutes=480");
    await listConversations(api, 2, 20, {});
    expect(mock.calls[1].url.search).toBe("?page=2&per_page=20");
  });

  it("reads dailyDate and zhNote from the wire and writes zh_note as snake_case", async () => {
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [{ id: "c1", name: "2026-10-23", daily_date: "2026-10-23", config: { zh_note: "always" } }], page: 1, next: null }),
      "PATCH /api/conversations/c1": () => json({ id: "c1", name: "x", config: {} }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const page = await listConversations(api);
    expect(page.conversations[0].dailyDate).toBe("2026-10-23");
    expect(page.conversations[0].config.zhNote).toBe("always");
    await updateConversation(api, "c1", { config: { ...CONFIG, zhNote: "never" } });
    expect(JSON.parse(mock.calls[1].body as string).config.zh_note).toBe("never");
  });
});
