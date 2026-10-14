import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ROOM } from "../room-fixtures";
import { RoomInvitePage } from "./invite-page";

const CONFIG = { enabled: true, ai_available: true, max_members: 8, max_text: 500,
  scenarios: [{ key: "free", title_zh: "自由聊天", title_en: "Free talk" }, { key: "cafe", title_zh: "咖啡店点单", title_en: "At a café" }],
  levels: ["A1", "A2", "B1", "B2", "C1"], default_max_members: 4, name_max: 30, voice_available: false, max_voice_ms: 60000,
  summary_available: false, reactions: ["like", "love", "haha", "wow", "clap", "thanks"] };
const INVITE = { room_id: "r1", name: "美食角", scenario: "cafe", level: "A2", member_count: 3, max_members: 4, joined: false };

function setup(routes: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json(CONFIG),
    "GET /api/rooms/invite/tok123": () => json({ invite: INVITE }),
    "POST /api/rooms/invite/tok123/join": () => json({ room: { ...ROOM, id: "r1" } }),
    ...routes,
  });
  renderWithProviders(<RoomInvitePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/invite/tok123", path: "/rooms/invite/:token" });
  return mock;
}

describe("RoomInvitePage", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("previews the room and joins it", async () => {
    const mock = setup();
    expect(await screen.findByText("美食角")).toBeTruthy();
    expect(screen.getByText(/咖啡店点单/)).toBeTruthy();
    expect(screen.getByText("水平 A2 · 初级")).toBeTruthy();
    expect(screen.getByText(/3\/4 人/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "加入房间" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r1"));
    expect(mock.calls.some((c) => c.method === "POST" && c.url.pathname === "/api/rooms/invite/tok123/join")).toBe(true);
  });

  it("goes straight in when already a member", async () => {
    const mock = setup({ "GET /api/rooms/invite/tok123": () => json({ invite: { ...INVITE, joined: true } }) });
    fireEvent.click(await screen.findByRole("button", { name: "进入房间" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/rooms/r/r1"));
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("says the link expired on 404", async () => {
    setup({ "GET /api/rooms/invite/tok123": () => json({ error: "Room not found" }, 404) });
    expect(await screen.findByText("邀请链接已失效")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加入房间" })).toBeNull();
  });

  it("shows why joining failed", async () => {
    setup({ "POST /api/rooms/invite/tok123/join": () => json({ error: "Room is full" }, 409) });
    fireEvent.click(await screen.findByRole("button", { name: "加入房间" }));
    expect(await screen.findByText("房间已满")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/rooms/invite/tok123");
  });
});
