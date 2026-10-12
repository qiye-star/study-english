import { describe, expect, it } from "vitest";
import type { AgentTrace } from "~/features/agents";
import { fromServerMessage } from "./ui-message";

const TRACE: AgentTrace = { v: 1, ms: 3000, steps: [], thought: null };

describe("fromServerMessage with agent traces (spec §4.4)", () => {
  it("puts a stored assistant trace on the bubble; user messages and old replies are unchanged", () => {
    expect(fromServerMessage({ id: "m2", conversationId: "c1", role: "assistant", content: "Hi", createdAt: "", agentTrace: TRACE }))
      .toEqual({ key: "m2", id: "m2", role: "assistant", content: "Hi", status: "done", agent: { trace: TRACE } });
    expect(fromServerMessage({ id: "m3", conversationId: "c1", role: "assistant", content: "Old", createdAt: "" }))
      .toEqual({ key: "m3", id: "m3", role: "assistant", content: "Old", status: "done" });
    expect(fromServerMessage({ id: "m1", conversationId: "c1", role: "user", content: "Q", createdAt: "", agentTrace: TRACE }))
      .not.toHaveProperty("agent");
  });

  it("normalizes the server's compressed trace shape (no step ids, `label`, `tools`) into the UI shape", () => {
    const stored = { v: 1, tools: "prefetch", steps: [{ key: "word_lookup", group: "tool", status: "done", ms: 90, private: true, label: "agents.step.word_lookup" }] } as never;
    const ui = fromServerMessage({ id: "m4", conversationId: "c1", role: "assistant", content: "Hi", createdAt: "", agentTrace: stored });
    expect(ui.agent?.trace?.steps[0]).toMatchObject({ key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", private: true });
  });

  it("fromServerMessage keeps agent_trace.note_zh on the trace", () => {
    const ui = fromServerMessage({ id: "m1", conversationId: "c1", role: "assistant", content: "Hi", agentTrace: { v: 1, steps: [], noteZh: "说明" } } as never);
    expect(ui.agent?.trace?.noteZh).toBe("说明");
  });
});
