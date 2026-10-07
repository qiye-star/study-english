import { describe, expect, it } from "vitest";
import { ApiError } from "~/api/client";
import { RecorderError } from "~/audio/recorder";
import { realtimeErrorKey } from "./errors";

describe("realtimeErrorKey", () => {
  it("maps ticket HTTP errors to their specific messages", () => {
    expect(realtimeErrorKey(new ApiError(503, "Realtime is not enabled"))).toBe("web.realtime.errors.disabled");
    expect(realtimeErrorKey(new ApiError(401, "Not authenticated"))).toBe("web.realtime.errors.unauthorized");
    expect(realtimeErrorKey(new ApiError(404, "Conversation not found"))).toBe("web.realtime.errors.not_found");
    expect(realtimeErrorKey(new ApiError(429, "Too many requests, please try again later"))).toBe("web.realtime.errors.rate_limited");
  });

  it("falls back to the generic message", () => {
    expect(realtimeErrorKey(new ApiError(500, "boom"))).toBe("web.realtime.errors.generic");
    expect(realtimeErrorKey(new TypeError("offline"))).toBe("web.realtime.errors.generic");
  });

  it("maps microphone errors to the recorder texts", () => {
    expect(realtimeErrorKey(new RecorderError("permission_denied"))).toBe("web.recorder.permission_denied");
  });
});
