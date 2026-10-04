import { describe, expect, it } from "vitest";
import { AudioConvertError } from "./convert";
import { describeAudioError } from "./describe-error";
import { RecorderError } from "./recorder";

const t = ((key: string) => `T:${key}`) as never;

describe("describeAudioError", () => {
  it("maps recorder and convert errors to web.* keys", () => {
    expect(describeAudioError(t, new RecorderError("mic_busy"))).toBe("T:web.recorder.mic_busy");
    expect(describeAudioError(t, new RecorderError("permission_denied"))).toBe("T:web.recorder.permission_denied");
    expect(describeAudioError(t, new AudioConvertError("too_long"))).toBe("T:web.audio.too_long");
  });
  it("falls back to server error translation", () => {
    expect(typeof describeAudioError(t, new Error("x"))).toBe("string");
  });
});
