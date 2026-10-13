import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readDoubleTapHintSeen, writeDoubleTapHintSeen } from "./double-tap-pref";
import { writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("double-tap hint preference (device-local)", () => {
  it("is unseen until it has been shown once", () => {
    expect(readDoubleTapHintSeen()).toBe(false);
    writeDoubleTapHintSeen();
    expect(readDoubleTapHintSeen()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the other fields", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    writeDoubleTapHintSeen();
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false, doubleTapHintSeen: true });
    writePrefs({ showLength: false });
    expect(readDoubleTapHintSeen()).toBe(true);
    expect(readPrefs().showLength).toBe(false);
  });

  it("treats garbage as unseen and never throws when storage is unavailable", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{nope");
    expect(readDoubleTapHintSeen()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeDoubleTapHintSeen()).not.toThrow();
    expect(readDoubleTapHintSeen()).toBe(false);
  });
});
