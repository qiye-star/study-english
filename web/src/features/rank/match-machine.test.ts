import { describe, expect, it } from "vitest";
import type { Match, Verdict } from "./rank-api";
import { initialMatchState, lastAiLine, matchReducer, type MatchEvent, type MatchState } from "./match-machine";

const match = (over: Partial<Match> = {}): Match => ({
  id: "m", status: "active", fromTier: "gold", toTier: "platinum", turnLimit: 2, attemptNo: 1,
  scenario: { key: "k", titleZh: "退换商品", titleEn: "Returning", briefZh: "b", functions: ["f"] },
  turns: [{ role: "ai", text: "Hi, how can I help?" }], startedAt: "", expiresAt: "", finishedAt: null, ...over,
});
const run = (events: MatchEvent[], from: MatchState = initialMatchState()) => events.reduce(matchReducer, from);

describe("matchReducer", () => {
  it("goes briefing -> ai -> turn -> upload -> ai -> turn -> upload -> grading -> result", () => {
    let s = run([{ type: "loaded", match: match(), verdict: null }]);
    expect(s.phase).toBe("briefing");
    s = run([{ type: "begin" }, { type: "ai_done" }, { type: "press" }, { type: "release" }], s);
    expect(s.phase).toBe("uploading");
    s = matchReducer(s, { type: "turn_ok", result: { turnIndex: 1, transcript: "I bought this", aiLine: "What's wrong?", done: false } });
    expect(s.phase).toBe("ai_speaking");
    expect(lastAiLine(s.match!)).toBe("What's wrong?");
    expect(s.match!.turns.map((t) => t.role)).toEqual(["ai", "user", "ai"]);
    s = run([{ type: "ai_done" }, { type: "press" }, { type: "release" },
      { type: "turn_ok", result: { turnIndex: 2, transcript: "It buzzes", aiLine: null, done: true } }], s);
    expect(s.phase).toBe("grading");
    const verdict = { passed: true } as Verdict;
    s = matchReducer(s, { type: "finished", match: match({ status: "passed" }), verdict });
    expect([s.phase, s.verdict]).toEqual(["result", verdict]);
  });

  it("resumes where the server left off", () => {
    const mid = match({ turns: [{ role: "ai", text: "a" }, { role: "user", text: "b" }, { role: "ai", text: "c" }] });
    expect(run([{ type: "loaded", match: mid, verdict: null }]).phase).toBe("your_turn");
    const full = match({ turnLimit: 1, turns: [{ role: "ai", text: "a" }, { role: "user", text: "b" }] });
    expect(run([{ type: "loaded", match: full, verdict: null }]).phase).toBe("grading");
    expect(run([{ type: "loaded", match: match({ status: "grading_failed", turnLimit: 0 }), verdict: null }]).phase).toBe("grading");
    expect(run([{ type: "loaded", match: match({ status: "failed" }), verdict: { passed: false } as Verdict }]).phase).toBe("result");
    expect(run([{ type: "loaded", match: match({ status: "expired" }), verdict: null }]).phase).toBe("result");
  });

  it("cancel returns to your turn; failures retry the right step", () => {
    let s = run([{ type: "loaded", match: match(), verdict: null }, { type: "begin" }, { type: "ai_done" }, { type: "press" }, { type: "cancel" }]);
    expect(s.phase).toBe("your_turn");
    s = run([{ type: "press" }, { type: "release" }, { type: "failed", error: "说得太短了", retry: "turn" }], s);
    expect([s.phase, s.error]).toEqual(["error", "说得太短了"]);
    expect(matchReducer(s, { type: "retry" }).phase).toBe("your_turn");
    const f = matchReducer({ ...s, retry: "finish" }, { type: "retry" });
    expect(f.phase).toBe("grading");
    expect(matchReducer({ ...s, retry: "load" }, { type: "retry" }).phase).toBe("loading");
  });

  it("ignores events that do not apply and toggles text", () => {
    const s = run([{ type: "loaded", match: match(), verdict: null }]);
    expect(matchReducer(s, { type: "release" })).toBe(s);
    expect(matchReducer(s, { type: "retry" })).toBe(s);
    expect(matchReducer(s, { type: "turn_ok", result: { turnIndex: 1, transcript: "x", aiLine: null, done: false } })).toBe(s);
    expect(matchReducer(s, { type: "toggle_text" }).showText).toBe(true);
    expect(matchReducer(s, { type: "ended", match: match({ status: "abandoned" }) }).phase).toBe("result");
  });
});
