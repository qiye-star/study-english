import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_MODE_KEY, clearComposerMode, readComposerMode, writeComposerMode } from "./composer-mode";

describe("composer mode preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(COMPOSER_MODE_KEY);
  });

  it("defaults to text, remembers voice, and ignores unknown values", () => {
    expect(readComposerMode()).toBe("text");
    writeComposerMode("voice");
    expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBe("voice");
    expect(readComposerMode()).toBe("voice");
    writeComposerMode("text");
    expect(readComposerMode()).toBe("text");
    localStorage.setItem(COMPOSER_MODE_KEY, "\"voice\"");
    expect(readComposerMode()).toBe("text");
    clearComposerMode();
    expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readComposerMode()).toBe("text");
    expect(() => writeComposerMode("voice")).not.toThrow();
    expect(() => clearComposerMode()).not.toThrow();
  });
});
