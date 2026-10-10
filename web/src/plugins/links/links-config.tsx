import { useEffect } from "react";
import { useAuth } from "~/auth/auth-context";
import { ALL_OFF, flagsFromConfig, setLinkFlags } from "~/lib/extension-points";
import { fetchLinksConfig } from "./links-api";

/** appEffects 贡献:登录后拉取一次每用户旗标;失败保持全关(= 今天);卸载(退出登录)时复位。 */
export function LinksConfigLoader(): null {
  const { api } = useAuth();
  useEffect(() => {
    const controller = new AbortController();
    fetchLinksConfig(api, controller.signal).then(
      (config) => { if (!controller.signal.aborted) setLinkFlags(flagsFromConfig(config)); },
      () => {},
    );
    return () => { controller.abort(); setLinkFlags(ALL_OFF); };
  }, [api]);
  return null;
}
