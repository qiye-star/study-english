import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import raw from "~/test/fixtures/assessment-good.json";
import { renderWithProviders } from "~/test/render";
import { AssessmentPage } from "./assessment-page";

const REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please.";
const DETAIL = {
  id: "a1", reference_text: REFERENCE, language: "en-US", duration_ms: 3000, created_at: "2026-10-04T00:00:00+00:00",
  scores: { pronunciation_score: raw.pronunciation_score, accuracy_score: raw.accuracy_score, fluency_score: raw.fluency_score, completeness_score: raw.completeness_score },
  result: raw,
};

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:audio-1"), revokeObjectURL: vi.fn() });
  // jsdom does not implement media playback; word-result unmount calls pause().
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  renderWithProviders(<AssessmentPage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: "/practice/assessments/a1",
    path: "/practice/assessments/:id",
  });
  return mock;
}

describe("AssessmentPage", () => {
  it("shows scores, words and the authenticated recording", async () => {
    const mock = setup({
      "GET /api/assessments/a1": () => json(DETAIL),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/wav" } }),
    });
    expect(await screen.findByTestId("assessment-reference")).toHaveTextContent(REFERENCE);
    expect(screen.getByTestId("assessment-reference")).toHaveAttribute("data-lookup-context");
    expect(screen.getByTestId("assessment-scores")).toHaveTextContent(String(raw.pronunciation_score));
    expect(screen.getByTestId("assessment-words")).toHaveTextContent(/coffee/i);
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const audioCall = mock.calls.find((c) => c.url.pathname.endsWith("/audio"))!;
    expect(audioCall.headers.get("Authorization")).toBe("Bearer t");
  });

  it("deletes after confirmation", async () => {
    const mock = setup({
      "GET /api/assessments/a1": () => json(DETAIL),
      "GET /api/assessments/a1/audio": () => new Response(new Uint8Array([1])),
      "DELETE /api/assessments/a1": () => json({ id: "a1" }),
    });
    await userEvent.click(await screen.findByTestId("assessment-delete"));
    await userEvent.click(await screen.findByTestId("assessment-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice/history"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("handles missing records and audio", async () => {
    setup({
      "GET /api/assessments/a1": () => json({ error: "Assessment not found" }, 404),
      "GET /api/assessments/a1/audio": () => json({ error: "Assessment not found" }, 404),
    });
    expect(await screen.findByText("This recording does not exist.")).toBeInTheDocument();
  });

  it("practice again carries the reference text", async () => {
    setup({ "GET /api/assessments/a1": () => json(DETAIL), "GET /api/assessments/a1/audio": () => json({ error: "Recording not found" }, 404) });
    expect(await screen.findByText("The recording is unavailable.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("assessment-again"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
  });
});
