import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kvClear, kvGet, kvIdleForTests, kvSet, resetKvCacheForTests } from "./kv-cache";

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
  it("kvClear empties memory and IndexedDB, and works without IndexedDB", async () => {
    await kvSet("c1", 1);
    await kvClear();
    expect(await kvGet("c1")).toBeUndefined();
    resetKvCacheForTests(); // memory dropped: only IndexedDB could still answer
    expect(await kvGet("c1")).toBeUndefined();
    vi.stubGlobal("indexedDB", undefined);
    resetKvCacheForTests();
    await kvSet("c2", 2);
    await expect(kvClear()).resolves.toBeUndefined();
    expect(await kvGet("c2")).toBeUndefined();
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
    await kvIdleForTests();
    resetKvCacheForTests();
    expect(await kvGet("b0")).toBeUndefined();
    expect(await kvGet("b559")).toBe(559);
  });

  it("prunes on the first write of a fresh page load, enforcing count and TTL", async () => {
    const now = Date.now();
    // Pre-fill the real database: 600 fresh rows + 50 long-expired rows, as left by earlier page loads.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("enjoy-web", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      const store = tx.objectStore("kv");
      for (let i = 0; i < 600; i++) store.put({ v: i, at: now - 600 + i }, `fresh${i}`);
      for (let i = 0; i < 50; i++) store.put({ v: i, at: now - 90 * 24 * 3600 * 1000 }, `stale${i}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    vi.resetModules();
    const fresh = await import("./kv-cache");
    await fresh.kvSet("new", 1); // a single write in a new session
    await fresh.kvIdleForTests();
    fresh.resetKvCacheForTests();

    const count = await new Promise<number>((resolve, reject) => {
      const open = indexedDB.open("enjoy-web", 1);
      open.onsuccess = () => {
        const req = open.result.transaction("kv").objectStore("kv").count();
        req.onsuccess = () => {
          open.result.close();
          resolve(req.result);
        };
        req.onerror = () => reject(req.error);
      };
      open.onerror = () => reject(open.error);
    });
    expect(count).toBe(500);
    expect(await fresh.kvGet("stale0")).toBeUndefined();
    expect(await fresh.kvGet("fresh0")).toBeUndefined(); // oldest evicted
    expect(await fresh.kvGet("new")).toBe(1);
    expect(await fresh.kvGet("fresh599")).toBe(599);
  });
});
