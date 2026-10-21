// 懒加载入口(计划 L5 R17):只有打开配音页面时才拉 library 工具包与配音文案,主包不含它们。
import { loadDubbingKit, type DubbingKit } from "~/features/library";
import { ensureDubbingI18n } from "./locales";

export async function loadDubbingRuntime(): Promise<DubbingKit> {
  ensureDubbingI18n();
  return loadDubbingKit();
}
