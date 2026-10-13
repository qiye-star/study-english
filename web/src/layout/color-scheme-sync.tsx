import { useSettings } from "~/settings/settings-context";
import { useApplyColorScheme } from "./color-scheme";

/** 把「我的 → 外观」的选择应用到 html.dark(D12)。放在 SettingsProvider 里面,什么也不渲染。 */
export function ColorSchemeSync(): null {
  useApplyColorScheme(useSettings().colorScheme);
  return null;
}
