import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { JoinRequestInfo, RoomInfo } from "./protocol";
import { ROOM } from "./room-fixtures";
import { RoomSettingsSheet } from "./room-settings-sheet";
import { initialRoomState, type RoomState } from "./room-state";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const CONFIG = { enabled: true, ai_available: true, max_members: 8, max_text: 500,
  scenarios: [{ key: "free", title_zh: "自由聊天", title_en: "Free talk" }, { key: "cafe", title_zh: "咖啡店点单", title_en: "At a café" }],
  levels: ["A1", "A2", "B1", "B2", "C1"], default_max_members: 4, name_max: 30, voice_available: true, max_voice_ms: 60000,
  summary_available: false, reactions: ["like", "love", "haha", "wow", "clap", "thanks"] };
const WIRE_ROOM = { ...ROOM, name: "美食角", scenario: "free", level: "B1", join_mode: "code", max_members: 4, allow_voice: true };
const INFO: RoomInfo = { id: "r1", code: "482913", topic: "美食角", status: "open", locked: false, aiPublic: true, ownerId: 1, myRole: "owner",
  memberCount: 3, onlineCount: 2, createdAt: "", closedAt: null, name: "美食角", scenario: "free", level: "B1", joinMode: "code", maxMembers: 4, allowVoice: true };
const REQ: JoinRequestInfo = { id: "q1", roomId: "r1", roomName: "美食角", userId: 9, name: "lily", status: "pending", createdAt: "" };

function Harness({ initial }: { initial: RoomState }) {
  const [state, setState] = useState(initial);
  return <RoomSettingsSheet open onOpenChange={() => {}} state={state} onChanged={(room) => setState((s) => ({ ...s, room }))} />;
}

function setup(routes: Record<string, Handler> = {}, over: Partial<RoomState> = {}) {
  const mock = createFetchMock({ "GET /api/rooms/config": () => json(CONFIG), ...routes });
  const state: RoomState = { ...initialRoomState(), status: "live", room: INFO, me: { userId: 1, role: "owner" },
    members: [{ userId: 1, name: "alice", role: "owner", online: true }, { userId: 2, name: "bob", role: "member", online: true },
      { userId: 3, name: "carol", role: "member", online: false }], ...over };
  renderWithProviders(<Harness initial={state} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}

describe("RoomSettingsSheet", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("saves a changed setting at once", async () => {
    const mock = setup({ "PATCH /api/rooms/r1": () => json({ room: { ...WIRE_ROOM, join_mode: "approval" } }) });
    fireEvent.click(await screen.findByRole("radio", { name: "需房主同意" }));
    await waitFor(() => expect(mock.calls.find((c) => c.method === "PATCH")?.body).toBe('{"join_mode":"approval"}'));
    await waitFor(() => expect(screen.getByRole("radio", { name: "需房主同意" }).getAttribute("aria-checked")).toBe("true"));
    // 需房主同意的房间显示「加入请求」组
    expect(screen.getByText("没有待处理的加入请求")).toBeTruthy();
  });

  it("does not offer a member limit below the member count", async () => {
    setup({}, { room: { ...INFO, maxMembers: 3 } });
    expect(await screen.findByTestId("room-max-members")).toBeTruthy();
    expect(screen.getByTestId("room-max-members").textContent).toBe("3");
    expect((screen.getByTestId("room-max-members-dec") as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains and rolls back when the server refuses", async () => {
    setup({ "PATCH /api/rooms/r1": () => json({ error: "Below current members" }, 409) });
    fireEvent.click(await screen.findByTestId("room-max-members-dec"));
    expect(screen.getByTestId("room-max-members").textContent).toBe("3");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("人数上限不能低于当前成员数"));
    await waitFor(() => expect(screen.getByTestId("room-max-members").textContent).toBe("4"));
  });

  it("renames on enter and picks a scenario", async () => {
    const mock = setup({ "PATCH /api/rooms/r1": (c) => json({ room: { ...WIRE_ROOM, ...JSON.parse(String(c.body)) } }) });
    const name = await screen.findByDisplayValue("美食角");
    fireEvent.change(name, { target: { value: "电影角" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual(['{"name":"电影角"}']));
    fireEvent.click(screen.getByRole("button", { name: "咖啡店点单" }));
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toBe('{"scenario":"cafe"}'));
  });

  it("lists live join requests for the owner and approves one", async () => {
    const mock = setup({ "POST /api/rooms/r1/requests/q1/approve": () => json({ request: { id: "q1", room_id: "r1", room_name: "美食角",
      user_id: 9, name: "lily", status: "approved", created_at: "" } }) }, { joinRequests: [REQ] });
    expect(await screen.findByText("加入请求")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "同意 lily 加入" }));
    await waitFor(() => expect(screen.queryByTestId("room-join-request")).toBeNull());
    expect(mock.calls.some((c) => c.url.pathname === "/api/rooms/r1/requests/q1/approve")).toBe(true);
  });

  it("loads join requests over HTTP while reconnecting", async () => {
    setup({ "GET /api/rooms/r1/requests": () => json({ requests: [{ id: "q1", room_id: "r1", room_name: "美食角", user_id: 9, name: "lily",
      status: "pending", created_at: "" }] }) }, { status: "reconnecting" });
    expect(await screen.findByText("lily")).toBeTruthy();
  });

  it("shows only members to non-owners", async () => {
    const mock = setup({}, { me: { userId: 2, role: "member" } });
    expect(await screen.findAllByTestId("room-member")).toHaveLength(3);
    expect(screen.queryByTestId("room-lock")).toBeNull();
    expect(screen.queryByTestId("room-name")).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });
});

describe("RoomSettingsSheet avatars (W3)", () => {
  const AV = "/api/avatars/00000000000000000000000000000000";
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("shows member avatars, and lets a member report someone else's avatar (never their own)", async () => {
    const mock = setup({ "POST /api/avatar-reports": () => new Response(null, { status: 204 }) }, {
      members: [
        { userId: 1, name: "alice", role: "owner", online: true, avatarUrl: AV },
        { userId: 2, name: "bob", role: "member", online: true, avatarUrl: AV },
        { userId: 3, name: "carol", role: "member", online: false, avatarUrl: null },
      ],
    });
    const rows = await screen.findAllByTestId("room-member");
    expect(rows[1].querySelector("img")).toHaveAttribute("src", AV);
    expect(rows[2].querySelector("img")).toBeNull();
    expect(screen.queryByTestId("room-avatar-report-1")).toBeNull();
    expect(screen.queryByTestId("room-avatar-report-3")).toBeNull();
    fireEvent.click(screen.getByTestId("room-avatar-report-2"));
    fireEvent.click(await screen.findByRole("radio", { name: "冒充他人" }));
    fireEvent.click(screen.getByRole("button", { name: "提交举报" }));
    await waitFor(() => expect(mock.calls.find((c) => c.method === "POST")?.body).toBe('{"user_id":2,"reason":"impersonation"}'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("已收到,管理员会处理。"));
  });
});
