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
};

export function translateServerError(t: TFunction, err: unknown, extra: Record<string, string> = {}): string {
  if (err instanceof ApiError) {
    const key = extra[err.message] ?? COMMON[err.message];
    return key ? t(key) : err.message;
  }
  return t("web.errors.unknown");
}
