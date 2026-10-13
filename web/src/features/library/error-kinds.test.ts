import { describe, expect, it } from "vitest";
import { ERROR_KINDS, errorKindKey, failedActions, isErrorKind } from "./error-kinds";

describe("error kinds (spec §6.6, R-L12)", () => {
  it("lists the 24 spec kinds", () => {
    expect(ERROR_KINDS).toHaveLength(24);
    expect(new Set(ERROR_KINDS).size).toBe(24);
    expect(isErrorKind("drm")).toBe(true);
    expect(isErrorKind("nope")).toBe(false);
  });

  it("maps unknown or missing kinds to the generic key", () => {
    expect(errorKindKey("blocked")).toBe("web.library.errors.kind.blocked");
    expect(errorKindKey("something_new")).toBe("web.library.errors.kind.unknown");
    expect(errorKindKey(null)).toBe("web.library.errors.kind.unknown");
  });

  it("offers retry only where it can help and subtitles only where they are missing", () => {
    expect(failedActions("upstream")).toEqual({ retry: true, subtitles: false });
    expect(failedActions("blocked")).toEqual({ retry: true, subtitles: false });
    expect(failedActions(null)).toEqual({ retry: true, subtitles: false });
    expect(failedActions("no_subtitles")).toEqual({ retry: false, subtitles: true });
    expect(failedActions("bad_subtitle")).toEqual({ retry: false, subtitles: true });
    for (const kind of ["too_large", "too_long", "drm", "private", "upload_expired", "unsupported_site"]) {
      expect(failedActions(kind).retry, kind).toBe(false);
    }
  });
});
