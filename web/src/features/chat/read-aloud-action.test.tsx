import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ReadAloudAction } from "./read-aloud-action";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const CONFIG: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: [{ value: "alloy" }] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const apiFor = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});
beforeEach(() => { resetServerAiConfigCache(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("ReadAloudAction", () => {
  it("is disabled until the TTS config has loaded, then primes the audio element synchronously inside the click", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    let release: () => void = () => {};
    const mock = createFetchMock({
      ...CONFIG,
      "POST /api/ai/audio/speech": () => new Promise((resolve) => { release = () => resolve(new Response(new Uint8Array([1]))); }),
    });
    renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(mock) });
    const button = await screen.findByTestId("read");
    await waitFor(() => expect(button).toBeEnabled());
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1); // the silent priming play(): synchronous, the speech request is still pending
    expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true);
    expect(button).toHaveAttribute("data-state", "loading");
    release();
    await waitFor(() => expect(button).toHaveAttribute("data-state", "playing"));
    expect(play).toHaveBeenCalledTimes(2); // the real audio
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body)))
      .toEqual({ input: "country", model: "openai/tts-1", voice: "alloy" });
  });

  it("a second click while loading or playing stops instead of starting again", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const mock = createFetchMock({ ...CONFIG, "POST /api/ai/audio/speech": () => new Promise<Response>(() => {}) });
    renderWithProviders(<ReadAloudAction text="harbour" testId="read" />, { api: apiFor(mock) });
    const button = await screen.findByTestId("read");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-state", "loading");
    fireEvent.click(button);
    expect(pause).toHaveBeenCalled();
    expect(button).toHaveAttribute("data-state", "idle");
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech")).toHaveLength(1);
  });

  it("renders nothing when no TTS model is configured or the config cannot be loaded", async () => {
    const none = createFetchMock({ ...CONFIG, "GET /api/config/tts_providers_v2": () => json({}), "GET /api/config/default_tts_preset": () => json({}) });
    const first = renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(none) });
    await waitFor(() => expect(none.calls.length).toBeGreaterThanOrEqual(4));
    await waitFor(() => expect(screen.queryByTestId("read")).toBeNull());
    first.unmount();
    resetServerAiConfigCache();
    const broken = createFetchMock({});
    renderWithProviders(<ReadAloudAction text="country" testId="read" />, { api: apiFor(broken) });
    await waitFor(() => expect(broken.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByTestId("read")).toBeNull());
  });
});
