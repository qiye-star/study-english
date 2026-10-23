import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByTestId("location")).toHaveTextContent("/practice/shadow");
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual({ reference: "Nice to meet you." });
  });

  it("labels sentences saved from the shadowing library", async () => {
    setup({ "GET /api/practice-items": () => json({ practice_items: [item("p1", "From a video.", "library")], page: 1, next: null }) });
    expect(await screen.findByTestId("practice-item")).toHaveTextContent("Shadowing library");
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
    // 服务端说它已经不在了,所以列表里也去掉它
    await waitFor(() => expect(screen.queryByTestId("practice-item")).toBeNull());
  });

  it("keeps the item and shows a generic error when delete fails otherwise", async () => {
    setup({
      "GET /api/practice-items": () => json({ practice_items: [item("p1", "One.")], page: 1, next: null }),
      "DELETE /api/practice-items/p1": () => json({ error: "boom" }, 500),
    });
    await userEvent.click(await screen.findByTestId("practice-item-delete"));
    await userEvent.click(await screen.findByTestId("practice-item-delete-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
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

  it("renders the list without an error under StrictMode", async () => {
    // 与真实 fetch 一致:收到 abort 信号时请求以 AbortError 失败
    const mock = createFetchMock({
      "GET /api/practice-items": (call) => new Promise<Response>((resolve, reject) => {
        const body = json({ practice_items: [item("p1", "One.")], page: 1, next: null });
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (call.signal?.aborted) return abort();
        call.signal?.addEventListener("abort", abort);
        setTimeout(() => resolve(body), 5);
      }),
    });
    renderWithProviders(<StrictMode><PracticeListPage /></StrictMode>, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/list",
    });
    expect(await screen.findAllByTestId("practice-item")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("practice-list-retry")).toBeNull();
    expect(mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("aborts and stays silent when unmounted mid-request", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let release: (r: Response) => void = () => {};
    const { mock, view } = setup({
      "GET /api/practice-items": () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    view.unmount();
    expect(mock.calls[0].signal?.aborted).toBe(true);
    await act(async () => { release(json({ practice_items: [item("p1", "One.")], page: 1, next: null })); });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
