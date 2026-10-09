import { useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { fetchRoomsConfig } from "./rooms-api";

const cache = new WeakMap<ApiClient, Promise<boolean>>();

/** 「联机」是否开启;拿到配置前为 false(导航先显示 3 项)。每个 ApiClient 只请求一次成功的结果;失败这次视为关闭,下次挂载再试。 */
export function useRoomsEnabled(): boolean {
  const { api } = useAuth();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    let pending = cache.get(api);
    if (!pending) {
      pending = fetchRoomsConfig(api).then((c) => c.enabled, () => {
        cache.delete(api); // 一次临时失败不该把「联机」藏到整页刷新
        return false;
      });
      cache.set(api, pending);
    }
    void pending.then((value) => { if (alive) setEnabled(value); });
    return () => { alive = false; };
  }, [api]);
  return enabled;
}
