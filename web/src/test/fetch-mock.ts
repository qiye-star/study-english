import { vi } from "vitest";

export interface RecordedCall {
  method: string;
  url: URL;
  headers: Headers;
  body: BodyInit | null | undefined;
  signal?: AbortSignal | null;
}
export type Handler = (call: RecordedCall) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** routes 的键形如 "POST /api/sessions";未匹配返回 404 {"error":"Not Found"}。 */
export function createFetchMock(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const call: RecordedCall = { method, url, headers: new Headers(init.headers), body: init.body, signal: init.signal };
    calls.push(call);
    const handler = routes[`${method} ${url.pathname}`];
    return handler ? handler(call) : json({ error: "Not Found" }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
