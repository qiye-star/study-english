import type { ComponentProps } from "react";
// 路由级测试共用:把 app.tsx 里的三条 /chat 路由 + 一个跳转探针放进同一棵树,并给出对话页要用的全部桩接口。
import { Route, Routes, useNavigate } from "react-router-dom";
import { json, type Handler } from "~/test/fetch-mock";
import { ChatConversationRoute, ChatIndexRoute, ChatNewRoute } from "./routes";
import contract from "./chat-home-contract.stub.json";

export const TODAY = contract.today_ready_bilingual;
const CONFIG = TODAY.conversation.config;

/** 默认「今天已看过」:路由测试不被弹窗打断;要测弹窗的用例传 `FIRST_VIEW` */
export const SEEN_TODAY = { ...TODAY, greeting: { ...TODAY.greeting, first_view: false } };
export const FIRST_VIEW = TODAY;

export const stripStars = (s: string) => s.replace(/\*/g, "");
/** 问候的三条助手消息(内容 = 去掉强调标记的英文主句,和服务端写入的一致) */
export const GREETING_MESSAGES = TODAY.greeting.message_ids.map((id, i) => ({
  id, conversation_id: "c-today", role: "assistant", content: `${stripStars(TODAY.greeting.lines[i].en)}\n\n${stripStars(TODAY.greeting.lines[i].zh)}`,
  created_at: "2026-10-23T00:42:10Z",
}));

export let goTo: (path: string) => void = () => undefined;
function NavProbe(): null {
  goTo = useNavigate();
  return null;
}

export function ChatRoutesHarness({ embedded }: { embedded?: ComponentProps<typeof ChatIndexRoute>["embedded"] }) {
  return (
    <>
      <Routes>
        <Route path="/chat" element={<ChatIndexRoute embedded={embedded} />} />
        <Route path="/chat/new" element={<ChatNewRoute />} />
        <Route path="/chat/:id" element={<ChatConversationRoute />} />
        <Route path="/practice" element={<p data-testid="practice-page">practice</p>} />
      </Routes>
      <NavProbe />
    </>
  );
}

/** 开关开、角色关闭(404 = 关闭)、问候已生成;`extra` 覆盖任意接口。 */
export function chatHomeRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/chat-home/config": () => json({ enabled: true, llm: false }),
    "GET /api/chat-home/settings": () => json(contract.settings),
    "PATCH /api/chat-home/settings": (c) => json({ ...contract.settings, ...JSON.parse(String(c.body)) }),
    "POST /api/chat-home/today": () => json(SEEN_TODAY),
    "POST /api/chat-home/greetings/g1/seen": () => json({ first_seen_at: "2026-10-23T00:43:00Z" }),
    "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
    "GET /api/conversations/c-today": () => json({ ...TODAY.conversation }),
    "GET /api/conversations/c-today/messages": () => json({ messages: GREETING_MESSAGES }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip planning", config: { ...CONFIG, agent_persona_id: undefined }, created_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-20T00:00:00Z" }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "u0", conversation_id: "c1", role: "assistant", content: "Where to?" }] }),
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy", "echo"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    ...extra,
  };
}
