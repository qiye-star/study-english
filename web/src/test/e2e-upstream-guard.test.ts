import { describe, expect, it } from "vitest";
import { isOwnBackendPath } from "../../e2e/support/upstream-guard";

// e2e 的防漏守卫(web/e2e/support/mock-upstreams.ts)放行哪些路径。页面加载时请求的自家接口必须放行,
// 否则所有用到守卫的 e2e 用例都会失败;可能触达上游的路径必须拦下。
describe("e2e upstream guard classification", () => {
  it.each([
    "/api/conversations/c1/messages", "/api/messages/m1", "/api/me/grammar-prompt", "/api/config/tts_providers_v2",
    "/api/assessments", "/api/assessments/a1", "/api/practice-items", "/api/vocabulary", "/api/stats/summary",
    // 对话页每次加载都会请求它(Task 4.11);只读设置,不碰上游
    "/api/realtime/config",
    // 段位卡与底部导航加载时请求(RANK_ENABLED / ROOMS_ENABLED 开启的 E2E 栈)
    "/api/rank/config", "/api/rank/me", "/api/rank/achievements", "/api/rooms/config",
  ])("lets the page's own backend route %s through", (path) => {
    expect(isOwnBackendPath(path)).toBe(true);
  });

  it.each([
    "/api/ai/chat/completions", "/api/ai/audio/transcriptions", "/api/ai/audio/speech", "/api/ai/grammar",
    "/api/speech/assessments",
    // 开通话的路径会触达上游:不放行(WebSocket 由守卫另行记录)
    "/api/realtime", "/api/realtime/ticket", "/api/realtime/configx",
    "/api/configuration", "/api/unknown",
    // 晋级赛(考官/转写/评分)与房间(AI)可能触达上游
    "/api/rank/matches", "/api/rank/matches/m1/turns", "/api/rank/matches/m1/finish", "/api/rooms/ws", "/api/rooms", "/api/rooms/r1/ticket",
  ])("blocks %s, which may reach an upstream", (path) => {
    expect(isOwnBackendPath(path)).toBe(false);
  });
});
