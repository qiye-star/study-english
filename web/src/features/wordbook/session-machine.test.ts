import { describe, expect, it } from "vitest";
import {
  MAX_REQUEUE, answerCurrent, cardReducer, isFinished, learnTally, planLearnQuiz, progressOf, ratingPayload, slotId, slotKey, startCard,
  startSession, type RatedWord,
} from "./session-machine";

describe("session machine", () => {
  it("requeues wrong answers at the end, at most twice", () => {
    let s = startSession(["a", "b"]);
    s = answerCurrent(s, false);
    expect(s.queue).toEqual(["b", "a"]);
    s = answerCurrent(s, true);
    s = answerCurrent(s, false); // a 第二次答错:再排一次(已达上限 2)
    expect(s.current).toBe("a");
    expect(s.requeued.a).toBe(MAX_REQUEUE);
    s = answerCurrent(s, false); // 上限后答错也算完成
    expect(isFinished(s)).toBe(true);
    expect(s.firstTry).toEqual({ a: false, b: true });
    expect(progressOf(s)).toEqual({ done: 2, total: 2 });
  });

  it("an empty session is finished", () => {
    expect(isFinished(startSession([]))).toBe(true);
    expect(progressOf(startSession([]))).toEqual({ done: 0, total: 0 });
  });

  it("counts progress by distinct words and ignores answers after the end", () => {
    let s = startSession(["a", "b", "c"]);
    s = answerCurrent(s, false);
    expect(progressOf(s)).toEqual({ done: 0, total: 3 });
    s = answerCurrent(answerCurrent(answerCurrent(s, true), true), true);
    expect(isFinished(s)).toBe(true);
    expect(answerCurrent(s, false)).toBe(s);
    expect(s.firstTry).toEqual({ a: false, b: true, c: true });
  });

  it("does not mutate the previous state", () => {
    const s0 = startSession(["a"]);
    const s1 = answerCurrent(s0, false);
    expect(s0.queue).toEqual(["a"]);
    expect(s0.requeued).toEqual({});
    expect(s1).not.toBe(s0);
  });
});

describe("new-word card (spec recall §3)", () => {
  it("a peek before rating is remembered; rating reveals; a second rating is ignored", () => {
    let c = cardReducer(startCard(1000), { type: "reveal" });
    expect(c).toEqual({ revealed: true, peeked: true, rating: null, shownAt: 1000 });
    expect(ratingPayload(c, "know", 3500.4)).toEqual({ rating: "know", revealedBefore: true, elapsedMs: 2500 });
    c = cardReducer(c, { type: "rated", rating: "fuzzy" });
    expect(c.rating).toBe("fuzzy");
    expect(cardReducer(c, { type: "rated", rating: "know" })).toBe(c);
  });

  it("rating without a peek reveals the card but is not a peek", () => {
    const d = cardReducer(startCard(0), { type: "rated", rating: "unknown" });
    expect(d).toEqual({ revealed: true, peeked: false, rating: "unknown", shownAt: 0 });
    expect(cardReducer(d, { type: "reveal" })).toBe(d);
    expect(cardReducer(d, { type: "reset", at: 5 })).toEqual(startCard(5));
  });

  it("「记错了」 turns a rated card into unknown and does nothing before rating", () => {
    expect(cardReducer(startCard(0), { type: "corrected" }).rating).toBeNull();
    expect(cardReducer(cardReducer(startCard(0), { type: "rated", rating: "know" }), { type: "corrected" }).rating).toBe("unknown");
  });

  it("clamps the elapsed time", () => {
    expect(ratingPayload(startCard(10), "know", 5).elapsedMs).toBe(0);
    expect(ratingPayload(startCard(0), "know", 10_000_000).elapsedMs).toBe(600_000);
    expect(ratingPayload(startCard(0), "know", Number.NaN).elapsedMs).toBe(0);
  });
});

describe("round quiz plan (spec recall §3.3)", () => {
  const rated: RatedWord[] = [
    { key: "talk", rating: "know", spotCheck: false }, { key: "used to", rating: "unknown", spotCheck: false },
    { key: "able", rating: "fuzzy", spotCheck: false }, { key: "absorb", rating: "know", spotCheck: true },
    { key: "abandon", rating: "fuzzy", spotCheck: false },
  ];

  it("fuzzy first, unknown twice, spot-checked know once, plain know never", () => {
    expect(planLearnQuiz(rated).map((s) => s.id)).toEqual(["meaning:able", "meaning:abandon", "meaning:used to", "meaning:absorb", "word:used to"]);
    expect(slotKey(slotId("a:b", "word"))).toBe("a:b");
  });

  it("an all-plain-know round has an empty quiz", () => {
    expect(planLearnQuiz([{ key: "talk", rating: "know", spotCheck: false }])).toEqual([]);
  });

  it("tallies ratings, checks and first-try words", () => {
    let s = startSession(planLearnQuiz(rated).map((p) => p.id));
    for (const ok of [true, false, true, true, true, true]) s = answerCurrent(s, ok);
    expect(isFinished(s)).toBe(true);
    expect(learnTally(rated, s.firstTry)).toEqual({
      ratings: { know: 2, fuzzy: 2, unknown: 1 }, checks: { total: 1, passed: 1 }, firstTry: 4, missed: ["abandon"],
    });
  });
});