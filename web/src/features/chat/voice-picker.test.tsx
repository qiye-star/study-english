import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { AuthContext, type AuthContextValue } from "~/auth/auth-context";
import { normalizeVoices } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TtsCache } from "./tts";
import { PREVIEW_SENTENCE, VoicePicker } from "./voice-picker";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const VOICES = normalizeVoices({
  volcengine: [
    { label: "Dacey (Female)", value: "dacey", language: "en-US" },
    { label: "Tim (Male)", value: "tim", language: "en-US" },
    { label: "Charlotte (Female)", value: "charlotte", language: "en-GB" },
  ],
}).volcengine;

let audios: Array<{ src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: null | (() => void) }>;
const createAudio = () => {
  const a = { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void) };
  audios.push(a);
  return a as unknown as HTMLAudioElement;
};

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});
beforeEach(() => { audios = []; toastError.mockClear(); });

function setup(routes: Parameters<typeof createFetchMock>[0], value = "dacey") {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onChange = vi.fn();
  const ctx = { api } as unknown as AuthContextValue;
  const utils = render(
    <AuthContext.Provider value={ctx}>
      <VoicePicker voices={VOICES} model="volcengine/seed-tts-2.0" value={value} onChange={onChange}
        cache={new TtsCache(10, { create: () => "blob:1", revoke: () => {} })} createAudio={createAudio} />
    </AuthContext.Provider>,
  );
  return { mock, onChange, ...utils };
}
const OK = { "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) };
const speech = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech");

describe("VoicePicker", () => {
  it("shows the selected voice under settings-tts-voice and filters by accent tabs", async () => {
    setup(OK);
    const sel = screen.getByTestId("settings-tts-voice");
    expect(sel).toHaveAttribute("data-value", "dacey");
    expect(sel).toHaveTextContent("Dacey");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    await userEvent.click(screen.getByTestId("voice-accent-gb"));
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("data-testid"))).toEqual(["voice-option-charlotte"]);
    await userEvent.click(screen.getByTestId("voice-accent-us"));
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    await userEvent.click(screen.getByTestId("voice-accent-all"));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("hides accent tabs when voices carry no accent info", () => {
    const mock = createFetchMock(OK);
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    render(<AuthContext.Provider value={{ api } as unknown as AuthContextValue}>
      <VoicePicker voices={normalizeVoices({ openai: ["alloy", "echo"] }).openai} model="openai/tts-1" value="alloy" onChange={vi.fn()} />
    </AuthContext.Provider>);
    expect(screen.queryByTestId("voice-accent-us")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("selects a voice without previewing, and previews without selecting", async () => {
    const { mock, onChange } = setup(OK);
    await userEvent.click(screen.getByTestId("voice-option-tim"));
    expect(onChange).toHaveBeenCalledWith("tim");
    expect(speech(mock)).toHaveLength(0);
    await userEvent.click(screen.getByTestId("voice-preview-charlotte"));
    await waitFor(() => expect(speech(mock)).toHaveLength(1));
    expect(JSON.parse(speech(mock)[0].body as string)).toEqual({ input: PREVIEW_SENTENCE, model: "volcengine/seed-tts-2.0", voice: "charlotte" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("plays one preview at a time, stops on a second tap, and caches per voice", async () => {
    const { mock } = setup(OK);
    await userEvent.click(screen.getByTestId("voice-preview-dacey"));
    await waitFor(() => expect(screen.getByTestId("voice-preview-dacey")).toHaveAttribute("data-state", "playing"));
    await userEvent.click(screen.getByTestId("voice-preview-tim"));
    await waitFor(() => expect(screen.getByTestId("voice-preview-tim")).toHaveAttribute("data-state", "playing"));
    expect(screen.getByTestId("voice-preview-dacey")).toHaveAttribute("data-state", "idle");
    expect(document.querySelectorAll('[data-state="playing"]')).toHaveLength(1);
    await userEvent.click(screen.getByTestId("voice-preview-tim"));
    await waitFor(() => expect(screen.getByTestId("voice-preview-tim")).toHaveAttribute("data-state", "idle"));
    expect(audios[0].pause).toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("voice-preview-dacey")); // cached: no second request for dacey
    await waitFor(() => expect(screen.getByTestId("voice-preview-dacey")).toHaveAttribute("data-state", "playing"));
    expect(speech(mock)).toHaveLength(2);
  });

  it("shows a toast when the preview fails", async () => {
    setup({ "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502) });
    await userEvent.click(screen.getByTestId("voice-preview-dacey"));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("voice-preview-dacey")).toHaveAttribute("data-state", "error");
  });

  it("stops playing when unmounted", async () => {
    const { unmount } = setup(OK);
    await userEvent.click(screen.getByTestId("voice-preview-dacey"));
    await waitFor(() => expect(screen.getByTestId("voice-preview-dacey")).toHaveAttribute("data-state", "playing"));
    act(() => unmount());
    expect(audios[0].pause).toHaveBeenCalled();
  });
});
