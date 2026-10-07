import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { CLOSE_REASONS } from "./protocol";
import { REALTIME_SERVER_ERRORS, createRealtimeTicket, fetchRealtimeConfig, realtimeUrl } from "./realtime-api";

describe("realtime api", () => {
  it("reads the config and requests a ticket in snake_case", async () => {
    const mock = createFetchMock({
      "GET /api/realtime/config": () => json({ enabled: true, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
      "POST /api/realtime/ticket": () => json({ ticket: "abc", expires_in: 60 }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await fetchRealtimeConfig(api)).toEqual({ enabled: true, maxMinutes: 10, idleTimeoutSeconds: 60, asrMode: "buffered", sampleRateIn: 16000, sampleRateOut: 24000 });
    expect(await createRealtimeTicket(api, "c1")).toEqual({ ticket: "abc", expiresIn: 60 });
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ conversation_id: "c1" });
  });

  it("builds ws and wss urls without leaking the login token", () => {
    expect(realtimeUrl("a+b", { protocol: "https:", host: "x.test" })).toBe("wss://x.test/api/realtime?ticket=a%2Bb");
    expect(realtimeUrl("t", { protocol: "http:", host: "127.0.0.1:5173" })).toBe("ws://127.0.0.1:5173/api/realtime?ticket=t");
  });

  it("translates every server error, close reason and error code in both languages", () => {
    const keys = [
      ...Object.values(REALTIME_SERVER_ERRORS),
      ...Object.values(CLOSE_REASONS).filter((r) => r !== "normal").map((r) => `web.realtime.errors.${r}`),
      ...["generic", "asr_failed", "llm_failed", "tts_failed", "rate_limited", "message_limit", "micLost", "unsupported"].map((r) => `web.realtime.errors.${r}`),
    ];
    for (const lng of ["en", "zh-CN"]) for (const k of keys) expect(i18n.getFixedT(lng)(k), `${lng}:${k}`).not.toBe(k);
  });
});
