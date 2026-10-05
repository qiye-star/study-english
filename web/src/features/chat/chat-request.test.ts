import { describe, expect, it } from "vitest";
import { buildChatMessages, chatOptions, defaultConversationConfig, effectiveSystemPrompt, displayName, titleFrom, withConfigDefaults, DEFAULT_SYSTEM_PROMPT } from "./chat-request";
import { LEVEL_INSTRUCTIONS } from "./levels";
import { PRESET_SCENARIOS, SCENARIO_RULES } from "./scenarios";

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
    expect(chatOptions(undefined)).toEqual({ bilingual: false, grammarCheck: true, coachMode: false, autoSpeak: true, level: "auto" });
    expect(chatOptions({ bilingual: true, grammarCheck: false, coachMode: true, autoSpeak: false, level: "B2" }))
      .toEqual({ bilingual: true, grammarCheck: false, coachMode: true, autoSpeak: false, level: "B2" });
  });

  it("treats a missing or malformed auto-read / level key as the default (old conversations)", () => {
    expect(chatOptions({ systemPrompt: "x" } as never).autoSpeak).toBe(true);
    expect(chatOptions({ autoSpeak: "no" } as never).autoSpeak).toBe(true);
    expect(chatOptions({ level: "Z9" } as never).level).toBe("auto");
  });

  it("appends the level instruction to the system prompt, before the coaching note", () => {
    const cfg = { ...defaultConversationConfig(AI), systemPrompt: "SYS", level: "B1" as const };
    expect(effectiveSystemPrompt(cfg)).toBe(`SYS\n\n${LEVEL_INSTRUCTIONS.B1}`);
    expect(effectiveSystemPrompt({ ...cfg, level: "auto" })).toBe("SYS");
    expect(effectiveSystemPrompt({ ...cfg, systemPrompt: "  " })).toBe(LEVEL_INSTRUCTIONS.B1);
    expect(buildChatMessages(cfg, [], "hi", 20, "NOTE")[0]).toEqual({ role: "system", content: `SYS\n\n${LEVEL_INSTRUCTIONS.B1}\n\nNOTE` });
    expect(buildChatMessages({ ...cfg, level: undefined }, [], "hi")[0]).toEqual({ role: "system", content: "SYS" });
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
  it("uses the scenario prompt instead of the system prompt for scenario conversations (R3)", () => {
    const cfg = { ...defaultConversationConfig(AI), systemPrompt: "SYS" };
    expect(effectiveSystemPrompt({ ...cfg, scenario: { id: "cafe" }, level: "A2" }))
      .toBe(`${PRESET_SCENARIOS.cafe.role}

${SCENARIO_RULES}

${LEVEL_INSTRUCTIONS.A2}`);
    expect(effectiveSystemPrompt({ ...cfg, scenario: { id: "free" } })).toBe("SYS");
    expect(effectiveSystemPrompt({ ...cfg, scenario: { id: "custom", custom: "" } })).toBe("SYS");
  });
});
