import { expect, it } from "vitest";
import { lineDiff } from "./diff";

it("diffs line by line", () => {
  expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
    { type: "same", text: "a" },
    { type: "del", text: "b" },
    { type: "add", text: "x" },
    { type: "same", text: "c" },
  ]);
  expect(lineDiff("same", "same")).toEqual([{ type: "same", text: "same" }]);
  expect(lineDiff("", "new")).toEqual([{ type: "del", text: "" }, { type: "add", text: "new" }]);
});
