import { beforeEach, describe, expect, it } from "vitest";
import { WORDBOOK_PREFS_KEY } from "~/lib/storage";
import { readPrefs, writePrefs } from "./prefs";

const stored = () => JSON.parse(localStorage.getItem(WORDBOOK_PREFS_KEY) ?? "{}");

beforeEach(() => { localStorage.clear(); });

describe("word spelling prefs (plan 2026-10-27 R-W5 / R-W7)", () => {
  it("defaults to dictation with the peek hint still to show", () => {
    expect(readPrefs()).toEqual({ wordSpellMode: "dictation", wordSpellPeekHintSeen: false });
  });

  it("writes the mode and reads it back", () => {
    writePrefs({ wordSpellMode: "meaning" });
    expect(readPrefs().wordSpellMode).toBe("meaning");
  });

  it("falls back to the default for an unknown stored value", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ wordSpellMode: "typing" }));
    expect(readPrefs().wordSpellMode).toBe("dictation");
  });

  it("keeps other fields that share the prefs key", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ showLength: true, tapLookupHintSeen: true }));
    writePrefs({ wordSpellPeekHintSeen: true });
    expect(stored()).toEqual({ showLength: true, tapLookupHintSeen: true, wordSpellPeekHintSeen: true });
  });
});
