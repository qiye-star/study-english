import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";
import { readPrefs, writePrefs } from "./spell/prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("phrases preference (device-local)", () => {
  it("is null (= auto) until the user has toggled once", () => {
    expect(readPhrasesPref()).toBeNull();
  });

  it("remembers a manual close and a manual open", () => {
    writePhrasesPref(false);
    expect(readPhrasesPref()).toBe(false);
    writePhrasesPref(true);
    expect(readPhrasesPref()).toBe(true);
  });

  it("shares the wordbook prefs key without clobbering the spelling prefs", () => {
    writePrefs({ showLength: true });
    writePhrasesPref(false);
    expect(readPrefs().showLength).toBe(true);
    expect(JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY)!)).toEqual({ showLength: true, phrasesOpen: false });
    writePrefs({ showLength: false });
    expect(readPhrasesPref()).toBe(false);
  });

  it("treats garbage as auto", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, "{not json");
    expect(readPhrasesPref()).toBeNull();
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ phrasesOpen: "no" }));
    expect(readPhrasesPref()).toBeNull();
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify([1]));
    expect(readPhrasesPref()).toBeNull();
  });

  it("never throws when storage is unavailable (private mode): reads auto, writes are dropped", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readPhrasesPref()).toBeNull();
    expect(() => writePhrasesPref(false)).not.toThrow();
  });

  it("stores nothing but one boolean (no words)", () => {
    writePhrasesPref(false);
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBe('{"phrasesOpen":false}');
  });
});
