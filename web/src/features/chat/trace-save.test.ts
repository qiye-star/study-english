import { describe, expect, it } from "vitest";
import type { AgentStep, AgentTrace } from "~/features/agents";
import { traceForSave } from "./trace-save";

const step = (i: number, params?: Record<string, string | number>): AgentStep => ({
  id: `s${i}`, group: "tool", key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", ms: 10, private: false, ...(params ? { params } : {}),
});

describe("traceForSave (server limit 4 KB, spec §4.4)", () => {
  it("keeps a small trace as is and passes null through", () => {
    const small: AgentTrace = { v: 1, ms: 5, steps: [step(1, { word: "x" })], thought: { source: "summary", text: "short" } };
    expect(traceForSave(small)).toBe(small);
    expect(traceForSave(null)).toBeNull();
  });

  it("drops the thought first, then the step params, and never exceeds the limit", () => {
    const big = "w".repeat(5000);
    const withThought: AgentTrace = { v: 1, ms: 5, steps: [step(1)], thought: { source: "summary", text: big } };
    expect(traceForSave(withThought)).toEqual({ ...withThought, thought: null });
    const withParams: AgentTrace = { v: 1, ms: 5, steps: [step(1, { word: big })], thought: null };
    expect(traceForSave(withParams)?.steps[0]).not.toHaveProperty("params");
    const many: AgentTrace = { v: 1, ms: 5, steps: Array.from({ length: 200 }, (_, i) => step(i, { word: "abc" })), thought: null };
    const out = traceForSave(many);
    expect(out === null || new TextEncoder().encode(JSON.stringify(out)).length <= 3800).toBe(true);
  });
});

it("keeps the Chinese note through every shrink step that still saves a trace (R-AW11)", () => {
  const big = { v: 1, ms: 1, noteZh: "说明", thought: { source: "summary" as const, text: "x".repeat(5000) },
    steps: [{ id: "s", group: "tool" as const, key: "word_lookup", status: "done" as const, labelKey: "agents.step.word_lookup", private: false }] };
  expect(traceForSave(big)!.noteZh).toBe("说明");
  expect(traceForSave({ v: 1, ms: 1, steps: [], thought: null, noteZh: "说明" })!.noteZh).toBe("说明");
});
