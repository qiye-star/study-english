import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
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
      assessments: 6, speakingSeconds: 3600, avgPronunciation: 88.44, grammarTop: [] as unknown[], poorWords: [] as unknown[], truncated: false,
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
  it("offers the room voice auto-text switch only when rooms are on", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    const mock = createFetchMock({ ...ROUTES, "GET /api/rooms/config": () => json({ enabled: true }) });
    const { unmount } = renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const toggle = await screen.findByTestId("me-room-voice-auto-text");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("联机语音自动转文字")).toBeInTheDocument();
    expect(screen.getByText("收到语音消息时自动显示文字和翻译")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toEqual({ language: "zh-CN", roomVoiceAutoText: true, colorScheme: "system" });
    unmount();
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({ ...ROUTES, "GET /api/rooms/config": () => json({ enabled: false }) }).fetch }) });
    await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("alloy"));
    expect(screen.queryByTestId("me-room-voice-auto-text")).toBeNull();
  });
  it("links to the vocabulary book", () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    expect(screen.getByTestId("me-vocabulary")).toHaveAttribute("href", "/vocabulary");
  });
  it("shows the wordbook row only when the wordbook is on", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
    try {
      const on = createFetchMock({
        ...ROUTES,
        "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }),
        "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0 }),
      });
      const { unmount } = renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: on.fetch }) });
      const row = await screen.findByTestId("me-wordbook");
      expect(row).toHaveAttribute("href", "/wordbook");
      expect(row).toHaveTextContent("背单词");
      unmount();
      const off = createFetchMock({ ...ROUTES, "GET /api/wordbook/config": () => json({ enabled: false }) });
      renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: off.fetch }) });
      await waitFor(() => expect(off.calls.some((c) => c.url.pathname === "/api/wordbook/config")).toBe(true));
      await waitFor(() => expect(screen.getByTestId("me-services")).toHaveTextContent("alloy"));
      expect(screen.queryByTestId("me-wordbook")).toBeNull();
    } finally {
      localStorage.removeItem("enjoy-web.settings");
      await i18n.changeLanguage("en");
    }
  });
  it("switches the appearance between system, light and dark and remembers it (D12)", async () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    const select = screen.getByTestId("me-color-scheme");
    expect(select).toHaveValue("system");
    expect(within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["system", "light", "dark"]);
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Follow system", { selector: "span.num" })).toBeInTheDocument(); // 行右侧的当前值(<option> 里也有同名文字,所以限定选择器)
    await userEvent.selectOptions(select, "dark");
    expect(select).toHaveValue("dark");
    expect(screen.getByText("Dark", { selector: "span.num" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toMatchObject({ colorScheme: "dark" });
    await userEvent.selectOptions(select, "system");
    expect(JSON.parse(localStorage.getItem("enjoy-web.settings")!)).toMatchObject({ colorScheme: "system" });
  });

  it("has the appearance copy in both languages", () => {
    for (const [lang, title, dark] of [["en", "Appearance", "Dark"], ["zh-CN", "外观", "深色"]] as const) {
      expect(i18n.getFixedT(lang)("web.me.colorScheme")).toBe(title);
      expect(i18n.getFixedT(lang)("web.me.colorSchemeOptions.dark")).toBe(dark);
    }
  });
  it("shows the agents row when agents are on", async () => {
    const mock = createFetchMock({ ...ROUTES,
      "GET /api/agents/config": () => json({ enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 }) });
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("me-agents")).toHaveAttribute("href", "/me/agents");
  });
});

describe("Me in the liquid skin (plan 2026-10-15-liquid-glass L11)", () => {
  beforeEach(() => { resetServerAiConfigCache(); localStorage.clear(); resetPlaybackRateForTests(); });
  afterEach(() => setLiquid(false));

  it("profile hero with stat wells, appearance row instead of the colour select, red well logout", async () => {
    setLiquid(true);
    const daily = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((date) => ({
      date, active: true, userMessages: 3, assessments: 1, speakingSeconds: 600, avgPronunciation: 88,
    }));
    const stats = {
      days: 7, tzOffsetMinutes: 480, today: "2026-10-08", daily, activeDays: 7, streakDays: 5, userMessages: 18,
      assessments: 6, speakingSeconds: 3600, avgPronunciation: 88.44, grammarTop: [] as unknown[], poorWords: [] as unknown[], truncated: false,
    };
    const mock = createFetchMock({ ...ROUTES, "GET /api/stats": () => json(stats) });
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const hero = await screen.findByTestId("me-hero");
    expect(hero.className).toContain("mat-surface-strong");
    expect(hero).toContainElement(screen.getByTestId("me-username"));
    expect(hero).toContainElement(await screen.findByTestId("me-stats"));
    expect(screen.queryByTestId("me-color-scheme")).toBeNull();
    const row = screen.getByTestId("me-appearance");
    expect(row).toHaveAttribute("href", "/me/appearance");
    expect(row).toHaveTextContent(/磨砂|Frosted|preset/);
    expect(screen.getByTestId("me-logout").className).toContain("liquid:text-red");
  });

  it("keeps the classic structure when the switch is off", () => {
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(ROUTES).fetch }) });
    expect(screen.queryByTestId("me-hero")).toBeNull();
    expect(screen.queryByTestId("me-appearance")).toBeNull();
    expect(screen.getByTestId("me-color-scheme")).toBeInTheDocument();
  });
});
