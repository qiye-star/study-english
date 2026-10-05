import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { GRAMMAR_REV_KEY } from "~/features/grammar/grammar-api";
import { sharedTtsCache } from "~/features/chat/tts";
import { PRACTICE_DRAFT_KEY, clearDeviceData } from "./device-data";
import { kvGet, kvIdleForTests, kvSet } from "./kv-cache";

describe("clearDeviceData", () => {
  it("empties the practice draft, lookup cache and TTS blobs, and never throws", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify("draft"));
    await kvSet("lookup", { a: 1 });
    localStorage.setItem(GRAMMAR_REV_KEY, "3");
    sharedTtsCache.set("k", new Blob(["a"]));
    clearDeviceData();
    await vi.waitFor(async () => expect(await kvGet("lookup")).toBeUndefined());
    await kvIdleForTests();
    expect(localStorage.getItem(PRACTICE_DRAFT_KEY)).toBeNull();
    expect(localStorage.getItem(GRAMMAR_REV_KEY)).toBeNull();
    expect(sharedTtsCache.get("k")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearDeviceData()).not.toThrow();
    vi.restoreAllMocks();
  });

  it("clears cached grammar results with the rest of the kv cache", async () => {
    await kvSet("grammar:v1:0:\"She don't.\"", { hasErrors: false, corrected: "x", errors: [] });
    clearDeviceData();
    await vi.waitFor(async () => expect(await kvGet("grammar:v1:0:\"She don't.\"")).toBeUndefined());
  });
});
