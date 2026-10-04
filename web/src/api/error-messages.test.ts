import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ApiError } from "./client";
import { translateServerError } from "./error-messages";

describe("translateServerError", () => {
  const t = i18n.t.bind(i18n);
  it("maps known messages and falls back to a generic one for unknown ApiErrors", () => {
    expect(translateServerError(t, new ApiError(0, "Request aborted"))).toBe("The request was cancelled.");
    expect(translateServerError(t, new ApiError(0, "AI response timed out"))).toBe("The request timed out.");
    expect(translateServerError(t, new ApiError(500, "some raw english"))).toBe("Something went wrong.");
    expect(translateServerError(t, new Error("x"))).toBe("Something went wrong.");
  });
});
