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
  it("translates the email and binding messages in both languages without echoing input", () => {
    const cases: Array<[string, string, string, string]> = [
      ["Invalid or expired code", "web.errors.invalidCode", "The code is invalid or has expired.", "验证码无效或已过期。"],
      ["Too many codes, please wait", "web.errors.tooManyCodes", "Too many codes. Please wait before trying again.", "验证码发送过于频繁,请稍后再试。"],
      ["Email temporarily unavailable", "web.errors.emailUnavailable", "Email is temporarily unavailable. Try again later.", "邮件服务暂时不可用,请稍后再试。"],
      ["Email domain not allowed", "web.errors.emailDomainNotAllowed", "This email domain can't be used.", "该邮箱域名不支持。"],
      ["Email is not configured", "web.errors.emailNotConfigured", "Email is not set up on this server.", "服务器未配置邮件服务。"],
      ["Wrong password", "web.errors.wrongPassword", "Current password is incorrect", "当前密码不正确"],
      ["Email already bound", "web.errors.emailAlreadyBound", "This account already has an email.", "该账号已绑定邮箱。"],
      ["Email verification required: please register in the web app", "web.errors.emailVerificationRequired",
        "Email verification is required. Please register in the web app.", "需要邮箱验证,请在网页端注册。"],
    ];
    for (const [message, key, en, zh] of cases) {
      expect(translateServerError(t, new ApiError(400, message)), message).toBe(en);
      expect(i18n.t(key, { lng: "zh-CN" }), key).toBe(zh);
    }
    expect(translateServerError(t, new ApiError(422, "Email must not contain user@example.com"))).toBe("Something went wrong.");
  });
});
