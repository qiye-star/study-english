import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PLAYBACK_RATE_KEY, resetPlaybackRateForTests } from "~/lib/playback-rate";
import { MePage } from "./me-page";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1", "azure/speech"], voices: {} } }),
  "GET /api/me/grammar-prompt": () => json({ prompt: null, default_prompt: "RULES", max_length: 2000 }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("MePage", () => {
  beforeEach(() => { resetServerAiConfigCache(); localStorage.clear(); resetPlaybackRateForTests(); });
  it("shows the account, server services and logs out", async () => {
    const mock = createFetchMock(ROUTES);
    const logout = vi.fn();
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), logout });
    expect(screen.getByTestId("me-username")).toHaveTextContent("alice");
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("openai/tts-1, azure/speech"));
    expect(screen.getByTestId("me-services")).toHaveTextContent("alloy");
    await userEvent.click(screen.getByTestId("me-logout"));
    expect(logout).toHaveBeenCalled();
  });
  it("changes the language", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    await userEvent.selectOptions(screen.getByTestId("me-language"), "zh-CN");
    expect(await screen.findByText("退出登录")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("me-language"), "en");
  });
  it("shows a translated error with a retry button when the server config fails", async () => {
    let fail = true;
    const mock = createFetchMock({ ...ROUTES, "GET /api/config/gpt_providers": () => (fail ? json({ error: "boom" }, 500) : json({ enjoyai: { models: ["gpt-4o"] } })) });
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("me-ai-error")).toHaveTextContent("Something went wrong.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("openai/tts-1"));
    expect(screen.queryByTestId("me-ai-error")).toBeNull();
  });
  it("shows the grammar prompt editor", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    expect(await screen.findByTestId("grammar-prompt-input")).toHaveValue("RULES");
  });
  it("sets the read-aloud speed", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    const select = screen.getByTestId("me-playback-rate");
    expect(select).toHaveValue("1");
    await userEvent.selectOptions(select, "1.25");
    expect(localStorage.getItem(PLAYBACK_RATE_KEY)).toBe("1.25");
    expect(select).toHaveValue("1.25");
  });
  it("links to the progress page", () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    expect(screen.getByTestId("me-progress")).toHaveAttribute("href", "/progress");
  });
  it("shows the 7-day overview from the stats API and hides it when stats fail", async () => {
    const daily = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date, i) => ({
      date, active: i !== 2, userMessages: 3, assessments: 1, speakingSeconds: 600, avgPronunciation: 88,
    }));
    const stats = {
      days: 7, tzOffsetMinutes: 480, today: "2026-10-08", daily, activeDays: 6, streakDays: 5, userMessages: 18,
      assessments: 6, speakingSeconds: 3600, avgPronunciation: 88.44, grammarTop: [], poorWords: [], truncated: false,
    };
    const mock = createFetchMock({ ...ROUTES, "GET /api/stats": () => json(stats) });
    const { unmount } = renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const tiles = await screen.findByTestId("me-stats");
    expect(tiles).toHaveTextContent("5");
    expect(tiles).toHaveTextContent("60");
    expect(tiles).toHaveTextContent("88.4");
    expect(screen.getByTestId("me-progress")).toHaveTextContent("6 active days · 18 messages");
    const week = screen.getByTestId("me-week").querySelectorAll("li");
    expect(week).toHaveLength(7);
    expect(week[2]).toHaveAttribute("data-active", "false");
    expect(week[6]).toHaveTextContent("today: practiced");
    expect(mock.calls.find((c) => c.url.pathname === "/api/stats")?.url.searchParams.get("days")).toBe("7");
    unmount();
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("alloy"));
    expect(screen.queryByTestId("me-stats")).toBeNull();
    expect(screen.getByTestId("me-logout")).toBeInTheDocument();
  });
  it("links to the vocabulary book", () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    expect(screen.getByTestId("me-vocabulary")).toHaveAttribute("href", "/vocabulary");
  });
});
