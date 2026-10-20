/**
 * e2e 防漏守卫的分类(R29):哪些 /api 路径是页面自家后端(只读写数据库/进程内状态,不碰上游),可以放行到真实服务端。
 * 其余 /api/** 一律视为可能触达上游,必须有路由模拟,否则守卫记录并中止。
 *
 * 维护规则:页面在**加载时**新请求一个自家接口(例如 4.11 的 GET /api/realtime/config),必须加进这里,
 * 否则每个用了守卫的用例都会在 afterEach 里失败。只放行确定不碰上游的精确路径,不要放宽整个前缀:
 * - /api/realtime/config 只读设置;/api/realtime/ticket 与 WebSocket /api/realtime 会开通话(上游),不放行。
 * - /api/assessments 只读数据库;/api/speech/assessments(讯飞)不放行。
 */
const OWN_BACKEND = /^\/api\/(users|me|conversations|messages|config|stats|vocabulary|practice-items|upload|sessions|assessments)(\/|$)/;
// 段位/联机的配置与段位读数在练习页、「我的」和底部导航加载时就会请求(RANK_ENABLED / ROOMS_ENABLED),只读写数据库。
// /api/rank/matches/*(考官、转写、评分)与 /api/rooms/ws(房间 AI)会触达上游,不放行。
// /api/announcements:公告条(管理端 v2)每页加载时请求,只读数据库。
// /api/library/config:跟读库的开关与限额(只读设置与配额);/api/changelog 与 /seen:更新日志(只读 / 只写已读游标,不碰上游)。
// 「我的」页与底部导航加载时请求。
const OWN_BACKEND_EXACT = new Set(["/api/realtime/config", "/api/rank/config", "/api/rank/me", "/api/rank/achievements", "/api/rooms/config",
  "/api/announcements", "/api/library/config", "/api/changelog", "/api/changelog/seen"]);

// 背单词(WORDBOOK_ENABLED):只读写数据库与本地词典文件;/api/wordbook/explain(AI 讲解,LLM)不放行。
const OWN_WORDBOOK = /^\/api\/wordbook\/(config|today|books|enrollment|enrollment\/(?:pause|resume|reset)|bonus|learn\/batch|review\/batch|answers|spell\/sets|spell\/submit|reports|cards\/[^/]+\/[^/]+)$/;

// 学习联动(LINKS_ENABLED):每页加载 /config;各联动接口只读写数据库与本地词典文件。对话用词的大模型检查
// (LINK_CHAT_WORDS_LLM_ENABLED)在服务端处理器里异步进行、默认关闭,E2E 栈不开。
const OWN_LINKS = /^\/api\/links\/(config|prefs|today|mistakes|mistakes\/dismiss|weak-words|weak-words\/dismiss|today-words|chat-words|wordbook\/adopt|wordbook\/card)$/;

// 智能体(AGENTS_ENABLED):对话页每次加载请求 /config;设置、角色增删改与举报只读写数据库。
// /turn、/personas/try(LLM)与 /tutor/*(可能出题调用 LLM)不放行;记忆端点由 agents-memory 计划追加。
const OWN_AGENTS = /^\/api\/agents\/(config|settings|personas|personas\/(?!try$)[^/]+|personas\/[^/]+\/report)$/;

// 账号 v2(邮箱注册 / 找回密码 / 头像 / 邀请码):发码与重置只写数据库并走站内邮件后端(测试栈为 console,不发信);
// 头像只读写本地媒体库。/api/me/*、/api/users、/api/sessions 已由 OWN_BACKEND 放行。/api/avatars/{id} 只读图片。
// /api/avatar-reports(举报)只写数据库。上游相关路径不在此列。
const OWN_ACCOUNT = /^\/api\/(email\/code|password\/reset|avatar-reports|avatars\/[^/]+)$/;

export function isOwnBackendPath(pathname: string): boolean {
  return OWN_BACKEND.test(pathname) || OWN_BACKEND_EXACT.has(pathname) || OWN_WORDBOOK.test(pathname) || OWN_LINKS.test(pathname)
    || OWN_AGENTS.test(pathname) || OWN_ACCOUNT.test(pathname);
}
