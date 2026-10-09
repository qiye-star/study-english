import type { TFunction } from "i18next";
import { ApiError } from "./client";

const COMMON: Record<string, string> = {
  "Invalid username or password": "web.errors.invalidLogin",
  "Username already taken": "web.errors.usernameTaken",
  "Registration is closed": "web.errors.registrationClosed",
  "Invalid invite code": "web.errors.invalidInvite",
  "Too many requests, please try again later": "web.errors.tooManyRequests",
  "Network error": "web.errors.network",
  "Request timed out": "web.errors.timeout",
  "AI response timed out": "web.errors.timeout",
  "Request aborted": "web.errors.aborted",
  Maintenance: "web.errors.maintenance", // 503 from the server's maintenance mode (admin console)
};

export function translateServerError(t: TFunction, err: unknown, extra: Record<string, string> = {}): string {
  if (err instanceof ApiError) {
    const key = extra[err.message] ?? COMMON[err.message];
    return t(key ?? "web.errors.unknown"); // 未知服务器文案一律走通用提示,避免显示英文原文
  }
  return t("web.errors.unknown");
}
