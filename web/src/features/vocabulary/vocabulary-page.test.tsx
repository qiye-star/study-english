import { StrictMode } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { VocabularyPage } from "./vocabulary-page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));
beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

const item = (id: string, word: string, extra = {}) => ({
  id, word, meaning: `${word} 的意思`, example: `I like ${word}.`, source: "lookup", box: 0,
  due_at: "2026-10-01T00:00:00+00:00", reps: 0, lapses: 0, last_reviewed_at: null as string | null, created_at: "2026-10-01T00:00:00+00:00", ...extra,
});
const AI_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
function setup(routes: Record<string, Handler>, strict = false) {
  const mock = createFetchMock({ ...AI_ROUTES, ...routes });
  const ui = strict ? <StrictMode><VocabularyPage /></StrictMode> : <VocabularyPage />;
  const view = renderWithProviders(ui, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/vocabulary" });
  return Object.assign(mock, { view });
}
const listCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.method === "GET" && c.url.pathname === "/api/vocabulary");
const reviewCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname.endsWith("/review"));

describe("VocabularyPage", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("shows the due count and the list; empty states", async () => {
    const mock = setup({ "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }) });
    expect(await screen.findByTestId("vocab-due-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("vocab-item")).toHaveLength(2);
    expect(listCalls(mock)[0].url.searchParams.get("due")).toBeNull();
  });

  it("shows empty states", async () => {
    setup({ "GET /api/vocabulary": () => json({ vocabulary_items: [], page: 1, next: null, due_count: 0 }) });
    expect(await screen.findByTestId("vocab-empty")).toBeInTheDocument();
    expect(screen.getByTestId("vocab-start-review")).toBeDisabled();
  });

  it("reviews up to 20 due cards: flip, grade, finish and refresh", async () => {
    const mock = setup({
      "GET /api/vocabulary": (call) => json(call.url.searchParams.get("due")
        ? { vocabulary_items: [item("v1", "apple"), item("v2", "pear", { meaning: "", example: null })], page: 1, next: null, due_count: 2 }
        : { vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "POST /api/vocabulary/v1/review": () => json(item("v1", "apple", { box: 1 })),
      "POST /api/vocabulary/v2/review": () => json(item("v2", "pear")),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    const due = listCalls(mock).find((c) => c.url.searchParams.get("due") === "true")!;
    expect(due.url.searchParams.get("per_page")).toBe("20");
    expect(await screen.findByTestId("vocab-card-word")).toHaveTextContent("apple");
    expect(screen.getByTestId("vocab-review-progress")).toHaveTextContent("1 / 2");
    expect(screen.queryByTestId("vocab-grade-good")).toBeNull(); // 翻面之前不能评分
    await userEvent.click(screen.getByTestId("vocab-card-flip"));
    expect(screen.getByTestId("vocab-card-meaning")).toHaveTextContent("apple 的意思");
    expect(screen.getByTestId("vocab-card-example")).toHaveTextContent("I like apple.");
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    expect(await screen.findByTestId("vocab-review-progress")).toHaveTextContent("2 / 2");
    expect(JSON.parse(reviewCalls(mock)[0].body as string)).toEqual({ grade: "good" });
    await userEvent.click(screen.getByTestId("vocab-card-flip"));
    expect(screen.getByTestId("vocab-card-meaning")).toHaveTextContent("No meaning saved.");
    expect(screen.queryByTestId("vocab-card-example")).toBeNull();
    await userEvent.click(screen.getByTestId("vocab-grade-forgot"));
    expect(await screen.findByTestId("vocab-review-done")).toBeInTheDocument();
    await waitFor(() => expect(listCalls(mock).filter((c) => !c.url.searchParams.get("due"))).toHaveLength(2)); // 复习结束后刷新
    await userEvent.click(screen.getByTestId("vocab-review-close"));
    expect(screen.getAllByTestId("vocab-item")).toHaveLength(2);
  });

  it("treats 409 (already reviewed elsewhere) as done and moves on; other errors keep the card", async () => {
    let status = 500;
    const mock = setup({
      "GET /api/vocabulary": (call) => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: call.url.searchParams.get("due") ? 2 : 2 }),
      "POST /api/vocabulary/v1/review": () => json({ error: status === 409 ? "Vocabulary item is not due" : "boom" }, status),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-hard"));
    expect(await screen.findByTestId("vocab-error")).toHaveTextContent("Something went wrong.");
    expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("apple");
    status = 409;
    await userEvent.click(screen.getByTestId("vocab-grade-hard"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("pear"));
    expect(screen.queryByTestId("vocab-error")).toBeNull();
    expect(reviewCalls(mock)).toHaveLength(2);
  });

  it("reads the word aloud with the server default voice", async () => {
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 }),
      "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-speak")).toBeEnabled());
    await userEvent.click(screen.getByTestId("vocab-card-speak"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body as string)).toEqual({ input: "apple", model: "openai/tts-1", voice: "alloy" });
  });

  it("deletes a word after confirmation", async () => {
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "DELETE /api/vocabulary/v1": () => json({ id: "v1" }),
    });
    await userEvent.click((await screen.findAllByTestId("vocab-item-delete"))[0]);
    await userEvent.click(await screen.findByTestId("vocab-item-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("vocab-item")).toHaveLength(1));
    expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("1");
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true);
  });

  it("loads the list once under StrictMode", async () => {
    const mock = setup({ "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 }) }, true);
    expect(await screen.findAllByTestId("vocab-item")).toHaveLength(1);
    expect(listCalls(mock).filter((c) => !c.signal?.aborted)).toHaveLength(1);
  });

  it("refetches the due list after a 409 so the session continues with what is still due", async () => {
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear"), item("v3", "plum")], page: 1, next: null, due_count: 3 }),
      "POST /api/vocabulary/v1/review": () => json({ error: "Vocabulary item was already reviewed" }, 409),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("pear"));
    expect(listCalls(mock).filter((c) => c.url.searchParams.get("due") === "true")).toHaveLength(2);
    expect(screen.getByTestId("vocab-review-progress")).toHaveTextContent("2 / 3");
    expect(screen.queryByTestId("vocab-error")).toBeNull();
  });

  it("skips a card that was deleted elsewhere (404)", async () => {
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "POST /api/vocabulary/v1/review": () => json({ error: "Vocabulary item not found" }, 404),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("pear"));
    expect(screen.queryByTestId("vocab-error")).toBeNull();
    expect(reviewCalls(mock)).toHaveLength(1);
  });

  it("sends one review for a double tap on a grade button", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "POST /api/vocabulary/v1/review": async () => { await gate; return json(item("v1", "apple", { box: 1 })); },
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.dblClick(screen.getByTestId("vocab-grade-good"));
    expect(screen.getByTestId("vocab-grade-good")).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("pear"));
    expect(reviewCalls(mock)).toHaveLength(1);
    expect(screen.getByTestId("vocab-review-progress")).toHaveTextContent("2 / 2");
  });

  it("labels the read-aloud and flip controls", async () => {
    setup({ "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 }) });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    expect(await screen.findByRole("button", { name: "Read aloud" })).toBe(screen.getByTestId("vocab-card-speak"));
    expect(screen.getByRole("button", { name: "Show meaning" })).toBe(screen.getByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-card-flip"));
    expect(screen.getByRole("button", { name: "Forgot" })).toBe(screen.getByTestId("vocab-grade-forgot"));
  });

  it("deletes optimistically and rolls back when the server fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "DELETE /api/vocabulary/v1": async () => { await gate; return json({ error: "boom" }, 500); },
    });
    await userEvent.click((await screen.findAllByTestId("vocab-item-delete"))[0]);
    await userEvent.click(await screen.findByTestId("vocab-item-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("vocab-item")).toHaveLength(1));
    expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("1");
    release();
    expect(await screen.findByTestId("vocab-error")).toHaveTextContent("Something went wrong.");
    expect(screen.getAllByTestId("vocab-item").map((li) => li.textContent)).toEqual([expect.stringContaining("apple"), expect.stringContaining("pear")]);
    expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("2");
  });

  it("loads more words with next and shows the nothing-due state", async () => {
    const mock = setup({
      "GET /api/vocabulary": (call) => json(call.url.searchParams.get("page") === "2"
        ? { vocabulary_items: [item("v2", "pear", { due_at: "2099-01-01T00:00:00+00:00" })], page: 2, next: null, due_count: 0 }
        : { vocabulary_items: [item("v1", "apple", { due_at: "2099-01-01T00:00:00+00:00" })], page: 1, next: 2, due_count: 0 }),
    });
    expect(await screen.findByTestId("vocab-none-due")).toBeInTheDocument();
    expect(screen.getByTestId("vocab-start-review")).toBeDisabled();
    await userEvent.click(screen.getByTestId("vocab-list-more"));
    await waitFor(() => expect(screen.getAllByTestId("vocab-item")).toHaveLength(2));
    expect(screen.queryByTestId("vocab-list-more")).toBeNull();
    expect(listCalls(mock).map((c) => c.url.searchParams.get("page"))).toEqual(["1", "2"]);
  });

  it("aborts in-flight requests on unmount", async () => {
    const mock = setup({ "GET /api/vocabulary": () => new Promise<Response>(() => undefined) });
    await waitFor(() => expect(listCalls(mock)).toHaveLength(1));
    mock.view.unmount();
    expect(listCalls(mock)[0].signal?.aborted).toBe(true);
  });

  it("moves focus through the session and announces progress", async () => {
    setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: 2 }),
      "POST /api/vocabulary/v1/review": () => json(item("v1", "apple")),
      "POST /api/vocabulary/v2/review": () => json(item("v2", "pear")),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-flip")).toHaveFocus());
    expect(screen.getByTestId("vocab-review-progress")).toHaveAttribute("aria-live", "polite");
    await userEvent.click(screen.getByTestId("vocab-card-flip"));
    expect(screen.getByTestId("vocab-card-meaning")).toHaveFocus();
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await waitFor(() => expect(screen.getByTestId("vocab-card-word")).toHaveTextContent("pear"));
    expect(screen.getByTestId("vocab-card-flip")).toHaveFocus();
    await userEvent.click(screen.getByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await waitFor(() => expect(screen.getByTestId("vocab-review-close")).toHaveFocus());
    await userEvent.click(screen.getByTestId("vocab-review-close"));
    expect(screen.getByTestId("vocab-due-count")).toHaveFocus();
  });

  it("does not update or refresh after unmount when a grade succeeds late", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = setup({
      "GET /api/vocabulary": () => json({ vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 }),
      "POST /api/vocabulary/v1/review": async () => { await gate; return json(item("v1", "apple")); },
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await waitFor(() => expect(reviewCalls(mock)).toHaveLength(1));
    const before = listCalls(mock).length;
    mock.view.unmount();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(listCalls(mock)).toHaveLength(before);
  });

  it("does not over-count the due number when a delete rolls back after a refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let reviewed = false;
    setup({
      "GET /api/vocabulary": (call) => json(call.url.searchParams.get("due")
        ? { vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 2 }
        : { vocabulary_items: [item("v1", "apple"), item("v2", "pear")], page: 1, next: null, due_count: reviewed ? 1 : 2 }),
      "POST /api/vocabulary/v1/review": () => { reviewed = true; return json(item("v1", "apple")); },
      "DELETE /api/vocabulary/v2": async () => { await gate; return json({ error: "boom" }, 500); },
    });
    await userEvent.click((await screen.findAllByTestId("vocab-item-delete"))[1]);
    await userEvent.click(await screen.findByTestId("vocab-item-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("1"));
    await userEvent.click(screen.getByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await userEvent.click(await screen.findByTestId("vocab-review-close"));
    await waitFor(() => expect(screen.getAllByTestId("vocab-item")).toHaveLength(2)); // 刷新带回了 pear
    release();
    expect(await screen.findByTestId("vocab-error")).toBeInTheDocument();
    expect(screen.getAllByTestId("vocab-item")).toHaveLength(2);
    expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("1");
  });

  it("queues the post-review refresh while a load-more is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = setup({
      "GET /api/vocabulary": async (call) => {
        if (call.url.searchParams.get("due")) return json({ vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 });
        if (call.url.searchParams.get("page") === "2") { await gate; return json({ vocabulary_items: [item("v2", "pear")], page: 2, next: null, due_count: 1 }); }
        return json({ vocabulary_items: [item("v1", "apple")], page: 1, next: 2, due_count: 1 });
      },
      "POST /api/vocabulary/v1/review": () => json(item("v1", "apple")),
    });
    await userEvent.click(await screen.findByTestId("vocab-list-more"));
    await userEvent.click(screen.getByTestId("vocab-start-review"));
    await userEvent.click(await screen.findByTestId("vocab-card-flip"));
    await userEvent.click(screen.getByTestId("vocab-grade-good"));
    await screen.findByTestId("vocab-review-done");
    release();
    const pages = () => listCalls(mock).filter((c) => !c.url.searchParams.get("due")).map((c) => c.url.searchParams.get("page"));
    await waitFor(() => expect(pages()).toEqual(["1", "2", "1"]));
  });

  it("shows the nothing-due state when the due list comes back empty", async () => {
    setup({
      "GET /api/vocabulary": (call) => json(call.url.searchParams.get("due")
        ? { vocabulary_items: [], page: 1, next: null, due_count: 0 }
        : { vocabulary_items: [item("v1", "apple")], page: 1, next: null, due_count: 1 }),
    });
    await userEvent.click(await screen.findByTestId("vocab-start-review"));
    expect(await screen.findByTestId("vocab-none-due")).toHaveTextContent("Nothing to review right now.");
    expect(screen.getByTestId("vocab-due-count")).toHaveTextContent("0");
    expect(screen.getByTestId("vocab-start-review")).toBeDisabled();
    expect(screen.getByTestId("vocab-due-count")).toHaveFocus();
  });
});
