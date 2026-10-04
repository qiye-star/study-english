import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { VoiceInputButton } from "./voice-input-button";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

describe("VoiceInputButton", () => {
  beforeEach(() => { vi.mocked(toast.error).mockClear(); vi.mocked(toast.info).mockClear(); });
  const record = async (routes: Parameters<typeof createFetchMock>[0], onText = vi.fn()) => {
    const mock = createFetchMock(routes);
    renderWithProviders(<VoiceInputButton onText={onText} recorderEnv={createFakeRecorderEnv().env} />, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    });
    await userEvent.click(screen.getByTestId("chat-mic"));
    await userEvent.click(screen.getByTestId("chat-mic"));
    return onText;
  };
  it("tells the user nothing was recognized when the transcript is empty", async () => {
    const onText = await record({ "POST /api/ai/audio/transcriptions": () => json({ text: "   " }) });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No speech was recognized."));
    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
  });
  it("shows a translated error when transcription fails", async () => {
    const onText = await record({ "POST /api/ai/audio/transcriptions": () => json({ error: "Whisper upstream is not configured" }, 503) });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Speech-to-text is not configured on the server."));
    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
  });

  it("records, transcribes and hands back the text", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: " Ask not what your country can do " }) });
    const onText = vi.fn();
    const fake = createFakeRecorderEnv();
    renderWithProviders(<VoiceInputButton onText={onText} recorderEnv={fake.env} />, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    });
    await userEvent.click(screen.getByTestId("chat-mic"));
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "recording");
    await userEvent.click(screen.getByTestId("chat-mic"));
    await waitFor(() => expect(onText).toHaveBeenCalledWith("Ask not what your country can do"));
    expect(screen.getByTestId("chat-mic")).toHaveAttribute("data-state", "idle");
  });
});
