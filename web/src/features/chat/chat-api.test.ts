import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { createConversation, createMessages, deleteConversation, deleteMessage, listConversations, listMessages, updateConversation } from "./chat-api";

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
});
