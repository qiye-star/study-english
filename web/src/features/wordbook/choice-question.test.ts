import { describe, expect, it } from "vitest";
import { correctOptionOf } from "./choice-question";
import type { Question } from "./wordbook-api";

const meaning: Question = { key: "talk", qtype: "meaning", prompt: { word: "talk" }, options: ["n. 事故", "v. 说话；谈话；n. 交谈", "v. 放弃"], length: null };

describe("correctOptionOf (Ruling Z-e: the server names the correct option)", () => {
  it("uses the server's correct_option verbatim", () => {
    expect(correctOptionOf(meaning, { correctOption: "v. 说话；谈话；n. 交谈" })).toBe("v. 说话；谈话；n. 交谈");
  });

  it("does not guess from the headword or rebuild the meaning line", () => {
    expect(correctOptionOf(meaning, { correctOption: null })).toBeNull();
    expect(correctOptionOf(meaning, { correctOption: "something else" })).toBeNull();
  });
});
