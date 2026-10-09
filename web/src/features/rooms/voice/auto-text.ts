import { useSettings } from "~/settings/settings-context";

/**
 * 「联机语音自动转文字」偏好(spec 2026-10-10 §4.7,R2-9):存在本设备的 enjoy-web.settings.roomVoiceAutoText,默认关。
 * 「我的 → 语音」里切换(车道 WV,任务 WV4)。
 */
export function useRoomVoiceAutoText(): boolean {
  return useSettings().roomVoiceAutoText;
}
