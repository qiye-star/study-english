import { ApiError } from "~/api/client";
import { RecorderError } from "~/audio/recorder";
import { StartPayloadError } from "./protocol";
import { REALTIME_SERVER_ERRORS } from "./realtime-api";

/** 票据接口的 HTTP 状态 → 已有的具体文案(401 登录失效、404 会话不存在、429 限流)。 */
const STATUS_KEYS: Record<number, string> = {
  401: "web.realtime.errors.unauthorized",
  404: "web.realtime.errors.not_found",
  429: "web.realtime.errors.rate_limited",
};

/** 票据等 HTTP 错误、麦克风错误 → i18n 键;未知错误用通用的断开文案。 */
export function realtimeErrorKey(err: unknown): string {
  if (err instanceof RecorderError) return `web.recorder.${err.code}`;
  if (err instanceof StartPayloadError) return "web.realtime.errors.invalidVoice";
  if (err instanceof ApiError) return REALTIME_SERVER_ERRORS[err.message] ?? STATUS_KEYS[err.status] ?? "web.realtime.errors.generic";
  return "web.realtime.errors.generic";
}
