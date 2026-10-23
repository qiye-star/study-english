// 核心贡献:对话主页的「打开」检测(appEffects/chat.home-open)。只被 plugins/core 导入;
// 开关读取很小,检测与请求逻辑动态加载(主包预算,FR10)。
import { useEffect } from "react";
import { useAuth } from "~/auth/auth-context";
import { contribute } from "~/lib/extension-points";
import { loadChatHomeEnabled } from "./home/use-chat-home-config";

function ChatHomeOpenEffect(): null {
  const { api } = useAuth();
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | undefined;
    void loadChatHomeEnabled(api).then(async (on): Promise<void> => {
      if (!alive || !on) return;
      const { startOpenDetection } = await import("./home/chat-home-open");
      if (alive) stop = startOpenDetection(api);
    }).catch((): void => undefined);
    return () => { alive = false; stop?.(); };
  }, [api]);
  return null;
}

contribute({ point: "appEffects", id: "chat.home-open", component: ChatHomeOpenEffect });
