import { describe, expect, it, vi } from "vitest";
import {
  EARPIECE_VOLUME, SPEAKER_KEY, SPEAKER_VOLUME, enterCallAudioSession, loadSpeakerPreference, saveSpeakerPreference, speakerVolume,
} from "./audio-route";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: vi.fn((k: string) => (k in data ? data[k] : null)),
    setItem: vi.fn((k: string, v: string) => { data[k] = v; }),
  };
}

describe("speaker (hands-free) preference", () => {
  it("defaults to hands-free on touch devices and to earpiece elsewhere", () => {
    expect(loadSpeakerPreference({ storage: memoryStorage(), touch: true })).toBe(true);
    expect(loadSpeakerPreference({ storage: memoryStorage(), touch: false })).toBe(false);
  });

  it("persists the user's choice", () => {
    const storage = memoryStorage();
    saveSpeakerPreference(false, { storage, touch: true });
    expect(storage.data[SPEAKER_KEY]).toBe("earpiece");
    expect(loadSpeakerPreference({ storage, touch: true })).toBe(false);
    saveSpeakerPreference(true, { storage, touch: false });
    expect(loadSpeakerPreference({ storage, touch: false })).toBe(true);
  });

  it("survives storage that throws (private mode, blocked site data) or holds junk", () => {
    const throwing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(loadSpeakerPreference({ storage: throwing, touch: true })).toBe(true);
    expect(() => saveSpeakerPreference(true, { storage: throwing, touch: true })).not.toThrow();
    expect(loadSpeakerPreference({ storage: memoryStorage({ [SPEAKER_KEY]: "loud" }), touch: false })).toBe(false);
    expect(loadSpeakerPreference({ touch: true })).toBe(true); // 没有 storage
  });

  it("maps the mode to gain presets", () => {
    expect(speakerVolume(true)).toBe(SPEAKER_VOLUME);
    expect(speakerVolume(false)).toBe(EARPIECE_VOLUME);
    expect(SPEAKER_VOLUME).toBeCloseTo(2.2);
    expect(EARPIECE_VOLUME).toBe(1);
  });
});

describe("enterCallAudioSession (navigator.audioSession, Safari 16.4+)", () => {
  it("switches to play-and-record for the call and restores the previous type", () => {
    const nav = { audioSession: { type: "auto" } };
    const restore = enterCallAudioSession(nav);
    expect(nav.audioSession.type).toBe("play-and-record");
    restore();
    expect(nav.audioSession.type).toBe("auto");
    restore(); // 幂等
    expect(nav.audioSession.type).toBe("auto");
  });

  it("is a no-op where the API is missing or refuses the value", () => {
    expect(() => enterCallAudioSession({})()).not.toThrow();
    const nav = {
      audioSession: Object.defineProperty({} as { type: string }, "type", {
        get: () => "auto", set: () => { throw new TypeError("read-only"); },
      }),
    };
    expect(() => enterCallAudioSession(nav)()).not.toThrow();
  });
});
