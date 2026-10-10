import { useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchRankConfig } from "~/features/rank";

/** 段位是否开启(小结里的「+N 段位点(估算)」只在开启时显示;spec §8)。失败视为关闭。 */
export function useRankEnabled(): boolean {
  const { api } = useAuth();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchRankConfig(api, controller.signal).then(
      (c) => { if (!controller.signal.aborted) setEnabled(c.enabled); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api]);
  return enabled;
}
