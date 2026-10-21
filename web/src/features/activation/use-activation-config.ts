import { useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { fetchActivationConfig, type ActivationConfig } from "./activation-api";

const cache = new WeakMap<ApiClient, Promise<ActivationConfig | null>>();

/** 词汇激活配置;拿到前为 null。每个 ApiClient 只缓存一次成功结果;失败视为关闭,下次挂载重试(同背单词配置)。 */
export function useActivationConfig(): ActivationConfig | null {
  const { api } = useAuth();
  const [config, setConfig] = useState<ActivationConfig | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = cache.get(api);
    if (!pending) {
      pending = fetchActivationConfig(api).catch((): null => {
        cache.delete(api); // 一次临时失败不该把入口藏到整页刷新
        return null;
      });
      cache.set(api, pending);
    }
    void pending.then((value) => { if (alive) setConfig(value); });
    return () => { alive = false; };
  }, [api]);
  return config;
}

/** 入口是否显示:配置明确说 enabled 才为 true(拿到前、失败、关闭都为 false)。 */
export function useActivationEnabled(): boolean {
  return useActivationConfig()?.enabled === true;
}
