import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kvGet, kvSet, resetKvCacheForTests } from "./kv-cache";

describe("kv cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetKvCacheForTests();
  });
  it("stores and reads values", async () => {
    await kvSet("k1", { a: 1 });
    expect(await kvGet("k1")).toEqual({ a: 1 });
    expect(await kvGet("missing")).toBeUndefined();
  });
  it("persists in IndexedDB beyond the in-memory layer", async () => {
    await kvSet("k3", "v");
    resetKvCacheForTests(); // drops memory + connection, keeps the database
    expect(await kvGet("k3")).toBe("v");
  });
  it("falls back to memory without IndexedDB and never throws", async () => {
    resetKvCacheForTests();
    vi.stubGlobal("indexedDB", undefined);
    await expect(kvSet("k2", 1)).resolves.toBeUndefined();
    expect(await kvGet("k2")).toBe(1);
    expect(await kvGet("nope")).toBeUndefined();
  });
  it("falls back to memory when opening throws", async () => {
    resetKvCacheForTests();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("SecurityError");
      },
    });
    await expect(kvSet("k4", 4)).resolves.toBeUndefined();
    expect(await kvGet("k4")).toBe(4);
  });
  it("expires entries after the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01"));
    await kvSet("old", "x");
    vi.setSystemTime(new Date("2026-03-01"));
    expect(await kvGet("old")).toBeUndefined();
    resetKvCacheForTests();
    expect(await kvGet("old")).toBeUndefined();
  });
  it("bounds the number of stored entries, evicting the oldest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 560; i++) {
      vi.setSystemTime(1_000_000 + i);
      await kvSet(`b${i}`, i);
    }
    resetKvCacheForTests();
    expect(await kvGet("b0")).toBeUndefined();
    expect(await kvGet("b559")).toBe(559);
  });
});
