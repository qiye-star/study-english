import { describe, expect, it } from "vitest";
import { LEVELS, LEVEL_INSTRUCTIONS, levelHint, levelInstruction, normalizeLevel } from "./levels";

describe("levels", () => {
  it("normalizes unknown values to auto", () => {
    expect(LEVELS).toEqual(["auto", "A2", "B1", "B2", "C1"]);
    for (const l of LEVELS) expect(normalizeLevel(l)).toBe(l);
    for (const v of [undefined, null, "", "b1", "A1", 3, {}]) expect(normalizeLevel(v)).toBe("auto");
  });
  it("adds a fixed English instruction except for auto", () => {
    expect(levelInstruction("auto")).toBe("");
    expect(levelInstruction("B1")).toBe(LEVEL_INSTRUCTIONS.B1);
    for (const l of ["A2", "B1", "B2", "C1"] as const) {
      expect(LEVEL_INSTRUCTIONS[l]).toMatch(new RegExp(`^Language level: the learner is at CEFR ${l}\.`));
      expect(LEVEL_INSTRUCTIONS[l]).toMatch(/explain/);
    }
    expect(LEVEL_INSTRUCTIONS.A2).toMatch(/10 words or fewer/);
    expect(LEVEL_INSTRUCTIONS.B1).toMatch(/15 words or fewer/);
    expect(LEVEL_INSTRUCTIONS.B2).toMatch(/20 words or fewer/);
  });
  it("gives the hints and recap prompts a level hint", () => {
    expect(levelHint("auto", "hints")).toBe("");
    expect(levelHint("A2", "hints")).toBe("The learner is at CEFR A2 level: write the three replies at that level.");
    expect(levelHint("C1", "recap")).toBe("The learner is at CEFR C1 level: choose new expressions at or slightly above that level.");
  });
});
