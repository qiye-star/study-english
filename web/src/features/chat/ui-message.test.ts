import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-api";
import { fromServerMessage, isVoiceMessage } from "./ui-message";

const base = { conversationId: "c", createdAt: "t" };

describe("ui-message", () => {
  it("maps an assistant message without result fields", () => {
    const ui = fromServerMessage({ ...base, id: "a1", role: "assistant", content: "hi", assessmentId: "x" } as ChatMessage);
    expect(ui).toEqual({ key: "a1", id: "a1", role: "assistant", content: "hi", status: "done" });
  });

  it("maps a user message with assessment and grammar", () => {
    const scores = { pronunciationScore: 80 } as never;
    const grammar = { corrected: "x" } as never;
    const ui = fromServerMessage({ ...base, id: "u1", role: "user", content: "yo", assessmentId: "as1",
      assessment: { id: "as1", scores, words: [] }, grammar } as ChatMessage);
    expect(ui).toMatchObject({ key: "u1", assessmentId: "as1", assessment: { status: "done", scores, words: [] }, grammar: { status: "done", result: grammar } });
  });

  it("maps a plain user message", () => {
    const ui = fromServerMessage({ ...base, id: "u2", role: "user", content: "yo" } as ChatMessage);
    expect(ui).toEqual({ key: "u2", id: "u2", role: "user", content: "yo", status: "done" });
  });

  it("detects voice messages by local voice or server assessmentId", () => {
    const m = { key: "k", role: "user", content: "", status: "done" } as const;
    expect(isVoiceMessage({ ...m })).toBe(false);
    expect(isVoiceMessage({ ...m, voice: { phase: "sent", durationMs: 1 } })).toBe(true);
    expect(isVoiceMessage(fromServerMessage({ ...base, id: "u3", role: "user", content: "a", assessmentId: "z" } as ChatMessage))).toBe(true);
    expect(isVoiceMessage({ ...m, role: "assistant", assessmentId: "z" })).toBe(false);
  });
});
