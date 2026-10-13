import { beforeEach, describe, expect, it } from "vitest";
import { COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, SETTINGS_KEY, isColorScheme, readStoredColorScheme } from "./color-scheme-pref";

describe("stored colour scheme (D12, R-L25)", () => {
  beforeEach(() => localStorage.clear());

  it("offers system, light and dark and defaults to system", () => {
    expect([...COLOR_SCHEMES]).toEqual(["system", "light", "dark"]);
    expect(DEFAULT_COLOR_SCHEME).toBe("system");
    expect(isColorScheme("dark")).toBe(true);
    expect(isColorScheme("sepia")).toBe(false);
    expect(isColorScheme(undefined)).toBe(false);
  });

  it("reads a valid stored value and ignores everything else", () => {
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh-CN", colorScheme: "dark" }));
    expect(readStoredColorScheme()).toBe("dark");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ colorScheme: "sepia" }));
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "en" }));
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, "not json");
    expect(readStoredColorScheme()).toBe("system");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(["dark"]));
    expect(readStoredColorScheme()).toBe("system");
  });
});
