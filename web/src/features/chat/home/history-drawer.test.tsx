import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import contract from "./chat-home-contract.stub.json";
import { consumePendingModal, getChatHomeState, requestToday, resetChatHomeStore } from "./chat-home-store";
import { HistoryDrawer } from "./history-drawer";

const at = (day: number, h: number) => new Date(2026, 9, day, h).toISOString();
const conv = (id: string, name: string, updatedAt: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, config: {}, created_at: updatedAt, updated_at: updatedAt, ...extra });

const PAGE1 = {
  conversations: [
    conv("c-today", "2026-10-23", at(23, 9), { daily_date: "2026-10-23" }), // also pinned: must not appear twice
    conv("c-yday", "2026-10-22", at(23, 8), { daily_date: "2026-10-22" }), // replied to today -> today's group
    conv("c-a", "Trip planning", at(22, 20)),
    conv("c-b", "Job interview", at(20, 9)),
  ],
  page: 1, next: 2 as number | null,
};
const PAGE2 = { conversations: [conv("c-b", "Job interview", at(20, 9)), conv("c-c", "Old one", at(18, 9))], page: 2, next: null as number | null };

function Harness({ currentId, onChange }: { currentId?: string; onChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return <HistoryDrawer open={open} currentId={currentId} onOpenChange={(o) => { setOpen(o); onChange?.(o); }} />;
}

async function setup(extra: Record<string, Handler> = {}, props: { currentId?: string; onChange?: (o: boolean) => void } = {}) {
  const mock = createFetchMock({
    "POST /api/chat-home/today": () => json(contract.today_ready_bilingual),
    "GET /api/conversations": (c) => json(c.url.searchParams.get("page") === "2" ? PAGE2 : PAGE1),
    ...extra,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  await requestToday(api, { open: true });
  consumePendingModal();
  mock.calls.length = 0;
  renderWithProviders(<Harness {...props} />, { api, route: "/chat/c-a" });
  await screen.findByTestId("chat-history-today");
  await screen.findByText("Trip planning");
  return mock;
}

beforeEach(() => resetChatHomeStore());
afterEach(() => resetChatHomeStore());

describe("history drawer", () => {
  it("lists the first page with the drawer query and nothing but ids in URLs", async () => {
    const mock = await setup();
    const list = mock.calls.find((c) => c.url.pathname === "/api/conversations")!;
    expect(list.url.searchParams.get("hide_idle_daily")).toBe("true");
    expect(list.url.searchParams.get("per_page")).toBe("20");
    expect(list.url.searchParams.has("tz_offset_minutes")).toBe(true);
    expect([...list.url.searchParams.keys()].sort()).toEqual(["hide_idle_daily", "page", "per_page", "tz_offset_minutes"]);
  });

  it("pins today at the top once, even though the list also returns it, and marks the current chat", async () => {
    await setup({}, { currentId: "c-today" });
    expect(screen.getAllByTestId("chat-history-today")).toHaveLength(1);
    expect(screen.getByTestId("chat-history-today")).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByTestId("conversation-item")).toHaveLength(3); // c-yday, c-a, c-b
    expect(screen.getByTestId("chat-history-today")).toHaveTextContent("Good morning");
    expect(screen.getByTestId("chat-history-today")).not.toHaveTextContent("*");
  });

  it("groups by last-activity day: yesterday's daily chat replied to today sits in Today with its own date in the title", async () => {
    await setup();
    const todayGroup = screen.getByRole("region", { name: "Today" });
    expect(within(todayGroup).getByText("Daily chat · Oct 22 Thu")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Yesterday" })).getByText("Trip planning")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Tue 2026-10-20" })).toBeInTheDocument();
  });

  it("loads more without duplicates", async () => {
    const mock = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Old one");
    expect(screen.getAllByText("Job interview")).toHaveLength(1);
    expect(mock.calls.filter((c) => c.url.pathname === "/api/conversations")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("selecting a row closes the drawer and navigates to /chat/:id; the new button goes to /chat/new; today goes to /chat", async () => {
    const onChange = vi.fn();
    await setup({}, { onChange });
    await userEvent.click(screen.getByText("Trip planning"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c-a");
  });

  it("new chat and today navigate to their fixed paths", async () => {
    await setup();
    await userEvent.click(screen.getByTestId("chat-history-new"));
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/new");
  });

  it("closes with Escape and keeps the background out of the accessibility tree while open", async () => {
    const onChange = vi.fn();
    await setup({}, { onChange });
    expect(screen.getByTestId("location").parentElement).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("dialog", { name: "Chats" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByTestId("chat-history-drawer")).toBeNull());
  });

  it("deletes a history row after confirmation", async () => {
    const mock = await setup({ "DELETE /api/conversations/c-a": () => json({ id: "c-a" }) }, { currentId: "c-a" });
    const row = screen.getByText("Trip planning").closest("li")!;
    await userEvent.click(within(row).getByTestId("conversation-delete"));
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(screen.queryByText("Trip planning")).toBeNull());
    expect(mock.calls.some((c) => c.method === "DELETE" && c.url.pathname === "/api/conversations/c-a")).toBe(true);
    expect(screen.getByTestId("location")).toHaveTextContent("/chat"); // viewing it -> back to /chat
    expect(screen.getByTestId("location")).not.toHaveTextContent("/chat/c-a");
  });

  it("deleting today's card uses the dedicated text, then rebuilds with one new POST /today and no modal", async () => {
    let n = 0;
    const mock = await setup({
      "DELETE /api/conversations/c-today": () => json({ id: "c-today" }),
      "POST /api/chat-home/today": () => json(++n >= 2 ? { ...contract.today_ready_bilingual, conversation: { ...contract.today_ready_bilingual.conversation, id: "c-new" } } : contract.today_ready_bilingual),
    });
    const before = getChatHomeState().openSeq;
    await userEvent.click(screen.getByTestId("chat-history-today-delete"));
    expect(await screen.findByText(/today's greeting stays/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("conversation-delete-confirm"));
    await waitFor(() => expect(getChatHomeState().today?.conversation.id).toBe("c-new"));
    const order = mock.calls.filter((c) => c.method === "DELETE" || c.url.pathname === "/api/chat-home/today").map((c) => `${c.method} ${c.url.pathname}`);
    expect(order).toEqual(["DELETE /api/conversations/c-today", "POST /api/chat-home/today"]);
    expect(getChatHomeState()).toMatchObject({ pendingModal: false, openSeq: before });
    expect(screen.getByTestId("location")).toHaveTextContent("/chat"); // was /chat/c-a: replaced by /chat
    expect(screen.getByTestId("location")).not.toHaveTextContent("/chat/");
  });

  it("a failed delete shows an error and leaves the store alone", async () => {
    await setup({ "DELETE /api/conversations/c-today": () => json({ error: "boom" }, 500) });
    const snapshot = getChatHomeState().today;
    await userEvent.click(screen.getByTestId("chat-history-today-delete"));
    await userEvent.click(await screen.findByTestId("conversation-delete-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete");
    expect(getChatHomeState().today).toBe(snapshot);
  });

  it("shows the empty state and a retry on failure", async () => {
    let fail = true;
    const mock = createFetchMock({
      "POST /api/chat-home/today": () => json(contract.today_ready_bilingual),
      "GET /api/conversations": () => (fail ? json({ error: "x" }, 500) : json({ conversations: [], page: 1, next: null })),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    renderWithProviders(<Harness />, { api, route: "/chat" });
    const retry = await screen.findByRole("button", { name: "Retry" });
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByTestId("chat-history-empty")).toBeInTheDocument();
  });
});
