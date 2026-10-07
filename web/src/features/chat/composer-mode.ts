import { removeKey } from "~/lib/storage";

/** 输入栏模式(仿微信):文字输入框,或"按住 说话"长条。本机偏好,退出登录时清除(clearDeviceData)。 */
export type ComposerMode = "text" | "voice";
export const COMPOSER_MODE_KEY = "enjoy-web.composer.mode";

export function readComposerMode(): ComposerMode {
  try {
    return window.localStorage.getItem(COMPOSER_MODE_KEY) === "voice" ? "voice" : "text";
  } catch {
    return "text"; // 存储不可用(隐私模式等)
  }
}

export function writeComposerMode(mode: ComposerMode): void {
  try {
    window.localStorage.setItem(COMPOSER_MODE_KEY, mode);
  } catch {
    /* 存储失败时本页仍生效 */
  }
}

export function clearComposerMode(): void {
  removeKey(COMPOSER_MODE_KEY);
}
