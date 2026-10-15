import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { HistoryPage } from "./history-page";

const item = (id: string, text: string) => ({
  id, reference_text: text, language: "en-US", duration_ms: 1000, created_at: "2026-10-04T00:00:00+00:00",
  scores: { pronunciation_score: 75, accuracy_score: 70, fluency_score: 80, completeness_score: 90 },
});

describe("HistoryPage", () => {
  afterEach(() => setLiquid(false));

  it("liquid: score in ink with a dot (plan 2026-10-15-liquid-glass R-L4-4)", async () => {
    setLiquid(true);
    const mock = createFetchMock({
      "GET /api/assessments": () => json({ assessments: [item("a1", "First")], page: 1, next: null }),
    });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/history" });
    const row = (await screen.findAllByTestId("assessment-item"))[0];
    expect(row.querySelector(".num")!.className).toContain("liquid:text-ink");
    expect(row.querySelector("[data-score-dot]")!.className).toContain("bg-amber");
  });

  it("lists records and loads more", async () => {
    const mock = createFetchMock({
      "GET /api/assessments": (call) =>
        call.url.searchParams.get("page") === "2"
          ? json({ assessments: [item("a3", "Third")], page: 2, next: null })
          : json({ assessments: [item("a1", "First"), item("a2", "Second")], page: 1, next: 2 }),
    });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/history" });
    expect(await screen.findAllByTestId("assessment-item")).toHaveLength(2);
    expect(screen.getAllByTestId("assessment-item")[0]).toHaveAttribute("href", "/practice/assessments/a1");
    await userEvent.click(screen.getByTestId("history-load-more"));
    expect(await screen.findByText("Third")).toBeInTheDocument();
    expect(screen.queryByTestId("history-load-more")).toBeNull();
  });

  it("shows the empty state", async () => {
    const mock = createFetchMock({ "GET /api/assessments": () => json({ assessments: [], page: 1, next: null }) });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("history-empty")).toHaveTextContent("No practice yet.");
  });

  it("shows an error with an explicit retry button when the first load fails", async () => {
    let fail = true;
    const mock = createFetchMock({ "GET /api/assessments": () => (fail ? json({ error: "Network error" }, 500) : json({ assessments: [item("a1", "First")], page: 1, next: null })) });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error. Check your connection.");
    expect(screen.queryByTestId("history-load-more")).toBeNull();
    expect(screen.queryByTestId("history-empty")).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("assessment-item")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("de-duplicates by id, ignores double taps and survives a language change", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({
      "GET /api/assessments": async (call) => {
        if (call.url.searchParams.get("page") === "2") {
          await gate;
          return json({ assessments: [item("a2", "Second"), item("a3", "Third")], page: 2, next: null });
        }
        return json({ assessments: [item("a1", "First"), item("a2", "Second")], page: 1, next: 2 });
      },
    });
    renderWithProviders(<HistoryPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await screen.findAllByTestId("assessment-item");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    await act(async () => { await i18n.changeLanguage("en"); });
    expect(mock.calls.filter((c) => c.url.searchParams.get("page") === "1")).toHaveLength(1);
    await userEvent.dblClick(screen.getByTestId("history-load-more"));
    release();
    await waitFor(() => expect(screen.getAllByTestId("assessment-item")).toHaveLength(3));
    expect(mock.calls.filter((c) => c.url.searchParams.get("page") === "2")).toHaveLength(1);
  });
});
