import { afterEach, describe, expect, it, vi } from "vitest";
import { readJson, removeKey, writeJson } from "./storage";

const isNum = (v: unknown): v is { n: number } => typeof (v as { n?: unknown })?.n === "number";

describe("storage", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it("round-trips JSON", () => {
    expect(writeJson("k", { n: 1 })).toBe(true);
    expect(readJson("k", isNum)).toEqual({ n: 1 });
    removeKey("k");
    expect(readJson("k", isNum)).toBeNull();
  });
  it("returns null for corrupt or wrongly shaped values", () => {
    localStorage.setItem("k", "{not json");
    expect(readJson("k", isNum)).toBeNull();
    localStorage.setItem("k", JSON.stringify({ n: "x" }));
    expect(readJson("k", isNum)).toBeNull();
  });
  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(writeJson("k", { n: 1 })).toBe(false);
    expect(readJson("k", isNum)).toBeNull();
    expect(() => removeKey("k")).not.toThrow();
  });
});
