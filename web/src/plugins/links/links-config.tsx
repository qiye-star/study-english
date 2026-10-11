import { useEffect } from "react";
import { useAuth } from "~/auth/auth-context";
import { ALL_OFF, flagsFromConfig, setLinkFlags } from "~/lib/extension-points";
import { fetchLinksConfig } from "./links-api";

/** appEffects 贡献:登录后拉取一次每用户旗标;失败 = 全关(= 今天),但标记为「已加载」(不是 ALL_OFF 本身),
 * 这样直达联动页会回练习页而不是一直空白;卸载(退出登录)时复位为未加载。 */
export function LinksConfigLoader(): null {
  const { api } = useAuth();
  useEffect(() => {
    const controller = new AbortController();
    fetchLinksConfig(api, controller.signal).then(
      (config) => { if (!controller.signal.aborted) setLinkFlags(flagsFromConfig(config)); },
      () => { if (!controller.signal.aborted) setLinkFlags(flagsFromConfig({ enabled: false, links: [] })); },
    );
    return () => { controller.abort(); setLinkFlags(ALL_OFF); };
  }, [api]);
  return null;
}
