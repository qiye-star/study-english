import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AddVocabularyButton } from "./add-vocabulary-button";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const render = (mock: ReturnType<typeof createFetchMock>, label?: string) =>
  renderWithProviders(<AddVocabularyButton testId="vb" input={{ word: "think", source: "progress" }} label={label} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
const posts = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/vocabulary");

describe("AddVocabularyButton", () => {
  beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear(); });

  it("sends once on a double tap, then shows the in-vocabulary state", async () => {
    let release: () => void = () => {};
    const mock = createFetchMock({ "POST /api/vocabulary": () => new Promise<Response>((r) => { release = () => r(json({ id: "v1" })); }) });
    render(mock, "Add to vocabulary: think");
    const button = screen.getByTestId("vb");
    expect(button).toHaveAccessibleName("Add to vocabulary: think");
    expect(button).toHaveClass("h-11", "min-w-11");
    await userEvent.dblClick(button);
    expect(posts(mock)).toHaveLength(1);
    expect(button).toBeDisabled();
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    await waitFor(() => expect(button).toHaveAttribute("data-state", "saved"));
    expect(button).toHaveAccessibleName("In your vocabulary: think");
    expect(toast.success).toHaveBeenCalledWith("Added to your vocabulary.");
    await userEvent.click(button);
    expect(posts(mock)).toHaveLength(1);
  });

  it("says the word is already there when the server returns an existing item", async () => {
    const mock = createFetchMock({ "POST /api/vocabulary": () => json({ id: "old", word: "think", reps: 2, created_at: "2026-01-01T00:00:00+00:00" }) });
    render(mock);
    await userEvent.click(screen.getByTestId("vb"));
    await waitFor(() => expect(screen.getByTestId("vb")).toHaveAttribute("data-state", "saved"));
    expect(toast.success).toHaveBeenCalledWith("Already in your vocabulary.");
  });

  it("shows the translated limit error and stays available to retry", async () => {
    const mock = createFetchMock({ "POST /api/vocabulary": () => json({ error: "Vocabulary limit reached" }, 429) });
    render(mock);
    await userEvent.click(screen.getByTestId("vb"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Your vocabulary is full. Delete some words first."));
    await waitFor(() => expect(screen.getByTestId("vb")).toBeEnabled());
    expect(screen.getByTestId("vb")).toHaveAttribute("data-state", "idle");
  });
});
