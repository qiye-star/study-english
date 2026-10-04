import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { VoiceInputButton } from "./voice-input-button";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

describe("VoiceInputButton", () => {
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
