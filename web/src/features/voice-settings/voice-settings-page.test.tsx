import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerAiConfig } from "~/api/server-config";
import { TTS_VOICE_PREF_KEY } from "~/lib/storage";
import { resetTtsVoicePrefMemory, setTtsVoice } from "~/settings/tts-voice-pref";
import { renderWithProviders } from "~/test/render";
import { VoiceSettingsPage, type VoicePreviewPlayer } from "./voice-settings-page";

const SAMPLE = "Hi, nice to meet you.";

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

function fakePlayer(states: VoicePreviewPlayer["states"] = {}) {
  return { states, play: vi.fn(), stop: vi.fn() };
}

function renderPage(ai: ServerAiConfig | null | undefined = AI, player = fakePlayer()) {
  renderWithProviders(<VoiceSettingsPage ai={ai} player={player} sample={SAMPLE} />, { route: "/me/voice", path: "/me/voice" });
  return player;
}

describe("VoiceSettingsPage (/me/voice)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(TTS_VOICE_PREF_KEY);
    resetTtsVoicePrefMemory();
  });
  afterEach(() => {
    window.localStorage.removeItem(TTS_VOICE_PREF_KEY);
    resetTtsVoicePrefMemory();
  });

  it("shows one row per scene, all following the server default at first", () => {
    renderPage();
    for (const scene of ["word", "sentence", "message"]) {
      expect((screen.getByTestId(`voice-scene-${scene}-model`) as HTMLSelectElement).value).toBe("");
      expect((screen.getByTestId(`voice-scene-${scene}-voice`) as HTMLSelectElement).disabled).toBe(true);
      expect(screen.getByTestId(`voice-scene-${scene}-effective`).textContent).toBe("alloy");
    }
  });

  it("choosing a model stores its first voice, and the effective voice follows", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("voice-scene-sentence-model"), { target: { value: "volcengine/seed" } });
    expect(stored()).toEqual({ sentence: { model: "volcengine/seed", voice: "zh_female_vivi" } });
    expect(screen.getByTestId("voice-scene-sentence-effective").textContent).toBe("zh_female_vivi");
    expect(screen.getByTestId("voice-scene-word-effective").textContent).toBe("alloy");
  });

  it("choosing a voice stores it for that scene only", () => {
    renderPage();
    fireEvent.change(screen.getByTestId("voice-scene-word-model"), { target: { value: "openai/tts-1" } });
    fireEvent.change(screen.getByTestId("voice-scene-word-voice"), { target: { value: "nova" } });
    expect(stored()).toEqual({ word: { model: "openai/tts-1", voice: "nova" } });
    expect(screen.getByTestId("voice-scene-word-effective").textContent).toBe("nova");
    expect(screen.getByTestId("voice-scene-message-effective").textContent).toBe("alloy");
  });

  it("choosing 默认 (follow default) clears the scene", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    renderPage();
    expect((screen.getByTestId("voice-scene-word-voice") as HTMLSelectElement).value).toBe("nova");
    fireEvent.change(screen.getByTestId("voice-scene-word-model"), { target: { value: "" } });
    expect(window.localStorage.getItem(TTS_VOICE_PREF_KEY)).toBeNull();
    expect(screen.getByTestId("voice-scene-word-effective").textContent).toBe("alloy");
  });

  it("a stored voice that the server no longer offers shows a notice and falls back to the default", () => {
    setTtsVoice("message", { model: "openai/tts-1", voice: "gone" });
    renderPage();
    expect(screen.getByTestId("voice-scene-message-stale")).toBeTruthy();
    expect((screen.getByTestId("voice-scene-message-model") as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("voice-scene-message-effective").textContent).toBe("alloy");
    expect(screen.queryByTestId("voice-scene-word-stale")).toBeNull();
  });

  it("preview plays the sample with the scene's effective voice", () => {
    setTtsVoice("word", { model: "openai/tts-1", voice: "nova" });
    const player = renderPage();
    fireEvent.click(screen.getByTestId("voice-scene-word-preview"));
    expect(player.play).toHaveBeenCalledWith("voice-settings:word", SAMPLE, "openai/tts-1", "nova");
    fireEvent.click(screen.getByTestId("voice-scene-sentence-preview"));
    expect(player.play).toHaveBeenLastCalledWith("voice-settings:sentence", SAMPLE, "openai/tts-1", "alloy");
  });

  it("while a preview is playing, its button stops it instead of starting another", () => {
    const player = renderPage(AI, fakePlayer({ "voice-settings:word": "playing" }));
    const button = screen.getByTestId("voice-scene-word-preview");
    expect(button.getAttribute("data-state")).toBe("playing");
    fireEvent.click(button);
    expect(player.stop).toHaveBeenCalledTimes(1);
    expect(player.play).not.toHaveBeenCalled();
  });

  it("preview is disabled when the server gives no default voice", () => {
    renderPage({ ...AI, defaultTts: { model: "", voice: "" } });
    expect((screen.getByTestId("voice-scene-word-preview") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a loading note while the config is loading and an unavailable note when it failed", () => {
    const { unmount } = renderWithProviders(<VoiceSettingsPage ai={undefined} player={fakePlayer()} sample={SAMPLE} />);
    expect(screen.getByText("Loading read-aloud settings…")).toBeTruthy();
    unmount();
    renderWithProviders(<VoiceSettingsPage ai={null} player={fakePlayer()} sample={SAMPLE} />);
    expect(screen.getByText("Read-aloud settings are unavailable right now.")).toBeTruthy();
    expect(screen.queryByTestId("voice-scene-word")).toBeNull();
  });
});
