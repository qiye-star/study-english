import { readJson } from "~/lib/storage";

/** 本机偏好的存储键(与 settings-context 共用同一个对象:语言、联机语音自动转文字、外观)。 */
export const SETTINGS_KEY = "enjoy-web.settings";

/** 「我的 → 外观」(spec D12):跟随系统(默认)/ 浅色 / 深色。只存在本机,不上传。 */
export const COLOR_SCHEMES = ["system", "light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];
export const DEFAULT_COLOR_SCHEME: ColorScheme = "system";

export const isColorScheme = (value: unknown): value is ColorScheme => (COLOR_SCHEMES as readonly unknown[]).includes(value);

const isObject = (value: unknown): value is { colorScheme?: unknown } => typeof value === "object" && value !== null && !Array.isArray(value);

/** 读存储里的外观;缺失、损坏、非法值一律回落「跟随系统」。不依赖 React 与 i18n,main.tsx 渲染前就能用。 */
export function readStoredColorScheme(): ColorScheme {
  const value = readJson(SETTINGS_KEY, isObject)?.colorScheme;
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}
