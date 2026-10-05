import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "~/i18n";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ConversationsPage } from "./conversations-page";
import { PRESET_SCENARIOS } from "./scenarios";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

const CONFIG_ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};
const conv = (id: string, name: string) => ({ id, name, config: {}, created_at: "2026-10-04T00:00:00+00:00", updated_at: "2026-10-04T00:00:00+00:00" });

describe("ConversationsPage", () => {
  beforeEach(() => { resetServerAiConfigCache(); vi.mocked(toast.error).mockClear(); });

  it("New opens the scenario panel; a preset creates the conversation, saves its opening line and opens it", async () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    let playsBeforeCreate = -1;
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => { playsBeforeCreate = play.mock.calls.length; return json(conv("c9", "Ordering coffee")); },
      "POST /api/conversations/c9/messages": () => json({ messages: [{ id: "m1", role: "assistant", content: PRESET_SCENARIOS.cafe.opening }] }),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    expect(await screen.findByTestId("conversations-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-new"));
    expect(await screen.findByTestId("scenario-sheet")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId("scenario-level"), "B1");
    play.mockClear();
    await userEvent.click(screen.getByTestId("scenario-cafe"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    expect(screen.getByTestId("location")).toHaveAttribute("data-state", JSON.stringify({ speakOpening: "m1" }));
    expect(playsBeforeCreate).toBeGreaterThanOrEqual(1); // R5:点击的同步阶段解锁共享播放器
    const posts = mock.calls.filter((c) => c.method === "POST");
    expect(JSON.parse(posts[0].body as string)).toEqual({ name: "Ordering coffee", config: { scenario: { id: "cafe" }, level: "B1" } });
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/config/"))).toBe(false); // R2:创建时不再加载/写入默认值
  });

  it("a free conversation and a custom scenario", async () => {
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": (call) => json(conv(JSON.parse(call.body as string).config.scenario.id === "free" ? "c1" : "c2", "x")),
      "POST /api/conversations/c2/messages": () => json({ messages: [{ id: "m2" }] }),
    });
    const view = renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    await screen.findByTestId("conversations-empty");
    await userEvent.click(screen.getByTestId("conversation-new"));
    await userEvent.click(await screen.findByTestId("scenario-free"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1"));
    expect(screen.getByTestId("location")).toHaveAttribute("data-state", "null");
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string))
      .toEqual({ name: "New conversation", config: { scenario: { id: "free" }, level: "auto" } });
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/messages"))).toHaveLength(0);
    view.unmount();

    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    await userEvent.click(await screen.findByTestId("conversation-new"));
    expect(screen.getByTestId("scenario-custom-start")).toBeDisabled();
    await userEvent.type(screen.getByTestId("scenario-custom-input"), "   ");
    expect(screen.getByTestId("scenario-custom-start")).toBeDisabled();
    expect(screen.getByTestId("scenario-custom-input")).toHaveAttribute("maxlength", "500");
    await userEvent.clear(screen.getByTestId("scenario-custom-input"));
    await userEvent.type(screen.getByTestId("scenario-custom-input"), "  Returning a broken phone  ");
    await userEvent.click(screen.getByTestId("scenario-custom-start"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c2"));
    const custom = JSON.parse(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/conversations").at(-1)!.body as string);
    expect(custom).toEqual({ name: "Returning a broken phone", config: { scenario: { id: "custom", custom: "Returning a broken phone" }, level: "auto" } });
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

  it("an opening line that failed to save can be retried without creating a second conversation", async () => {
    let fail = true;
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "Hotel check-in")),
      "POST /api/conversations/c9/messages": () => (fail ? json({ error: "Message limit reached" }, 429) : json({ messages: [{ id: "m3" }] })),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    await userEvent.click(await screen.findByTestId("conversation-new"));
    await userEvent.click(await screen.findByTestId("scenario-hotel"));
    expect(await screen.findByTestId("scenario-error")).toHaveTextContent("The conversation was created, but its opening line could not be saved.");
    fail = false;
    await userEvent.click(screen.getByTestId("scenario-retry"));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/conversations")).toHaveLength(1);
  });

  it("closing the panel after a failed opening deletes the empty conversation and refreshes the list", async () => {
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json(conv("c9", "Hotel check-in")),
      "POST /api/conversations/c9/messages": () => json({ error: "Message limit reached" }, 429),
      "DELETE /api/conversations/c9": () => json({ id: "c9" }),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    await userEvent.click(await screen.findByTestId("conversation-new"));
    await userEvent.click(await screen.findByTestId("scenario-hotel"));
    await screen.findByTestId("scenario-error");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "GET" && c.url.pathname === "/api/conversations")).toHaveLength(2));
    expect(screen.getByTestId("location")).toHaveTextContent("/chat");
  });

  it("a failed create shows the translated reason and keeps the panel open", async () => {
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": () => json({ error: "Conversation limit reached" }, 429),
    });
    renderWithProviders(<ConversationsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat" });
    await userEvent.click(await screen.findByTestId("conversation-new"));
    await userEvent.click(await screen.findByTestId("scenario-cafe"));
    expect(await screen.findByTestId("scenario-error")).toHaveTextContent("You have too many conversations. Delete some first.");
    expect(screen.queryByTestId("scenario-retry")).toBeNull();
    expect(screen.getByTestId("scenario-sheet")).toBeInTheDocument();
  });

  it("the scenario panel's controls have accessible names", async () => {
    page(createFetchMock({ "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }) }));
    await userEvent.click(await screen.findByTestId("conversation-new"));
    expect(await screen.findByRole("dialog", { name: "Choose a scenario" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "English level" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Custom scenario" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ordering coffee/ })).toBeInTheDocument();
  });

  it("a double tap on a scenario creates only one conversation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({
      "GET /api/conversations": () => json({ conversations: [], page: 1, next: null }),
      "POST /api/conversations": async () => { await gate; return json(conv("c9", "Ordering coffee")); },
      "POST /api/conversations/c9/messages": () => json({ messages: [{ id: "m1" }] }),
    });
    page(mock);
    await userEvent.click(await screen.findByTestId("conversation-new"));
    await userEvent.dblClick(await screen.findByTestId("scenario-cafe"));
    release();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/chat/c9"));
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/conversations")).toHaveLength(1);
    expect(mock.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/messages"))).toHaveLength(1);
  });
});
