import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { HistoryPage } from "./history-page";

const item = (id: string, text: string) => ({
  id, reference_text: text, language: "en-US", duration_ms: 1000, created_at: "2026-10-04T00:00:00+00:00",
  scores: { pronunciation_score: 75, accuracy_score: 70, fluency_score: 80, completeness_score: 90 },
});

describe("HistoryPage", () => {
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
});
