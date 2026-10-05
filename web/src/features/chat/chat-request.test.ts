import { describe, expect, it } from "vitest";
import { buildChatMessages, chatOptions, defaultConversationConfig, displayName, titleFrom, withConfigDefaults, DEFAULT_SYSTEM_PROMPT } from "./chat-request";

const AI = { llmModels: ["gpt-4o"], defaultLlmModel: "gpt-4o", ttsModels: ["openai/tts-1"], voices: {}, defaultTts: { model: "openai/tts-1", voice: "alloy" } };

describe("chat request helpers", () => {
  it("derives defaults from the server config", () => {
    expect(defaultConversationConfig(AI)).toEqual({ systemPrompt: DEFAULT_SYSTEM_PROMPT, model: "gpt-4o", temperature: 0.7, ttsModel: "openai/tts-1", ttsVoice: "alloy" });
    expect(defaultConversationConfig(null)).toMatchObject({ model: "", ttsModel: "", ttsVoice: "" });
    expect(withConfigDefaults({ ttsVoice: "echo", model: undefined }, AI)).toMatchObject({ model: "gpt-4o", ttsVoice: "echo" });
  });

  it("builds system + last 20 turns + the new user message", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `m${i}` }));
    const out = buildChatMessages({ ...defaultConversationConfig(AI), systemPrompt: "SYS" }, [{ role: "system", content: "old" }, ...history], "new");
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out).toHaveLength(22);
    expect(out[1].content).toBe("m5");
    expect(out.at(-1)).toEqual({ role: "user", content: "new" });
    expect(buildChatMessages({ ...defaultConversationConfig(AI), systemPrompt: "  " }, [], "x")).toEqual([{ role: "user", content: "x" }]);
  });

  it("derives chat options with safe defaults", () => {
    expect(chatOptions(undefined)).toEqual({ bilingual: false, grammarCheck: true, coachMode: false });
    expect(chatOptions({ bilingual: true, grammarCheck: false, coachMode: true })).toEqual({ bilingual: true, grammarCheck: false, coachMode: true });
  });

  it("makes short titles", () => {
    expect(titleFrom("  Hello   there ")).toBe("Hello there");
    expect(titleFrom("x".repeat(40))).toBe(`${"x".repeat(29)}…`);
    expect(displayName({ name: "New conversation" } as never, "Untitled")).toBe("Untitled");
    expect(displayName({ name: "Trip" } as never, "Untitled")).toBe("Trip");
  });
  it("appends a coaching note to the system prompt", () => {
    const cfg = { ...defaultConversationConfig(AI), systemPrompt: "SYS" };
    expect(buildChatMessages(cfg, [], "hi", 20, "NOTE")[0]).toEqual({ role: "system", content: "SYS\n\nNOTE" });
    expect(buildChatMessages({ ...cfg, systemPrompt: " " }, [], "hi", 20, "NOTE")[0]).toEqual({ role: "system", content: "NOTE" });
    expect(buildChatMessages(cfg, [], "hi", 20, null)[0]).toEqual({ role: "system", content: "SYS" });
  });
});
