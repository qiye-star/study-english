import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerAiConfig } from "~/api/server-config";
import { TTS_VOICE_PREF_KEY } from "~/lib/storage";
import {
  getTtsVoicePref, parseTtsVoicePref, resetTtsVoicePrefMemory, resolveTtsVoice, setTtsVoice, storedTtsVoice, useTtsVoicePref,
} from "./tts-voice-pref";

const AI: ServerAiConfig = {
  llmModels: [],
  defaultLlmModel: "",
  ttsModels: ["openai/tts-1", "volcengine/seed"],
  voices: {
    openai: [{ label: "Alloy", value: "alloy" }, { label: "Nova", value: "nova" }],
    volcengine: [{ label: "Vivi", value: "zh_female_vivi" }],
  },
  defaultTts: { model: "openai/tts-1", voice: "alloy" },
};

const stored = () => JSON.parse(window.localStorage.getItem(TTS_VOICE_PREF_KEY) ?? "null");

describe("tts voice preference (/me/voice)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(TTS_VOICE_PREF_KEY);
    resetTtsVoicePrefMemory();
  });
  afterEach(() => {
    window.localStorage.removeItem(TTS_VOICE_PREF_KEY);
    resetTtsVoicePrefMemory();
  });

  it("with nothing stored, every scene resolves to the server default", () => {
    expect(getTtsVoicePref()).toEqual({});
    for (const scene of ["word", "sentence", "message"] as const) {
      expect(resolveTtsVoice(scene, AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
    }
  });

  it("a stored choice wins for its own scene only", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    expect(resolveTtsVoice("word", AI)).toEqual({ model: "openai/tts-1", voice: "nova" });
    expect(resolveTtsVoice("sentence", AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
    expect(stored()).toEqual({ word: { model: "openai/tts-1", voice: "nova" } });
  });

  it("falls back to the server default when the stored voice no longer exists", () => {
    setTtsVoice("message", { model: "openai/tts-1", voice: "gone" });
    expect(storedTtsVoice("message", AI)).toBeNull();
    expect(resolveTtsVoice("message", AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
  });

  it("falls back when the stored model's provider has been removed", () => {
    setTtsVoice("sentence", { model: "azure/neural", voice: "jenny" });
    expect(resolveTtsVoice("sentence", AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
  });

  it("a valid stored voice from another provider is used as is", () => {
    setTtsVoice("sentence", { model: "volcengine/seed", voice: "zh_female_vivi" });
    expect(resolveTtsVoice("sentence", AI)).toEqual({ model: "volcengine/seed", voice: "zh_female_vivi" });
  });

  it("with no server config yet, resolves to an empty pair so callers can skip playback", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    expect(resolveTtsVoice("word", null)).toEqual({ model: "", voice: "" });
    expect(storedTtsVoice("word", null)).toBeNull();
  });

  it("setting null restores the default and drops the key when no scene is left", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    setTtsVoice("word", null);
    expect(resolveTtsVoice("word", AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
    expect(window.localStorage.getItem(TTS_VOICE_PREF_KEY)).toBeNull();
  });

  it("ignores an invalid choice passed to setTtsVoice", () => {
    setTtsVoice("word", { model: "", voice: "nova" });
    expect(getTtsVoicePref()).toEqual({});
  });

  it("corrupt storage is ignored: not JSON, wrong shapes, and bad scenes only drop themselves", () => {
    window.localStorage.setItem(TTS_VOICE_PREF_KEY, "{not json");
    resetTtsVoicePrefMemory();
    expect(getTtsVoicePref()).toEqual({});
    window.localStorage.setItem(TTS_VOICE_PREF_KEY, JSON.stringify(["word"]));
    resetTtsVoicePrefMemory();
    expect(getTtsVoicePref()).toEqual({});
    window.localStorage.setItem(TTS_VOICE_PREF_KEY, JSON.stringify({
      word: { model: "openai/tts-1", voice: 42 },
      sentence: "nova",
      message: { model: "openai/tts-1", voice: "nova" },
      unknown: { model: "x", voice: "y" },
    }));
    resetTtsVoicePrefMemory();
    expect(getTtsVoicePref()).toEqual({ message: { model: "openai/tts-1", voice: "nova" } });
  });

  it("parseTtsVoicePref rejects empty strings and non-objects", () => {
    expect(parseTtsVoicePref(null)).toEqual({});
    expect(parseTtsVoicePref({ word: { model: "", voice: "nova" } })).toEqual({});
  });

  it("the hook re-renders on change without a reload", () => {
    const { result } = renderHook(() => useTtsVoicePref());
    expect(result.current.pref).toEqual({});
    act(() => result.current.setTtsVoice("sentence", { model: "openai/tts-1", voice: "nova" }));
    expect(result.current.pref).toEqual({ sentence: { model: "openai/tts-1", voice: "nova" } });
    act(() => result.current.setTtsVoice("sentence", null));
    expect(result.current.pref).toEqual({});
  });

  it("a reset from device-data makes the next read come from storage again", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    window.localStorage.removeItem(TTS_VOICE_PREF_KEY);
    resetTtsVoicePrefMemory();
    expect(resolveTtsVoice("word", AI)).toEqual({ model: "openai/tts-1", voice: "alloy" });
  });
});
