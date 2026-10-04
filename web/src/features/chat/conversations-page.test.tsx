import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "~/i18n";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationsPage } from "./conversations-page";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const CONFIG_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const conv = (id: string, name: string) => ({ id, name, config: {}, created_at: "2026-10-04T00:00:00+00:00", updated_at: "2026-10-04T00:00:00+00:00" });

describe("ConversationsPage", () => {
  beforeEach(() => { resetServerAiConfigCache(); vi.mocked(toast.error).mockClear(); });

  it("creates a conversation with server defaults and opens it", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "New conversation")),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    expect(await screen.findByTestId("conversations-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-new"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    const body = JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string);
    expect(body.config).toMatchObject({ model: "gpt-4o", tts_model: "openai/tts-1", tts_voice: "alloy", temperature: 0.7 });
  });

  it("lists and deletes conversations", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [conv("c1", "Trip"), conv("c2", "New conversation")], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => json({ id: "c1" }),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    const items = await screen.findAllByTestId("conversation-item");
    expect(items[0]).toHaveTextContent("Trip");
    expect(items[1]).toHaveTextContent("Untitled conversation");
    await userEvent.click(screen.getAllByTestId("conversation-delete")[0]);
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("conversation-item")).toHaveLength(1));
  });

  const page = (mock: ReturnType<typeof createFetchMock>) =>
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });

  it("shows a loading state before the first page arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({ "GET /api/conversations": async () => { await gate; return json({ conversations: [conv("c1", "Trip")], page: 1, next: null }); } });
    page(mock);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    release();
    expect(await screen.findByTestId("conversation-item")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("appends the next page, ignores double taps on load more and de-duplicates by id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({
      "GET /api/conversations": async (call) => {
        if (call.url.searchParams.get("page") === "2") {
          await gate;
          return json({ conversations: [conv("c2", "Second"), conv("c3", "Third")], page: 2, next: null });
        }
        return json({ conversations: [conv("c1", "First"), conv("c2", "Second")], page: 1, next: 2 });
      },
    });
    page(mock);
    await screen.findAllByTestId("conversation-item");
    const more = screen.getByRole("button", { name: "Load more" });
    await userEvent.dblClick(more);
    release();
    await waitFor(() => expect(screen.getAllByTestId("conversation-item")).toHaveLength(3));
    expect(mock.calls.filter((c) => c.url.searchParams.get("page") === "2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows a retry button when the first load fails and recovers", async () => {
    let fail = true;
    const mock = createFetchMock({ "GET /api/conversations": () => (fail ? json({ error: "Upstream unavailable" }, 502) : json({ conversations: [conv("c1", "Trip")], page: 1, next: null })) });
    page(mock);
    expect(await screen.findByRole("alert")).toHaveTextContent("The AI service is unavailable");
    expect(screen.queryByTestId("conversations-empty")).toBeNull();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("conversation-item")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the loaded pages when the language changes", async () => {
    const mock = createFetchMock({ "GET /api/conversations": () => json({ conversations: [conv("c1", "Trip")], page: 1, next: null }) });
    page(mock);
    await screen.findByTestId("conversation-item");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(mock.calls.filter((c) => c.method === "GET" && c.url.pathname === "/api/conversations")).toHaveLength(1);
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("reports a failed delete, then clears the error when the next action starts", async () => {
    let failDelete = true;
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [conv("c1", "Trip")], page: 1, next: null }),
      "DELETE /api/conversations/c1": () => (failDelete ? json({ error: "Conversation not found" }, 404) : json({ id: "c1" })),
    });
    page(mock);
    await screen.findByTestId("conversation-item");
    await userEvent.click(screen.getByTestId("conversation-delete"));
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This conversation does not exist.");
    expect(screen.getAllByTestId("conversation-item")).toHaveLength(1);
    failDelete = false;
    await userEvent.click(screen.getByTestId("conversation-delete"));
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(screen.queryByTestId("conversation-item")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("translates the conversation limit (429) when creating", async () => {
    const mock = createFetchMock({
      ...CONFIG_ROUTES,
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json({ error: "Conversation limit reached" }, 429),
    });
    page(mock);
    await userEvent.click(await screen.findByTestId("conversation-new"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have too many conversations. Delete some first.");
  });

  it("tells the user once when server defaults could not be loaded, and still creates", async () => {
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "New conversation")),
    });
    page(mock);
    await userEvent.click(await screen.findByTestId("conversation-new"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Could not load the server defaults; using built-in ones.");
  });
});
