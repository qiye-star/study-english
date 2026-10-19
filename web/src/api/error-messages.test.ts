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
    expect(translateServerError(t, new ApiError(503, "Maintenance"))).toBe("The service is under maintenance. Please try again later.");
    expect(i18n.t("web.errors.maintenance", { lng: "zh-CN" })).toBe("服务维护中,请稍后再试。");
  });
  it("explains a disabled account in both languages", () => {
    expect(translateServerError(t, new ApiError(403, "Account disabled"))).toBe("This account has been disabled.");
    expect(i18n.t("web.errors.accountDisabled", { lng: "zh-CN" })).toBe("该账号已被停用。");
  });
  it("keeps an unknown account-style message generic (account messages live in the account feature)", () => {
    expect(translateServerError(t, new ApiError(422, "Email must not contain user@example.com"))).toBe("Something went wrong.");
  });
});
