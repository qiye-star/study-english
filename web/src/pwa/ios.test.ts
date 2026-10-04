import { describe, expect, it } from "vitest";
import { shouldShowIosInstallHint } from "./ios";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("shouldShowIosInstallHint", () => {
  it("shows only in iOS Safari outside standalone mode", () => {
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, false, false)).toBe(true);
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, true, false)).toBe(false);
    expect(shouldShowIosInstallHint(IPHONE_SAFARI, undefined, true)).toBe(false);
    expect(shouldShowIosInstallHint(IPHONE_CHROME, false, false)).toBe(false);
    expect(shouldShowIosInstallHint(ANDROID, undefined, false)).toBe(false);
  });
});
