import type { TFunction } from "i18next";
import { ApiError } from "./client";

const COMMON: Record<string, string> = {
  "Invalid username or password": "web.errors.invalidLogin",
  "Account disabled": "web.errors.accountDisabled",
  "Username already taken": "web.errors.usernameTaken",
  "Registration is closed": "web.errors.registrationClosed",
  "Invalid invite code": "web.errors.invalidInvite",
  "Too many requests, please try again later": "web.errors.tooManyRequests",
  "Network error": "web.errors.network",
  "Request timed out": "web.errors.timeout",
  "AI response timed out": "web.errors.timeout",
  "Request aborted": "web.errors.aborted",
  Maintenance: "web.errors.maintenance", // 503 from the server's maintenance mode (admin console)
  "Invalid or expired code": "web.errors.invalidCode",
  "Too many codes, please wait": "web.errors.tooManyCodes",
  "Email temporarily unavailable": "web.errors.emailUnavailable",
  "Email domain not allowed": "web.errors.emailDomainNotAllowed",
  "Email is not configured": "web.errors.emailNotConfigured",
  "Wrong password": "web.errors.wrongPassword",
  "Email already bound": "web.errors.emailAlreadyBound",
  "Email verification required: please register in the web app": "web.errors.emailVerificationRequired",
};

export function translateServerError(t: TFunction, err: unknown, extra: Record<string, string> = {}): string {
  if (err instanceof ApiError) {
    const key = extra[err.message] ?? COMMON[err.message];
    return t(key ?? "web.errors.unknown"); // 未知服务器文案一律走通用提示,避免显示英文原文
  }
  return t("web.errors.unknown");
}
