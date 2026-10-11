import { describe, expect, it } from "vitest";
import { RAW_RECAP, rawSession, toSession } from "./tutor-fixtures";
import { applyMeta, isActive, needsAgentTurn, parseTutorMeta, scoreBars } from "./tutor-model";

describe("tutor model", () => {
  it("parses meta in snake or camel case, drops junk and treats omitted keys as null", () => {
    expect(parseTutorMeta({ step_index: 3, steps_total: 8, verdict: "good", kind: "repeat", done: false, retry: false, say: null }))
      .toEqual({ stepIndex: 3, stepsTotal: 8, verdict: "good", kind: "repeat", done: false, retry: false, say: null });
    expect(parseTutorMeta({ stepIndex: 1, stepsTotal: 5, verdict: "great", kind: "sing", say: "" }))
      .toEqual({ stepIndex: 1, stepsTotal: 5, verdict: null, kind: null, done: false, retry: false, say: null });
    expect(parseTutorMeta({ step_index: 1, steps_total: 3, kind: "words", done: false, retry: false }))
      .toEqual({ stepIndex: 1, stepsTotal: 3, verdict: null, kind: "words", done: false, retry: false, say: null });
    expect(parseTutorMeta(null)).toBeNull();
    expect(parseTutorMeta({ steps_total: 5 })).toBeNull();
  });

  it("an answer meta records the verdict and moves on", () => {
    const next = applyMeta(toSession(rawSession({ hints_used: 1 })),
      { stepIndex: 3, stepsTotal: 5, verdict: "weak", kind: "dictate", done: false, retry: false, say: "I left early." });
    expect([next.stepIndex, next.kind, next.say, next.hintsUsed, next.phase]).toEqual([3, "dictate", "I left early.", 0, "await_answer"]);
    expect(next.answers.at(-1)).toEqual({ index: 1, kind: "words", verdict: "weak" });
  });

  it("a retry keeps the question, hints and answers", () => {
    const s = toSession(rawSession({ hints_used: 1, kind: "repeat" }));
    const next = applyMeta(s, { stepIndex: 2, stepsTotal: 5, verdict: "weak", kind: "repeat", done: false, retry: true, say: null });
    expect([next.stepIndex, next.hintsUsed, next.answers.length]).toEqual([2, 1, s.answers.length]);
  });

  it("the opening meta starts question one; a done meta switches to wrap_up", () => {
    const opening = toSession(rawSession({ phase: "opening", step_index: 1, kind: "ask", answers: [] }));
    const started = applyMeta(opening, { stepIndex: 1, stepsTotal: 5, verdict: null, kind: "ask", done: false, retry: false, say: null });
    expect([started.phase, started.answers]).toEqual(["await_answer", []]);
    const done = applyMeta(toSession(rawSession()), { stepIndex: 5, stepsTotal: 5, verdict: "ok", kind: null, done: true, retry: false, say: null });
    expect([done.phase, done.kind]).toEqual(["wrap_up", null]);
  });

  it("knows when a lesson runs and when the agent must speak first", () => {
    expect(needsAgentTurn(toSession(rawSession({ phase: "ask" })))).toBe(true);
    expect(needsAgentTurn(toSession(rawSession()))).toBe(false);
    expect(needsAgentTurn(null)).toBe(false);
    expect(isActive(toSession(rawSession({ status: "done", phase: "done" })))).toBe(false);
  });

  it("score bars give each verdict its share", () => {
    const recap = toSession(rawSession({ recap: RAW_RECAP })).recap!;
    expect(scoreBars(recap).map((b) => [b.verdict, b.count, b.pct])).toEqual([["good", 2, 40], ["ok", 1, 20], ["weak", 1, 20], ["skip", 1, 20]]);
  });
});
