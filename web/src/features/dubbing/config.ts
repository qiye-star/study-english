import { useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { DUBBING_DISABLED, fetchDubbingConfig, type DubbingConfig } from "./dubbing-api";

/**
 * 配音的开关与限额(计划 L5 R8)。在主包里(入口卡要用),所以只放请求与缓存,不导入页面或文案。
 * 失败按关闭处理(不把错误抛给界面);失败的结果不缓存,下次挂载再试。
 */
const cache = new WeakMap<ApiClient, Promise<DubbingConfig>>();

export function loadDubbingConfig(api: ApiClient): Promise<DubbingConfig> {
  let pending = cache.get(api);
  if (!pending) {
    pending = fetchDubbingConfig(api).catch((): DubbingConfig => {
      cache.delete(api);
      return DUBBING_DISABLED;
    });
    cache.set(api, pending);
  }
  return pending;
}

/** 拿到前为 null;之后是服务端的配置(失败为关闭)。 */
export function useDubbingConfig(): DubbingConfig | null {
  const { api } = useAuth();
  const [config, setConfig] = useState<DubbingConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void loadDubbingConfig(api).then((value) => { if (alive) setConfig(value); });
    return () => { alive = false; };
  }, [api]);
  return config;
}
