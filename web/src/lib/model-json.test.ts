import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./model-json";

describe("extractJsonObject", () => {
  it("accepts plain JSON, code fences and surrounding prose; rejects non-objects", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Sure! {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
    for (const bad of ["", "nope", "[1,2]", "42", "null", '{"a":'] as const) expect(extractJsonObject(bad)).toBeUndefined();
  });
});
