import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearWordScores, publishWordScores, useScoredWords, type WordScore } from "./word-tap";

const A: WordScore[] = [{ word: "hello", accuracyScore: 95, errorType: "None" }];
const B: WordScore[] = [{ word: "next", accuracyScore: 60, errorType: "None" }];

afterEach(() => {
  act(() => {
    clearWordScores(1, "Hello world.");
    clearWordScores(2, "Next one.");
  });
});

describe("scored-words store (plan W2 R-SH31)", () => {
  it("serves the published words only to the exact sentence they belong to", () => {
    const mine = renderHook(() => useScoredWords(1, "Hello world."));
    const otherIdx = renderHook(() => useScoredWords(2, "Hello world."));
    const edited = renderHook(() => useScoredWords(1, "Hello there."));
    expect(mine.result.current).toBeNull();
    act(() => publishWordScores(1, "Hello world.", A));
    expect(mine.result.current).toBe(A);
    expect(otherIdx.result.current).toBeNull();
    expect(edited.result.current).toBeNull();
  });

  it("clears only its own entry", () => {
    const mine = renderHook(() => useScoredWords(1, "Hello world."));
    act(() => publishWordScores(1, "Hello world.", A));
    act(() => clearWordScores(2, "Hello world."));
    expect(mine.result.current).toBe(A);
    act(() => clearWordScores(1, "Hello world."));
    expect(mine.result.current).toBeNull();
  });

  it("keeps a single entry: publishing another sentence replaces the previous one", () => {
    const first = renderHook(() => useScoredWords(1, "Hello world."));
    const second = renderHook(() => useScoredWords(2, "Next one."));
    act(() => publishWordScores(1, "Hello world.", A));
    act(() => publishWordScores(2, "Next one.", B));
    expect(first.result.current).toBeNull();
    expect(second.result.current).toBe(B);
  });
});
