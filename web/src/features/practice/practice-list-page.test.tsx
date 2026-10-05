import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PracticeListPage } from "./practice-list-page";

const item = (id: string, text: string, source = "chat") => ({ id, text, source, created_at: "2026-10-05T00:00:00+00:00" });

function StateProbe() {
  return <pre data-testid="state">{JSON.stringify(useLocation().state)}</pre>;
}

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<><PracticeListPage /><StateProbe /></>, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/list",
  });
  return { mock, view };
}

describe("PracticeListPage", () => {
  it("lists saved sentences and opens one for practice", async () => {
    setup({ "GET /api/practice-items": () => json({ practice_items: [item("p1", "Nice to meet you."), item("p2", "Fine.", "lookup")], page: 1, next: null }) });
    expect(await screen.findAllByTestId("practice-item")).toHaveLength(2);
    expect(screen.getAllByTestId("practice-item")[1]).toHaveTextContent("Dictionary");
    await userEvent.click(screen.getAllByTestId("practice-item")[0]);
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual({ reference: "Nice to meet you." });
  });

  it("deletes an item after confirmation", async () => {
    const { mock } = setup({
      "GET /api/practice-items": () => json({ practice_items: [item("p1", "One.")], page: 1, next: null }),
      "DELETE /api/practice-items/p1": () => json({ id: "p1" }),
    });
    await userEvent.click(await screen.findByTestId("practice-item-delete"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(await screen.findByTestId("practice-item-delete-confirm"));
    await waitFor(() => expect(screen.queryByTestId("practice-item")).toBeNull());
    expect(mock.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(screen.getByTestId("practice-list-empty")).toBeInTheDocument();
  });

  it("shows a translated error when delete fails and keeps the item", async () => {
    setup({
      "GET /api/practice-items": () => json({ practice_items: [item("p1", "One.")], page: 1, next: null }),
      "DELETE /api/practice-items/p1": () => json({ error: "Practice item not found" }, 404),
    });
    await userEvent.click(await screen.findByTestId("practice-item-delete"));
    await userEvent.click(await screen.findByTestId("practice-item-delete-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This sentence is no longer in your list.");
    expect(screen.getByTestId("practice-item")).toBeInTheDocument();
  });

  it("loads more and retries a failed first load", async () => {
    let fail = true;
    setup({
      "GET /api/practice-items": (call) => {
        if (fail) return json({ error: "boom" }, 500);
        return call.url.searchParams.get("page") === "2"
          ? json({ practice_items: [item("p3", "Three.")], page: 2, next: null })
          : json({ practice_items: [item("p1", "One.")], page: 1, next: 2 });
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    fail = false;
    await userEvent.click(screen.getByTestId("practice-list-retry"));
    expect(await screen.findAllByTestId("practice-item")).toHaveLength(1);
    await userEvent.click(screen.getByTestId("practice-list-more"));
    expect(await screen.findByText("Three.")).toBeInTheDocument();
  });

  it("does not duplicate rows when a later page repeats an id", async () => {
    setup({
      "GET /api/practice-items": (call) => call.url.searchParams.get("page") === "2"
        ? json({ practice_items: [item("p1", "One."), item("p2", "Two.")], page: 2, next: null })
        : json({ practice_items: [item("p1", "One.")], page: 1, next: 2 }),
    });
    await userEvent.click(await screen.findByTestId("practice-list-more"));
    await waitFor(() => expect(screen.getAllByTestId("practice-item")).toHaveLength(2));
  });

  it("does not update state or throw after unmount", async () => {
    const { view } = setup({ "GET /api/practice-items": () => json({ practice_items: [], page: 1, next: null }) });
    view.unmount();
  });
});
