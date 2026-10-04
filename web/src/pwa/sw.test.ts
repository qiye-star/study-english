// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const code = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

function load() {
  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  };
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (req: Request) => store.get(req.url)),
    put: vi.fn(async (req: Request, res: Response) => void store.set(req.url, res)),
    keys: vi.fn(async () => [...store.keys()].map((u) => new Request(u))),
    delete: vi.fn(async (req: Request) => store.delete(req.url)),
  };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["enjoy-web-assets-v0", "enjoy-web-assets-v1"]), delete: vi.fn(async () => true) };
  const fetchMock = vi.fn(async () => new Response("asset", { status: 200 }));
  new Function("self", "caches", "fetch", code)(self, caches, fetchMock);
  return { listeners, caches, cache, fetchMock, self };
}

const fetchEvent = (url: string, method = "GET") => {
  const event = { request: new Request(url, { method }), respondWith: vi.fn() };
  return event;
};

describe("service worker", () => {
  it.each([
    "https://app.test/",
    "https://app.test/practice",
    "https://app.test/index.html",
    "https://app.test/sw.js",
    "https://app.test/manifest.webmanifest",
    "https://app.test/api/me",
    "https://app.test/api/assessments/x/audio",
    "https://cdn.other.test/assets/x.js",
  ])("does not intercept %s", (url) => {
    const { listeners } = load();
    const event = fetchEvent(url);
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("ignores non-GET requests", () => {
    const { listeners } = load();
    const event = fetchEvent("https://app.test/assets/a.js", "POST");
    listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("serves hashed assets cache-first", async () => {
    const { listeners, fetchMock } = load();
    const first = fetchEvent("https://app.test/assets/index-abc.js");
    listeners.fetch(first);
    expect(await (await first.respondWith.mock.calls[0][0]).text()).toBe("asset");
    const second = fetchEvent("https://app.test/assets/index-abc.js");
    listeners.fetch(second);
    await second.respondWith.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed asset responses", async () => {
    const { listeners, cache, fetchMock } = load();
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    const event = fetchEvent("https://app.test/assets/missing.js");
    listeners.fetch(event);
    const res = await event.respondWith.mock.calls[0][0];
    expect(res.status).toBe(404);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("activates immediately on install", () => {
    const { listeners, self } = load();
    listeners.install({});
    expect(self.skipWaiting).toHaveBeenCalled();
  });

  it("drops old caches on activate and claims clients", async () => {
    const { listeners, caches, self } = load();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(caches.delete).toHaveBeenCalledWith("enjoy-web-assets-v0");
    expect(caches.delete).not.toHaveBeenCalledWith("enjoy-web-assets-v1");
    expect(self.clients.claim).toHaveBeenCalled();
  });
});
