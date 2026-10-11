import { describe, expect, it } from "vitest";
import type { AgentStepWire } from "../protocol";
import { initialRoomState, roomReducer, type RoomState } from "../room-state";
import { answer, msg, TUTOR } from "./fixtures";

const step = (id: string, status: AgentStepWire["status"] = "done"): AgentStepWire =>
  ({ id, group: "context", key: "learned_words", status, labelKey: "agents.step.learned_words", private: true });
const fold = (s: RoomState, ...events: Parameters<typeof roomReducer>[1][]) => events.reduce(roomReducer, s);

describe("agents in the room reducer", () => {
  it("collects private steps per question, links the answer and keeps the trace", () => {
    let s = fold(initialRoomState(),
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1", "run") } },
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1") } },
      { type: "event", event: { type: "agent_thought", turnId: "t1", replyTo: 4, thought: { source: "summary", text: "x" } } });
    expect(s.agentRuns[4]).toEqual({ turnId: "t1", steps: [step("s1")], thought: { source: "summary", text: "x" }, answerSeq: null });
    s = fold(s, { type: "event", event: { type: "message", message: answer(5, 4, { agent: { personaId: "builtin:coach", name: "Emma" } }) } },
      { type: "event", event: { type: "message", message: msg({ seq: 6, lane: "private", kind: "agent_trace", replyTo: 5, text: "", meta: { trace: { steps: [] } } }) } });
    expect(s.agentRuns[4].answerSeq).toBe(5);
    expect(s.agentTraces[5]).toEqual({ steps: [] });
    expect(s.messages.map((m) => m.seq)).toEqual([5]); // the private trace never enters the public list
    expect(s.lastSeq).toBe(6);
  });

  it("a new turn for the same question starts a fresh run", () => {
    const s = fold(initialRoomState(),
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1") } },
      { type: "event", event: { type: "agent_step", turnId: "t2", replyTo: 4, step: step("s9") } });
    expect(s.agentRuns[4]).toMatchObject({ turnId: "t2", steps: [step("s9")] });
  });

  it("keeps the tutor with its receipt time; traces from history pages are kept too", () => {
    let s = fold(initialRoomState(), { type: "event", event: { type: "agent_tutor", tutor: TUTOR }, at: 1000 });
    expect([s.tutor, s.tutorAt]).toEqual([TUTOR, 1000]);
    s = fold(s, { type: "event", event: { type: "agent_tutor", tutor: null }, at: 2000 });
    expect(s.tutor).toBeNull();
    s = fold(s, { type: "prepend", messages: [msg({ seq: 2, lane: "private", kind: "agent_trace", replyTo: 1, text: "", meta: { trace: { n: 1 } } })] });
    expect(s.agentTraces[1]).toEqual({ n: 1 });
  });
});
