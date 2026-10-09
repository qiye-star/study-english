import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ROOM } from "./room-fixtures";
import { RoomsLobbyPage } from "./rooms-lobby-page";

function setup(join = () => json({ room: ROOM }), enabled = true) {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json({ enabled, ai_available: true, max_members: 8, max_text: 500 }),
    "GET /api/rooms/mine": () => json({ rooms: [ROOM, { ...ROOM, id: "r2", code: null, topic: "", status: "closed" }] }),
    "POST /api/rooms/join": join,
    "POST /api/rooms": () => json({ room: { ...ROOM, id: "r9" } }),
  });
  renderWithProviders(<RoomsLobbyPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms", path: "/rooms" });
  return mock;
}

describe("RoomsLobbyPage", () => {
  // 断言用中文文案:SettingsProvider 从 localStorage 读界面语言
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("joins by code and opens the room by id", async () => {
    const mock = setup();
    const input = await screen.findByTestId("room-code-input");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(input, { target: { value: "48 29 1" } });
    expect((screen.getByTestId("room-join") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "４８２ ９１３" } });
    expect(screen.getAllByTestId("code-cell").map((c) => c.textContent).join("")).toBe("482913");
    fireEvent.click(screen.getByTestId("room-join"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r1"));
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST")!.body as string)).toEqual({ code: "482913" });
  });

  it("shows why a join failed", async () => {
    setup(() => json({ error: "Room is locked" }, 403));
    fireEvent.change(await screen.findByTestId("room-code-input"), { target: { value: "482913" } });
    fireEvent.click(screen.getByTestId("room-join"));
    expect(await screen.findByText("房间已锁定")).toBeTruthy();
  });

  it("lists my open and ended rooms and creates a room with a topic", async () => {
    const mock = setup();
    const rows = await screen.findAllByTestId("my-room");
    expect(rows.map((r) => r.dataset.status)).toEqual(["open", "closed"]);
    expect(rows[1].getAttribute("href")).toBe("/rooms/r/r2");
    expect(rows[1].textContent).toContain("已结束");
    fireEvent.click(screen.getByTestId("room-create"));
    fireEvent.click(await screen.findByRole("button", { name: "美食" }));
    fireEvent.click(screen.getByTestId("room-create-submit"));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r9"));
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/rooms")!.body as string)).toEqual({ topic: "美食" });
  });

  it("explains when rooms are off", async () => {
    setup(undefined, false);
    expect(await screen.findByText("联机练习未开启。")).toBeTruthy();
    expect(screen.queryByTestId("room-code-input")).toBeNull();
  });
});
