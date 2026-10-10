import { describe, expect, it } from "vitest";
import { MAX_REQUEUE, answerCurrent, isFinished, progressOf, startSession } from "./session-machine";

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
