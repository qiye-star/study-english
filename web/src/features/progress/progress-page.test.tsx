import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ProgressPage } from "./progress-page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const days = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, "0")}`, active: i === n - 1, user_messages: i === n - 1 ? 3 : 0, assessments: i === n - 1 ? 2 : 0,
  speaking_seconds: i === n - 1 ? 95 : 0, avg_pronunciation: i === n - 1 ? 81.5 : null,
}));
const stats = (n: number, extra: Record<string, unknown> = {}) => ({
  days: n, tz_offset_minutes: 480, today: "2026-10-05", daily: days(n), active_days: 1, streak_days: 1, user_messages: 3, assessments: 2,
  speaking_seconds: 95, avg_pronunciation: 81.5, grammar_top: [{ category: "tense", count: 2 }], poor_words: [{ word: "think", count: 2 }], truncated: false, ...extra,
});
const page = (mock: ReturnType<typeof createFetchMock>) =>
  renderWithProviders(<ProgressPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/progress" });

describe("ProgressPage", () => {
  it("shows the numbers for the last 7 days and switches the period", async () => {
    const mock = createFetchMock({ "GET /api/stats": (call) => json(stats(Number(call.url.searchParams.get("days")))) });
    page(mock);
    expect(await screen.findByTestId("progress-active-days")).toHaveTextContent("1");
    expect(screen.getByTestId("progress-streak")).toHaveTextContent("1");
    expect(screen.getByTestId("progress-messages")).toHaveTextContent("3");
    expect(screen.getByTestId("progress-speaking")).toHaveTextContent("2"); // 95 秒 ≈ 2 分钟
    expect(screen.getByTestId("progress-avg")).toHaveTextContent("81.5");
    expect(screen.getByTestId("progress-chart")).toHaveAttribute("data-points", "1");
    expect(screen.getByTestId("progress-category")).toHaveTextContent("2");
    expect(screen.getByTestId("progress-word")).toHaveTextContent("think");
    expect(screen.getByTestId("progress-disclaimer")).toBeInTheDocument();
    expect(screen.getByTestId("progress-days-7")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("progress-days-30"));
    await waitFor(() => expect(mock.calls.at(-1)!.url.searchParams.get("days")).toBe("30"));
    await waitFor(() => expect(screen.getByTestId("progress-days-30")).toHaveAttribute("aria-pressed", "true"));
  });

  it("shows an empty state when nothing was practiced", async () => {
    const mock = createFetchMock({ "GET /api/stats": () => json(stats(7, { daily: days(7).map((d) => ({ ...d, active: false, user_messages: 0, assessments: 0, speaking_seconds: 0, avg_pronunciation: null as number | null })), active_days: 0, streak_days: 0, user_messages: 0, assessments: 0, speaking_seconds: 0, avg_pronunciation: null, grammar_top: [], poor_words: [] })) });
    page(mock);
    expect(await screen.findByTestId("progress-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("progress-chart")).toBeNull();
  });

  it("shows a translated error with retry, and the truncation note", async () => {
    let fail = true;
    const mock = createFetchMock({ "GET /api/stats": () => (fail ? json({ error: "Too many requests, please try again later" }, 429) : json(stats(7, { truncated: true }))) });
    page(mock);
    expect(await screen.findByTestId("progress-error")).toHaveTextContent("Too many requests");
    fail = false;
    await userEvent.click(screen.getByTestId("progress-retry"));
    expect(await screen.findByTestId("progress-truncated")).toBeInTheDocument();
  });

  it("practices and saves a word", async () => {
    const mock = createFetchMock({
      "GET /api/stats": () => json(stats(7)),
      "POST /api/practice-items": () => json({ id: "p", text: "think", source: "chat", created_at: "2026-10-05T00:00:00+00:00" }),
    });
    page(mock);
    await userEvent.click(await screen.findByTestId("progress-word-save"));
    await waitFor(() => expect(JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string)).toEqual({ text: "think", source: "chat" }));
    await userEvent.click(screen.getByTestId("progress-word-practice"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("ignores a late response for a period the user already left", async () => {
    let release7: () => void = () => {};
    const mock = createFetchMock({
      "GET /api/stats": (call) => {
        const n = Number(call.url.searchParams.get("days"));
        if (n === 7) return new Promise<Response>((resolve) => { release7 = () => resolve(json(stats(7, { active_days: 7 }))); });
        return json(stats(n, { active_days: 30 }));
      },
    });
    page(mock);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(mock.calls[0].signal).toBeTruthy();
    await userEvent.click(screen.getByTestId("progress-days-30"));
    expect(await screen.findByTestId("progress-active-days")).toHaveTextContent("30");
    expect(mock.calls[0].signal!.aborted).toBe(true);
    release7();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("progress-active-days")).toHaveTextContent("30");
    expect(screen.getByTestId("progress-days-30")).toHaveAttribute("aria-pressed", "true");
  });

  it("translates 422 and network errors instead of showing raw text", async () => {
    let mode: "422" | "network" = "422";
    const mock = createFetchMock({
      "GET /api/stats": () => {
        if (mode === "network") throw new TypeError("Failed to fetch");
        return json({ error: "Invalid days" }, 422);
      },
    });
    page(mock);
    expect(await screen.findByTestId("progress-error")).toHaveTextContent("Something went wrong.");
    mode = "network";
    await userEvent.click(screen.getByTestId("progress-retry"));
    await waitFor(() => expect(screen.getByTestId("progress-error")).toHaveTextContent("Network error"));
  });

  it("shows the server's today and a text alternative for the chart", async () => {
    const mock = createFetchMock({ "GET /api/stats": () => json(stats(7)) });
    page(mock);
    expect(await screen.findByTestId("progress-today")).toHaveTextContent("2026-10-05");
    const items = screen.getAllByTestId("progress-chart-day");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("2026-09-07");
    expect(items[0]).toHaveTextContent("81.5");
    expect(screen.getByTestId("progress-chart").querySelector("desc")).toHaveTextContent("1");
  });

  it("explains a missing chart when there was activity but no scored recordings", async () => {
    const mock = createFetchMock({ "GET /api/stats": () => json(stats(7, { daily: days(7).map((d) => ({ ...d, avg_pronunciation: null as number | null })), avg_pronunciation: null, assessments: 0 })) });
    page(mock);
    expect(await screen.findByTestId("progress-no-scores")).toBeInTheDocument();
    expect(screen.queryByTestId("progress-chart")).toBeNull();
    expect(screen.getByTestId("progress-avg")).toHaveTextContent("—");
  });

  it("does not offer a vocabulary button yet", async () => {
    const mock = createFetchMock({ "GET /api/stats": () => json(stats(7)) });
    page(mock);
    await screen.findByTestId("progress-word");
    expect(screen.queryByTestId("progress-word-vocab")).toBeNull();
    for (const b of screen.getAllByRole("button")) expect(b).toBeEnabled();
  });
});
