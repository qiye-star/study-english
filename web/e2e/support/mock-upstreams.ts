import type { Page } from "@playwright/test";

export const TRANSCRIPT = "I would like a coffee please.";

/** 页面自己的后端接口(只读写数据库,不碰上游)。其余 /api/** 路径一律视为可能触达上游。 */
const OWN_BACKEND = /^\/api\/(users|me|conversations|messages|config|stats|vocabulary|practice-items|upload|sessions|assessments)(\/|$)/;

export interface UpstreamMocks {
  seen: { transcriptions: number; chat: number; grammar: number; assessments: number; tts: number };
  /** 没有被模拟、却到了(可能的)真实上游路由的请求;必须为空。 */
  unmocked: string[];
}

function silentWav(): Buffer {
  const samples = 800; // 16 kHz 单声道 16 位,50 ms 静音
  const data = Buffer.alloc(samples * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * 路由模拟 + 防漏守卫(R29)。
 * Playwright 后注册的路由先匹配,所以:先注册兜底 `**​/api/**`(只对"不是自家后端"的路径拦截并记录并中止),
 * 再注册各具体模拟。调用方在用例结束时断言 `unmocked` 为空;WebSocket(实时通话)同样记录。
 */
export async function mockUpstreams(page: Page): Promise<UpstreamMocks> {
  const m: UpstreamMocks = { seen: { transcriptions: 0, chat: 0, grammar: 0, assessments: 0, tts: 0 }, unmocked: [] };

  page.on("websocket", (ws) => {
    if (new URL(ws.url()).pathname.startsWith("/api/")) m.unmocked.push(`WS ${ws.url()}`);
  });
  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (OWN_BACKEND.test(pathname)) return route.fallback();
    m.unmocked.push(`${route.request().method()} ${pathname}`);
    await route.abort("failed"); // 不放行:绝不真的打到上游
  });

  await page.route("**/api/ai/audio/transcriptions", async (route) => {
    m.seen.transcriptions++;
    await route.fulfill({ json: { text: TRANSCRIPT, segments: [] } });
  });
  await page.route("**/api/ai/chat/completions", async (route) => {
    m.seen.chat++;
    const body = ['data: {"choices":[{"delta":{"content":"Sure, "}}]}', 'data: {"choices":[{"delta":{"content":"what size?"}}]}', "data: [DONE]", ""].join("\n\n");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body });
  });
  await page.route("**/api/ai/grammar", async (route) => {
    m.seen.grammar++;
    await route.fulfill({ json: { hasErrors: false, corrected: TRANSCRIPT, errors: [] } });
  });
  await page.route("**/api/ai/audio/speech", async (route) => {
    m.seen.tts++;
    await route.fulfill({ status: 200, contentType: "audio/wav", body: silentWav() });
  });
  // 真实路径是 /api/speech/assessments(讯飞);模拟为"未配置",页面应优雅降级
  await page.route("**/api/speech/assessments", async (route) => {
    m.seen.assessments++;
    await route.fulfill({ status: 503, json: { error: "Pronunciation assessment is not configured" } });
  });
  return m;
}
