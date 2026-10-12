import { describe, expect, it } from "vitest";
import { stepLabel } from "./step-labels";
import { liveAsTrace, normalizeTrace, reduceLive, sourcesOf, startLive, summarize, withNote } from "./trace";
import type { AgentStep } from "./types";
import i18n from "~/i18n";
import "./locales";

const step = (id: string, over: Partial<AgentStep> = {}): AgentStep =>
  ({ id, group: "tool", key: "word_lookup", status: "run", labelKey: "x", private: false, ...over });

describe("live trace reducer (spec §5)", () => {
  it("upserts steps by id, records thought and meta, and moves through the phases", () => {
    let live = startLive(1000);
    live = reduceLive(live, { type: "start", turnId: "t1" });
    live = reduceLive(live, { type: "step", step: step("a") });
    live = reduceLive(live, { type: "step", step: step("a", { status: "done", ms: 90, params: { word: "give up" } }) });
    live = reduceLive(live, { type: "thought", thought: { source: "summary", text: "x" } });
    expect(live.steps).toEqual([step("a", { status: "done", ms: 90, params: { word: "give up" } })]);
    expect(live.phase).toBe("prep");
    const streaming = reduceLive(live, { type: "delta", text: "Hi" });
    expect(streaming.phase).toBe("streaming");
    expect(reduceLive(streaming, { type: "delta", text: "!" })).toBe(streaming); // 增量不触发重绘
    expect(reduceLive(streaming, { type: "done", usage: null, trace: null, textLen: 3 }).phase).toBe("done");
    expect(reduceLive(streaming, { type: "error", code: "limit" }).phase).toBe("error");
    expect(liveAsTrace(streaming, 3500)).toEqual({ v: 1, ms: 2500, steps: streaming.steps, thought: streaming.thought });
  });

  it("summarizes whole seconds (at least 1) and successful tools only", () => {
    expect(summarize({ ms: 3400, steps: [step("a", { status: "done" }), step("b", { status: "fail" }), step("c", { group: "context", status: "done" })] }))
      .toEqual({ seconds: 3, tools: 1 });
    expect(summarize({ ms: 120, steps: [] })).toEqual({ seconds: 1, tools: 0 });
  });

  it("lists sources from successful tools, one chip per key + word", () => {
    const steps = [
      step("a", { status: "done", params: { word: "give up" } }), step("b", { status: "done", params: { word: "give up" } }),
      step("c", { status: "done", key: "learned_words", params: { count: 6 } }), step("d", { status: "fail", key: "weak_words" }),
      step("e", { status: "done", group: "context", key: "persona" }),
    ];
    expect(sourcesOf(steps).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("normalizeTrace (messages.agent_trace and done.trace)", () => {
  it("reads the stored shape already camelCased by ApiClient, and a shrunk trace without steps", () => {
    const stored = normalizeTrace({
      v: 1, tools: "prefetch", ms: { ctx: 1, ttft: 2, total: 2100 },
      steps: [{ key: "persona", group: "context", status: "done", ms: 0, private: false, label: "agents.step.persona" }],
      thought: { source: "reasoning", text: "t", chars: 1 },
    });
    expect(stored).toMatchObject({ ms: 2100, steps: [{ id: "persona-0", key: "persona", labelKey: "agents.step.persona" }], thought: { source: "reasoning", text: "t" } });
    expect(normalizeTrace({ v: 1, tools: "prefetch" })).toEqual({ v: 1, ms: 0, steps: [], thought: null });
    expect(normalizeTrace(null)).toBeNull();
    expect(normalizeTrace("x")).toBeNull();
  });

  it("normalizeTrace keeps note_zh only as a non-blank string, clipped to 80 (stored agent_trace)", () => {
    expect(normalizeTrace({ v: 1, steps: [], note_zh: " 说明 " })!.noteZh).toBe("说明");
    expect(normalizeTrace({ v: 1, steps: [], note_zh: "" })).not.toHaveProperty("noteZh");
    expect(normalizeTrace({ v: 1, steps: [], note_zh: 3 })).not.toHaveProperty("noteZh");
    expect(normalizeTrace({ v: 1, steps: [] })).not.toHaveProperty("noteZh");
  });

  it("withNote puts the done note on the trace and leaves a missing trace or note alone (R-AW11)", () => {
    const trace = normalizeTrace({ v: 1, steps: [] })!;
    expect(withNote(trace, "新")).toEqual({ ...trace, noteZh: "新" });
    expect(withNote(trace, null)).toBe(trace);
    expect(withNote(null, "新")).toBeNull();
  });
});

describe("step labels (INDEX X11)", () => {
  it("maps agents.step.<key> to web.agents.step.<key> and falls back to unknown", () => {
    const t = i18n.getFixedT("en");
    expect(stepLabel(t, { key: "learned_words" })).toBe("Your learned words");
    expect(stepLabel(t, { key: "future_tool" })).toBe("Step");
  });
});
