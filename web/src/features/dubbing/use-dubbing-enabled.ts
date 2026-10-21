import { useDubbingConfig } from "./config";

/** 配音入口是否显示:配置拿到前与关闭时都为 false(计划 L5 R8/R16)。 */
export function useDubbingEnabled(): boolean {
  return useDubbingConfig()?.enabled === true;
}
