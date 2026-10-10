import { afterEach, describe, expect, it } from "vitest";
import { clearDeviceData } from "~/auth/device-data";
import { WORDBOOK_PREFS_KEY as STORAGE_KEY } from "~/lib/storage";
import { WORDBOOK_PREFS_KEY, clearSpellPrefs, readPrefs, writePrefs } from "./prefs";

afterEach(() => localStorage.removeItem(STORAGE_KEY));

describe("spell prefs", () => {
  it("use web-core's storage key (one key, no duplicate)", () => {
    expect(WORDBOOK_PREFS_KEY).toBe(STORAGE_KEY);
  });

  it("are cleared at logout by clearDeviceData", () => {
    writePrefs({ showLength: true });
    expect(readPrefs().showLength).toBe(true);
    clearDeviceData();
    expect(readPrefs().showLength).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearSpellPrefs removes them", () => {
    writePrefs({ showLength: true });
    clearSpellPrefs();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
