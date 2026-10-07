import { ApiError } from "~/api/client";
import { RecorderError } from "~/audio/recorder";
import { REALTIME_SERVER_ERRORS } from "./realtime-api";

/** 票据等 HTTP 错误、麦克风错误 → i18n 键;未知错误用通用的断开文案。 */
export function realtimeErrorKey(err: unknown): string {
  if (err instanceof RecorderError) return `web.recorder.${err.code}`;
  if (err instanceof ApiError) return REALTIME_SERVER_ERRORS[err.message] ?? "web.realtime.errors.generic";
  return "web.realtime.errors.generic";
}
