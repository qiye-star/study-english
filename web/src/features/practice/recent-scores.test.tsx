import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { RecentScores } from "./recent-scores";

const item = (id: string, score: number | null, createdAt: string) => ({
  id, reference_text: "Hi", language: "en-US", duration_ms: 1000, created_at: createdAt,
  scores: score === null ? {} : { pronunciation_score: score },
});

describe("RecentScores (plan 2026-10-15-liquid-glass L4)", () => {
  afterEach(() => setLiquid(false));

  it("shows up to three wells with ink numbers and score dots, linking to each result", async () => {
    setLiquid(true);
    const mock = createFetchMock({
      "GET /api/assessments": () => json({ assessments: [item("a", 92, "2026-10-15T08:00:00Z"), item("b", 78, "2026-10-14T08:00:00Z"), item("c", 64, "2026-10-13T08:00:00Z")], next: null }),
    });
    renderWithProviders(<RecentScores />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const wells = await screen.findAllByTestId("recent-score");
    expect(wells).toHaveLength(3);
    expect(wells[0]).toHaveAttribute("href", "/practice/assessments/a");
    expect(wells[0].textContent).toContain("92");
    expect(wells[0].querySelector("[data-score-dot]")!.className).toContain("bg-green");
    expect(wells[2].querySelector("[data-score-dot]")).toBeNull();
    expect(mock.calls[0].url.searchParams.get("per_page")).toBe("3");
  });

  it("renders nothing when there are no results or the request fails", async () => {
    setLiquid(true);
    const mock = createFetchMock({ "GET /api/assessments": () => json({ assessments: [], next: null }) });
    const { container } = renderWithProviders(<RecentScores />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(container.querySelector("[data-testid=recent-score]")).toBeNull();
  });
});
