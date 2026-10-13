import { useEffect, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";

/**
 * 跟读库的开关与限额(spec 2026-10-13-video-import §9 `GET /api/library/config`)。本模块在主包里(入口卡要用),
 * 所以只放开关请求与类型,不导入 library-api 与懒加载文案(计划 R-L3、R-L23)。
 */
export interface LibraryLimits {
  maxUploadMb: number;
  maxDurationMinutes: number;
  quotaMb: number;
  usedBytes: number;
  maxItems: number;
  chunkBytes: number;
  formats: string[];
}

export interface LibraryConfig {
  enabled: boolean;
  linkImport: boolean;
  asr: boolean;
  /** D8:是否允许生成译文与句子分析(spec §5.2 `library_ai_enabled`);关 = 网页不显示「译」与「分析」 */
  ai: boolean;
  limits: LibraryLimits | null;
}

export const LIBRARY_DISABLED: LibraryConfig = Object.freeze({ enabled: false, linkImport: false, asr: false, ai: false, limits: null });

/** 404 = 没装跟读库的旧服务端,按关闭处理;其他错误照抛,由调用方决定重试(R-L6)。 */
export async function fetchLibraryConfig(api: ApiClient): Promise<LibraryConfig> {
  try {
    const c = await api.request<Partial<LibraryConfig>>("GET", "/api/library/config");
    return { enabled: c.enabled === true, linkImport: c.linkImport === true, asr: c.asr === true, ai: c.ai === true, limits: c.limits ?? null };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return LIBRARY_DISABLED;
    throw err;
  }
}

const cache = new WeakMap<ApiClient, Promise<LibraryConfig | null>>();

/** 入口卡与播放页用的开关:每个 ApiClient 只缓存一次成功结果;失败为 null,下次挂载重试(同 useWordbookConfig)。拿到前为 null。 */
export function useLibraryConfig(): LibraryConfig | null {
  const { api } = useAuth();
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = cache.get(api);
    if (!pending) {
      pending = fetchLibraryConfig(api).catch((): null => {
        cache.delete(api);
        return null;
      });
      cache.set(api, pending);
    }
    void pending.then((value) => { if (alive) setConfig(value); });
    return () => { alive = false; };
  }, [api]);
  return config;
}
