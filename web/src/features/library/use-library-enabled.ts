import { useLibraryConfig } from "./config";

/**
 * 底部标签「跟读库」是否出现(spec E9):只读 `GET /api/library/config`(按 ApiClient 缓存一次成功结果,同 `useRoomsEnabled`);
 * 拿到配置前、关闭、旧服务端(404)、失败(下次挂载再试)都是 false。主包模块,不得导入懒模块(library-lazy.test.ts)。
 */
export function useLibraryEnabled(): boolean {
  return useLibraryConfig()?.enabled === true;
}
