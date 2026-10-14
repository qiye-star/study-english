import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeviceData } from "~/auth/device-data";
import { CHANGELOG_PREFS_KEY } from "~/lib/storage";
import { readHintSeen, writeHintSeen } from "./hint-pref";

describe("changelog hint preference (R-15)", () => {
  beforeEach(() => localStorage.clear());

  it("is false until written, then true, and keeps other fields", () => {
    expect(readHintSeen()).toBe(false);
    localStorage.setItem(CHANGELOG_PREFS_KEY, JSON.stringify({ other: 1 }));
    writeHintSeen();
    expect(readHintSeen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(CHANGELOG_PREFS_KEY)!)).toEqual({ other: 1, hintSeen: true });
  });

  it("is forgotten at logout", () => {
    writeHintSeen();
    clearDeviceData();
    expect(localStorage.getItem(CHANGELOG_PREFS_KEY)).toBeNull();
    expect(readHintSeen()).toBe(false);
  });

  it("survives unavailable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readHintSeen()).toBe(false);
    expect(() => writeHintSeen()).not.toThrow();
    vi.restoreAllMocks();
  });
});
