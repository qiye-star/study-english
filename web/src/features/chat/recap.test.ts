import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import {
  RECAP_LIMITS, RECAP_SYSTEM_PROMPT, buildRecapRequest, computeRecapFacts, generateRecap, isRecapStale, parseRecap, readStoredRecap,
} from "./recap";
import type { StoredRecap } from "./chat-api";
import type { UiMessage } from "./ui-message";

const score = (pronunciationScore: number) => ({ pronunciationScore, accuracyScore: 0, fluencyScore: 0, completenessScore: 0 });
const MESSAGES: UiMessage[] = [
  { key: "a0", role: "assistant", content: "Welcome!", status: "done" },
  { key: "u1", role: "user", content: "I goes home.", status: "done",
    assessment: { status: "done", scores: score(70), words: [{ word: "Goes", accuracyScore: 30, errorType: "None" }, { word: "home", accuracyScore: 95, errorType: "None" }] },
    grammar: { status: "done", result: { hasErrors: true, corrected: "I go home.", errors: [{ original: "goes", corrected: "go", category: "agreement", explanation: "" }] } } },
  { key: "a1", role: "assistant", content: "Nice.", status: "done" },
  { key: "u2", role: "user", content: "Yesterday I go there.", status: "done",
    assessment: { status: "done", scores: score(81), words: [{ word: "goes", accuracyScore: 20, errorType: "Mispronunciation" }] },
    grammar: { status: "done", result: { hasErrors: true, corrected: "Yesterday I went there.", errors: [
      { original: "go", corrected: "went", category: "tense", explanation: "" }, { original: "there", corrected: "there", category: "agreement", explanation: "" },
    ] } } },
  { key: "u3", role: "user", content: "pending", status: "done", assessment: { status: "pending" }, grammar: { status: "skipped" } },
  { key: "x", role: "assistant", content: "boom", status: "error" },
];
const VALID = {
  summary_zh: "你们聊了回家的话题。", new_expressions: [{ text: "head home", zh: "回家" }], suggestions_zh: ["注意第三人称单数。"],
};

describe("recap facts (R13)", () => {
  it("counts user messages, averages arrived scores, groups grammar issues and de-duplicates poor words", () => {
    const facts = computeRecapFacts(MESSAGES);
    expect(facts.userMessages).toBe(3);
    expect(facts.avgPronunciation).toBe(76); // (70 + 81) / 2 = 75.5 → 76
    expect(facts.grammarCounts).toEqual([{ category: "agreement", count: 2 }, { category: "tense", count: 1 }]);
    expect(facts.grammarItems[0]).toEqual({ category: "agreement", original: "goes", corrected: "go", sentence: "I go home." });
    expect(facts.grammarItems).toHaveLength(3);
    expect(facts.poorWords).toEqual(["goes"]);
  });

  it("is empty for a conversation without user messages", () => {
    expect(computeRecapFacts([MESSAGES[0]])).toEqual({ userMessages: 0, avgPronunciation: null, grammarCounts: [], grammarItems: [], poorWords: [] });
  });

  it("detects a stale recap by the number of finished messages", () => {
    const recap: StoredRecap = { generatedAt: "x", messageCount: 5, level: "auto", summaryZh: "s", newExpressions: [], suggestionsZh: [] };
    expect(isRecapStale(recap, MESSAGES)).toBe(false); // 5 条 done
    expect(isRecapStale(recap, [...MESSAGES, { key: "u9", role: "user", content: "more", status: "done" }])).toBe(true);
  });
});

describe("recap prompt and parsing", () => {
  it("sends the facts and the clipped, recent conversation as data, with the level hint", () => {
    const long = Array.from({ length: 50 }, (_, i): UiMessage => ({ key: `k${i}`, role: i % 2 ? "user" : "assistant", content: `m${i} ${"y".repeat(600)}`, status: "done" }));
    const [system, user] = buildRecapRequest({ facts: computeRecapFacts(MESSAGES), messages: long, level: "B2", scenarioId: "cafe" });
    expect(system.content).toBe(`${RECAP_SYSTEM_PROMPT}\n\nThe learner is at CEFR B2 level: choose new expressions at or slightly above that level.`);
    const data = JSON.parse(user.content);
    expect(data.scenario).toBe("cafe");
    expect(data.facts).toMatchObject({ user_messages: 3, avg_pronunciation: 76, poor_words: ["goes"] });
    expect(data.facts.grammar_issues[0]).toEqual({ category: "agreement", original: "goes", corrected: "go" });
    const total = data.conversation.reduce((n: number, m: { text: string }) => n + m.text.length, 0);
    expect(total).toBeLessThanOrEqual(RECAP_LIMITS.totalChars);
    expect(data.conversation.at(-1).text.startsWith("m49 ")).toBe(true); // 保留最新的
    expect(data.conversation.every((m: { text: string }) => m.text.length <= RECAP_LIMITS.messageChars)).toBe(true);
  });

  it("parses strictly and enforces the size caps", () => {
    expect(parseRecap(JSON.stringify(VALID))).toEqual({ summaryZh: VALID.summary_zh, newExpressions: VALID.new_expressions, suggestionsZh: VALID.suggestions_zh });
    const big = parseRecap(JSON.stringify({
      summary_zh: "汉".repeat(900),
      new_expressions: [{ text: "x".repeat(81), zh: "dropped" }, ...Array.from({ length: 12 }, (_, i) => ({ text: ` phrase  ${i} `, zh: "汉".repeat(100) }))],
      suggestions_zh: Array.from({ length: 9 }, () => "汉".repeat(300)),
    }));
    expect(big.summaryZh).toHaveLength(400);
    expect(big.newExpressions).toHaveLength(8);
    expect(big.newExpressions[0]).toEqual({ text: "phrase 0", zh: "汉".repeat(60) });
    expect(big.suggestionsZh).toHaveLength(5);
    expect(big.suggestionsZh[0]).toHaveLength(120);
    const stored = { generatedAt: new Date().toISOString(), messageCount: 1000, level: "B1", ...big };
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(6 * 1024); // R14
    for (const bad of [
      "nope", JSON.stringify({ ...VALID, summary_zh: " " }), JSON.stringify({ ...VALID, new_expressions: "x" }),
      JSON.stringify({ ...VALID, suggestions_zh: [1] }), JSON.stringify({ ...VALID, new_expressions: [{ text: 1, zh: "x" }] }),
      JSON.stringify({ summary_zh: "ok" }),
    ]) expect(() => parseRecap(bad)).toThrow("Invalid recap response");
  });

  it("generates a stored recap with one JSON-mode call", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: JSON.stringify(VALID) } }] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const recap = await generateRecap(api, { messages: MESSAGES, level: "auto", scenarioId: null }, undefined, new Date("2026-10-05T12:00:00Z"));
    expect(recap).toEqual({
      generatedAt: "2026-10-05T12:00:00.000Z", messageCount: 5, level: "auto",
      summaryZh: VALID.summary_zh, newExpressions: VALID.new_expressions, suggestionsZh: VALID.suggestions_zh,
    });
    expect(JSON.parse(mock.calls[0].body as string)).toMatchObject({ stream: false, temperature: 0.3, response_format: { type: "json_object" } });
  });

  it("reads a stored recap defensively", () => {
    const ok = { generatedAt: "2026-10-05T12:00:00.000Z", messageCount: 3, level: "B1", summaryZh: "s", newExpressions: [{ text: "a", zh: "b" }], suggestionsZh: ["c"] };
    expect(readStoredRecap(ok)).toEqual(ok);
    for (const bad of <unknown[]>[undefined, null, "x", { ...ok, messageCount: "3" }, { ...ok, newExpressions: [{ text: 1 }] }, { ...ok, suggestionsZh: [2] }, { ...ok, summaryZh: undefined }]) {
      expect(readStoredRecap(bad)).toBeNull();
    }
  });
});

describe("recap storage budget", () => {
  it("stays within 6 KiB even with the widest characters in every field", () => {
    const wide = parseRecap(JSON.stringify({
      summary_zh: "汉".repeat(400),
      new_expressions: Array.from({ length: 8 }, () => ({ text: "汉".repeat(80), zh: "汉".repeat(60) })),
      suggestions_zh: Array.from({ length: 5 }, () => "汉".repeat(120)),
    }));
    const stored = { generatedAt: new Date().toISOString(), messageCount: 100000, level: "auto", ...wide };
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(7 * 1024);
  });

  it("drops stray fields when reading a stored recap", () => {
    const ok = { generatedAt: "g", messageCount: 1, level: "B1", summaryZh: "s", newExpressions: [{ text: "a", zh: "b", extra: 1 }], suggestionsZh: ["c"], junk: "x" };
    expect(readStoredRecap(ok)).toEqual({ generatedAt: "g", messageCount: 1, level: "B1", summaryZh: "s", newExpressions: [{ text: "a", zh: "b" }], suggestionsZh: ["c"] });
  });
});
