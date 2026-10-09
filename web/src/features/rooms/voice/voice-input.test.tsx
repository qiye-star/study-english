import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { holdMic } from "~/test/hold";
import { renderWithProviders } from "~/test/render";
import { useState } from "react";
import type { RoomVoiceController, RoomVoiceState } from "./use-room-voice";
import { VoiceInput } from "./voice-input";

function controller(over: Partial<RoomVoiceController> = {}): RoomVoiceController {
  return { state: "idle", elapsedMs: 0, error: null, start: vi.fn(async () => true), finish: vi.fn(), discard: vi.fn(), release: vi.fn(), ...over };
}

describe("VoiceInput", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("hold sends, slide left cancels, slide right fills", async () => {
    const voice = controller();
    // 长条在 live=false 且已拿到麦克风时归位:用一个会随 start/finish/discard 变化的控制器
    function Harness() {
      const [state, setState] = useState<RoomVoiceState>("idle");
      const live: RoomVoiceController = {
        ...voice, state,
        start: async () => { const ok = await voice.start(); if (ok) setState("recording"); return ok; },
        finish: (d) => { voice.finish(d); setState("idle"); },
        discard: (r) => { voice.discard(r); setState("idle"); },
      };
      return <VoiceInput voice={live} disabled={false} maxMs={60000} />;
    }
    renderWithProviders(<Harness />);
    const mic = screen.getByTestId("room-mic");
    const left = window.innerWidth / 4;
    const right = (window.innerWidth * 3) / 4;
    await holdMic(mic);
    expect(voice.finish).toHaveBeenLastCalledWith("send");
    expect(voice.release).toHaveBeenCalled();
    await holdMic(mic, { dy: -120, x: left });
    expect(voice.discard).toHaveBeenLastCalledWith("slide");
    await holdMic(mic, { dy: -120, x: right });
    expect(voice.finish).toHaveBeenLastCalledWith("fill");
  });

  it("shows the busy label and the error line", () => {
    renderWithProviders(<VoiceInput voice={controller({ state: "sending", error: "语音存储已满,可以继续发文字" })} disabled={false} maxMs={60000} />);
    expect(screen.getByTestId("room-mic").textContent).toContain("正在发送…");
    expect(screen.getByTestId("room-voice-error").textContent).toBe("语音存储已满,可以继续发文字");
  });

  it("shows the transcribing label", () => {
    renderWithProviders(<VoiceInput voice={controller({ state: "transcribing" })} disabled={false} maxMs={60000} />);
    expect(screen.getByTestId("room-mic").textContent).toContain("正在转文字…");
    expect(screen.queryByTestId("room-voice-error")).toBeNull();
  });
});
