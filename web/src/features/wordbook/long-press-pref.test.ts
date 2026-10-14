import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readLongPressHintSeen, writeLongPressHintSeen } from "./long-press-pref";
import { writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("long-press hint preference (device-local, R-L6)", () => {
  it("is unseen until it has been shown once, even for someone who saw the old double-tap hint", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ doubleTapHintSeen: true }));
    expect(readLongPressHintSeen()).toBe(false);
    writeLongPressHintSeen();
    expect(readLongPressHintSeen()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the other fields", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    writeLongPressHintSeen();
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false, longPressHintSeen: true });
    writePrefs({ showLength: false });
    expect(readLongPressHintSeen()).toBe(true);
    expect(readPrefs().showLength).toBe(false);
  });

  it("treats garbage as unseen and never throws when storage is unavailable", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{nope");
    expect(readLongPressHintSeen()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => writeLongPressHintSeen()).not.toThrow();
    expect(readLongPressHintSeen()).toBe(false);
  });
});
