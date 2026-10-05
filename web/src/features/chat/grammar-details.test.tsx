import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { GrammarDetails } from "./grammar-details";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const RESULT = {
  hasErrors: true,
  corrected: "She doesn't like coffee.",
  errors: [{ original: "don't", corrected: "doesn't", category: "agreement" as const, explanation: "x" }],
};

function setup(save: Handler) {
  const mock = createFetchMock({ "POST /api/practice-items": save });
  const view = renderWithProviders(<GrammarDetails result={RESULT} onClose={vi.fn()} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, view };
}

describe("GrammarDetails save button", () => {
  it("guards double taps: one request, disabled while saving, enabled again after", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = setup(async () => { await gate; return json({ id: "p1", text: "x", source: "grammar", created_at: "t" }); });
    const button = screen.getByTestId("grammar-save");
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("a tap during an in-flight save does nothing and a failed save re-enables the button", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const { mock } = setup(async () => { await gate; return ++n === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ id: "p1", text: "x", source: "grammar", created_at: "t" }); });
    const button = screen.getByTestId("grammar-save");
    await userEvent.click(button);
    await userEvent.click(button);
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    release();
    await waitFor(() => expect(button).not.toBeDisabled());
    await userEvent.click(button);
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(2));
  });

  it("does not warn when unmounted mid-save", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { view, mock } = setup(async () => { await gate; return json({ id: "p1", text: "x", source: "grammar", created_at: "t" }); });
    await userEvent.click(screen.getByTestId("grammar-save"));
    view.unmount();
    release();
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
