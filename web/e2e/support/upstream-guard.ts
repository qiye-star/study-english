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
const OWN_BACKEND_EXACT = new Set(["/api/realtime/config", "/api/rank/config", "/api/rank/me", "/api/rank/achievements", "/api/rooms/config"]);

export function isOwnBackendPath(pathname: string): boolean {
  return OWN_BACKEND.test(pathname) || OWN_BACKEND_EXACT.has(pathname);
}
