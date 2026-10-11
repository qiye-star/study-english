import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomsEndedPage } from "./ended-rooms-page";
import { ROOM } from "../room-fixtures";

const row = (id: string, over = {}) => ({ ...ROOM, id, code: null as string | null, status: "closed", name: `房间${id}`, closed_at: "2026-10-09T10:00:00+00:00",
  close_reason: "owner", my_role: "owner", summary_status: "none", ...over });

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  renderWithProviders(<RoomsEndedPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/ended", path: "/rooms/ended",
    user: { id: "11111111", name: "alice" } });
  return mock;
}

describe("RoomsEndedPage", () => {
  beforeEach(() => localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })));
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("lists ended rooms, shows the summary state and opens the history", async () => {
    setup({ "GET /api/rooms/ended": () => json({ rooms: [row("r2", { summary_status: "done" }), row("r3", { my_role: "member", close_reason: "idle" })], next_cursor: null }) });
    const rows = await screen.findAllByTestId("ended-room");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("href")).toBe("/rooms/r/r2/summary"); // a finished recap opens first
    expect(rows[0].textContent).toContain("房主结束");
    expect(rows[1].getAttribute("href")).toBe("/rooms/r/r3");
    expect(screen.getAllByTestId("ended-reopen")).toHaveLength(1); // owners only
  });

  it("pages with a cursor and appends without duplicates", async () => {
    const mock = setup({ "GET /api/rooms/ended": (req) => json(req.url.searchParams.get("cursor")
      ? { rooms: [row("r2"), row("r4")], next_cursor: null }
      : { rooms: [row("r2"), row("r3")], next_cursor: "c1" }) });
    await screen.findAllByTestId("ended-room");
    fireEvent.click(screen.getByTestId("ended-more"));
    await waitFor(() => expect(screen.getAllByTestId("ended-room")).toHaveLength(3));
    expect(mock.calls.at(-1)!.url.searchParams.get("cursor")).toBe("c1");
    expect(screen.queryByTestId("ended-more")).toBeNull();
  });

  it("keeps the loaded rooms and shows an inline retry when paging fails", async () => {
    let fail = true;
    setup({ "GET /api/rooms/ended": (req) => {
      if (!req.url.searchParams.get("cursor")) return json({ rooms: [row("r2"), row("r3")], next_cursor: "c1" });
      return fail ? json({ error: "x" }, 500) : json({ rooms: [row("r4")], next_cursor: null });
    } });
    await screen.findAllByTestId("ended-room");
    fireEvent.click(screen.getByTestId("ended-more"));
    expect(await screen.findByTestId("ended-more-error")).toBeInTheDocument();
    expect(screen.getAllByTestId("ended-room")).toHaveLength(2);
    expect(screen.getByTestId("ended-more")).toHaveTextContent("重试");
    fail = false;
    fireEvent.click(screen.getByTestId("ended-more"));
    await waitFor(() => expect(screen.getAllByTestId("ended-room")).toHaveLength(3));
    expect(screen.queryByTestId("ended-more-error")).toBeNull();
  });

  it("an owner reopens a room from the list and lands in it", async () => {
    setup({
      "GET /api/rooms/ended": () => json({ rooms: [row("r2")], next_cursor: null }),
      "POST /api/rooms/r2/reopen": () => json({ room: { ...ROOM, id: "r2", status: "open", code: "573920" } }),
    });
    fireEvent.click(await screen.findByTestId("ended-reopen"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r2"));
  });

  it("does not offer reopen for an admin-closed room", async () => {
    setup({ "GET /api/rooms/ended": () => json({ rooms: [row("r2", { close_reason: "admin" })], next_cursor: null }) });
    await screen.findAllByTestId("ended-room");
    expect(screen.queryByTestId("ended-reopen")).toBeNull();
  });

  it("explains why a reopen failed and keeps the list", async () => {
    setup({
      "GET /api/rooms/ended": () => json({ rooms: [row("r2")], next_cursor: null }),
      "POST /api/rooms/r2/reopen": () => json({ error: "Too many rooms" }, 429),
    });
    fireEvent.click(await screen.findByTestId("ended-reopen"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(screen.getAllByTestId("ended-room")).toHaveLength(1);
  });

  it("shows the empty state", async () => {
    setup({ "GET /api/rooms/ended": () => json({ rooms: [], next_cursor: null }) });
    expect(await screen.findByText("还没有已结束的房间。")).toBeTruthy();
  });
});
