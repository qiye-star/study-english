import { describe, expect, it } from "vitest";
import { allFilled, clozeReducer, initCloze, interpretInput, MAX_BLANK, SENTINEL } from "./cloze-engine";

const run = (count: number, actions: Parameters<typeof clozeReducer>[1][]) => actions.reduce(clozeReducer, initCloze(count));

describe("cloze engine", () => {
  it("types into the active blank, space moves on, never past the last blank", () => {
    const s = run(2, [{ type: "set", value: "talk" }, { type: "space" }, { type: "set", value: "go" }, { type: "space" }]);
    expect(s).toEqual({ values: ["talk", "go"], active: 1, hinted: [false, false] });
    expect(allFilled(s)).toBe(true);
    expect(allFilled(run(2, [{ type: "set", value: "talk" }]))).toBe(false);
  });

  it("backspace on an empty blank goes back and keeps the previous text", () => {
    const s = run(3, [{ type: "set", value: "a" }, { type: "space" }, { type: "backspaceEmpty" }]);
    expect(s.active).toBe(0);
    expect(s.values[0]).toBe("a");
    expect(run(1, [{ type: "backspaceEmpty" }]).active).toBe(0);
  });

  it("strips spaces and keeps letters, apostrophes and hyphens only", () => {
    expect(run(1, [{ type: "set", value: " don't-x1 " }]).values[0]).toBe("don't-x");
    // iOS smart punctuation types a curly apostrophe; the zero-width sentinel never leaks into a blank
    expect(run(1, [{ type: "set", value: `can’t${SENTINEL}` }]).values[0]).toBe("can't");
    expect(run(1, [{ type: "set", value: "café" }]).values[0]).toBe("café");
  });

  it("hint writes the first letter and marks the blank", () => {
    const s = run(2, [{ type: "focus", index: 1 }, { type: "hint", index: 1, letter: "c" }]);
    expect(s.values[1]).toBe("c");
    expect(s.hinted).toEqual([false, true]);
    expect(s.active).toBe(1);
    expect(run(1, [{ type: "focus", index: 5 }]).active).toBe(0);
    expect(run(1, [{ type: "hint", index: 3, letter: "x" }])).toEqual(initCloze(1));
  });

  it("pasting more words than blanks are left does not overwrite the last blank (review m1)", () => {
    // on the last blank (0 blanks after it) "used to" keeps "used"
    const last = interpretInput(SENTINEL, SENTINEL + "used to", 0);
    expect(last).toEqual([{ type: "set", value: "used" }]);
    expect(run(2, [{ type: "focus", index: 1 }, ...last]).values).toEqual(["", "used"]);
    // one blank left after the active one: "a b c" fills two blanks and drops the rest
    const two = interpretInput(SENTINEL, SENTINEL + "a b c", 1);
    expect(run(2, two).values).toEqual(["a", "b"]);
    // a trailing space on the last blank is harmless
    expect(interpretInput(SENTINEL + "to", SENTINEL + "to ", 0)).toEqual([{ type: "set", value: "to" }]);
  });

  it("first-letter hint keeps what the user typed when it already starts with the letter (review m2)", () => {
    const kept = run(1, [{ type: "set", value: "wen" }, { type: "hint", index: 0, letter: "w" }]);
    expect(kept).toMatchObject({ values: ["wen"], hinted: [true] });
    expect(run(1, [{ type: "set", value: "Wen" }, { type: "hint", index: 0, letter: "w" }]).values).toEqual(["Wen"]);
    expect(run(1, [{ type: "set", value: "ent" }, { type: "hint", index: 0, letter: "w" }]).values).toEqual(["went"]);
  });

  it("caps a blank's length so a long paste cannot widen the page (review m3)", () => {
    expect(run(1, [{ type: "set", value: "a".repeat(200) }]).values[0]).toHaveLength(MAX_BLANK);
  });

  it("reset starts a new set and an empty set never crashes", () => {
    const s = run(2, [{ type: "set", value: "a" }, { type: "reset", count: 3 }]);
    expect(s).toEqual(initCloze(3));
    const empty = run(0, [{ type: "set", value: "a" }, { type: "space" }, { type: "backspaceEmpty" }]);
    expect(empty).toEqual({ values: [], active: 0, hinted: [] });
  });

  it("interprets hidden input diffs (Gboard keyCode 229 safe)", () => {
    expect(interpretInput(SENTINEL + "tal", SENTINEL + "talk")).toEqual([{ type: "set", value: "talk" }]);
    expect(interpretInput(SENTINEL + "talk", SENTINEL + "talk ")).toEqual([{ type: "set", value: "talk" }, { type: "space" }]);
    expect(interpretInput(SENTINEL, "")).toEqual([{ type: "backspaceEmpty" }]);
    expect(interpretInput(SENTINEL + "a", SENTINEL)).toEqual([{ type: "set", value: "" }]);
    expect(interpretInput(SENTINEL + "abc", "xyz")).toEqual([{ type: "set", value: "xyz" }]); // 全选后替换,哨兵丢了但有字
    expect(interpretInput(SENTINEL, SENTINEL + "used to")).toEqual([{ type: "set", value: "used" }, { type: "space" }, { type: "set", value: "to" }]);
  });

  it("treats any whitespace a keyboard inserts as a space and survives a misplaced caret", () => {
    // 部分安卓键盘(建议条)插入不间断空格
    expect(interpretInput(SENTINEL + "talk", SENTINEL + "talk ")).toEqual([{ type: "set", value: "talk" }, { type: "space" }]);
    // 光标落在哨兵前面时打的字:哨兵在中间,也只当作当前空的内容
    expect(interpretInput(SENTINEL, "t" + SENTINEL)).toEqual([{ type: "set", value: "t" }]);
    // 当前空非空时删掉哨兵(光标在哨兵后、文字前)不算「退格回到上一空」
    expect(interpretInput(SENTINEL + "talk", "talk")).toEqual([{ type: "set", value: "talk" }]);
  });
});
