// 核心贡献:对话主页的「打开」检测(appEffects/chat.home-open)。只被 plugins/core 导入。
// 主包预算(计划 K5):这里只留一个极小的挂载壳,开关读取、请求、检测全在动态块里(./home/open-effect)。
import { useEffect } from "react";
import { useAuth } from "~/auth/auth-context";
import { contribute } from "~/lib/extension-points";

function ChatHomeOpenEffect(): null {
  const { api } = useAuth();
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void import("./home/open-effect").then((m) => m.startChatHomeOpen(api)).then((s) => {
      if (alive) stop = s;
      else s();
    }).catch((): void => undefined);
    return () => { alive = false; stop?.(); };
  }, [api]);
  return null;
}

contribute({ point: "appEffects", id: "chat.home-open", component: ChatHomeOpenEffect });
