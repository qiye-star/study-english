import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";
import { readTapLookupHintSeen, writeTapLookupHintSeen } from "./tap-lookup-pref";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("tap-lookup hint preference (device-local)", () => {
  it("is unseen until it has been shown once, even for someone who saw the old hint (one tap now looks up: say it again)", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ tapLookupHintSeen: true, doubleTapHintSeen: true, longPressHintSeen: true }));
    expect(readTapLookupHintSeen()).toBe(false);
    writeTapLookupHintSeen();
    expect(readTapLookupHintSeen()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the other fields", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    writeTapLookupHintSeen();
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false, tapLookupOnceHintSeen: true });
    writePrefs({ showLength: false });
    expect(readTapLookupHintSeen()).toBe(true);
    expect(readPrefs().showLength).toBe(false);
  });

  it("treats garbage as unseen and never throws when storage is unavailable", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{nope");
    expect(readTapLookupHintSeen()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeTapLookupHintSeen()).not.toThrow();
    expect(readTapLookupHintSeen()).toBe(false);
  });
});
