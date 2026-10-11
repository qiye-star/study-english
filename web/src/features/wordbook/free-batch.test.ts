import { describe, expect, it } from "vitest";
import camelcaseKeys from "camelcase-keys";
import { FREE_SET, FREE_SET_BROWSE } from "./learned-test-fixtures";
import { readFreeState, toBatch, uniqueKeys } from "./free-batch";
import type { FreeSet } from "./wordbook-api";

const set = (raw: unknown) => camelcaseKeys(raw as Record<string, unknown>, { deep: true }) as unknown as FreeSet;

describe("free batches", () => {
  it("turns a free set into the review page batch", () => {
    const batch = toBatch(set(FREE_SET));
    expect(batch.bookId).toBe("cet4");
    expect(batch.questions.map((q) => q.key)).toEqual(["accept", "talk"]);
    expect(Object.keys(batch.cards)).toEqual(["accept", "talk"]);
    expect(batch.bookOf).toEqual({ accept: "cet4", talk: "cet4" });
  });

  it("has no questions for browse sets", () => {
    expect(toBatch(set(FREE_SET_BROWSE)).questions).toEqual([]);
  });

  it("reads a set from router state and rejects anything else", () => {
    expect(readFreeState({ free: set(FREE_SET) })?.setId).toBe("abcdef012345");
    for (const bad of [null, undefined, {}, { free: { items: [] } }, { free: "x" }]) expect(readFreeState(bad)).toBeNull();
  });

  it("keeps question keys unique and in order", () => {
    expect(uniqueKeys([{ key: "a" }, { key: "b" }, { key: "a" }] as never)).toEqual(["a", "b"]);
  });
});
