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
    // 公告条(管理端 v2)每页加载时请求;只读数据库
    "/api/announcements",
    // 背单词(WORDBOOK_ENABLED):练习页大卡、「我的」一行与背单词各页只读写数据库与本地词典文件
    "/api/wordbook/config", "/api/wordbook/today", "/api/wordbook/books", "/api/wordbook/enrollment",
    "/api/wordbook/learn/batch", "/api/wordbook/review/batch", "/api/wordbook/answers", "/api/wordbook/spell/sets",
    "/api/wordbook/spell/submit", "/api/wordbook/cards/junior/used%20to", "/api/wordbook/reports",
    // 每日目标面板(goals 计划 GW6,集成 Z1 发现守卫漏放):加练、暂停、继续、重置只读写数据库
    "/api/wordbook/bonus", "/api/wordbook/enrollment/pause", "/api/wordbook/enrollment/resume", "/api/wordbook/enrollment/reset",
    // 学习联动(LINKS_ENABLED 的 E2E 栈,learning links Z1):每页加载 /config;各联动只读写数据库与本地词典文件
    "/api/links/config", "/api/links/prefs", "/api/links/today", "/api/links/mistakes", "/api/links/mistakes/dismiss",
    "/api/links/weak-words", "/api/links/weak-words/dismiss", "/api/links/today-words", "/api/links/chat-words",
    "/api/links/wordbook/adopt", "/api/links/wordbook/card",
    // 智能体(AGENTS_ENABLED 的 E2E 栈,agents-web N2):对话页加载时请求 /config;设置与角色只读写数据库
    "/api/agents/config", "/api/agents/settings", "/api/agents/personas", "/api/agents/personas/p1", "/api/agents/personas/builtin%3Acoach",
    "/api/agents/personas/p1/report",
    // 账号 v2(accounts e2e):邮箱注册/找回的发码与重置、头像、举报、邀请码与 /me 只读写数据库或本地媒体库
    "/api/email/code", "/api/password/reset", "/api/users", "/api/sessions", "/api/sessions/current",
    "/api/me", "/api/me/password", "/api/me/email/code", "/api/me/email", "/api/me/avatar",
    "/api/me/invite", "/api/me/invite/rotate", "/api/avatars/3f2a9c", "/api/avatar-reports",
    // 「我的」与底部导航加载时请求:跟读库配置与更新日志(只读数据库 / 设置;已读游标只写数据库)
    "/api/library/config", "/api/changelog", "/api/changelog/seen",
    // 人机验证(captcha e2e):配置只读;挑战只签发
    "/api/captcha/config", "/api/captcha/challenge",
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
    // 背单词的 AI 讲解会触达上游(LLM)
    "/api/wordbook/explain", "/api/wordbook", "/api/wordbook/configx", "/api/wordbook/cards/junior",
    "/api/wordbook/enrollment/delete", "/api/wordbook/bonusx",
    "/api/links", "/api/links/configx", "/api/links/wordbook/cards", "/api/links/mistakes/x",
    // 回合、试聊、导师开始会触达 LLM:不放行(E2E 里用 page.route 模拟)
    "/api/agents/turn", "/api/agents/personas/try", "/api/agents/tutor/start", "/api/agents", "/api/agents/configx",
    // 账号 v2:只放行确切路径;相近的前缀与管理端路径不放行
    "/api/email/codex", "/api/email", "/api/avatars", "/api/avatars/a/b", "/api/password", "/api/password/reset/x",
    "/api/admin/avatar-reports", "/api/avatar-reports/u1/dismiss",
    // 人机验证:只放行两条确切路径;相近路径与管理端写入不放行
    "/api/captcha", "/api/captcha/challenge/x", "/api/captcha/config/x", "/api/captcha/verify", "/api/admin/settings",
  ])("blocks %s, which may reach an upstream", (path) => {
    expect(isOwnBackendPath(path)).toBe(false);
  });
});
