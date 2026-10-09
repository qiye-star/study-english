import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import type { JoinRequestInfo, RoomInfo } from "../protocol";
import { ROOM } from "../room-fixtures";
import {
  cancelJoinRequest, createRoomV2, decideJoinRequest, getInvite, getJoinRequest, joinByInvite, joinRoomV2, listJoinRequests, previewInvite,
  ROOMS_V2_SERVER_ERRORS, rotateInvite, updateRoomSettings, type InvitePreview,
} from "./rooms-v2-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../../server/tests/fixtures/rooms_v2_core_contract.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Contract = { http: Record<string, any>; ws: Record<string, any> };
const recorded: Contract | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

/** spec §8 的形状;服务端样例(SC6 录制)合入前用它跑行为测试,合入后两者都跑。 */
const REQUEST_WIRE = { id: "q1", room_id: "r1", room_name: "美食角", user_id: 22222222, name: "bob", status: "pending", created_at: "2026-10-10T09:00:00+00:00" };
const SPEC: Contract = {
  http: {
    create: { room: { ...ROOM, name: "alice的房间", scenario: "cafe", level: "A2", join_mode: "approval", max_members: 4, allow_voice: true } },
    join_pending: { request: REQUEST_WIRE },
    invite_preview: { invite: { room_id: "r1", name: "美食角", scenario: "cafe", level: "B1", member_count: 2, max_members: 4, joined: false } },
  },
  ws: { reaction: { type: "reaction", seq: 1, key: "like", user_ids: [11111111] } },
};
const C = recorded ?? SPEC;

const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keys = (r: Record<string, true>) => Object.keys(r).sort();

const REQUEST: Record<keyof JoinRequestInfo, true> = { id: true, roomId: true, roomName: true, userId: true, name: true, status: true, createdAt: true };
const PREVIEW: Record<keyof InvitePreview, true> = { roomId: true, name: true, scenario: true, level: true, memberCount: true, maxMembers: true, joined: true };
const ROOM_V2: Partial<Record<keyof RoomInfo, true>> = { name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true };

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("rooms v2 core contract", () => {
  for (const [label, sample] of [["spec §8", SPEC], ["recorded server payloads", recorded]] as const) {
    it.skipIf(!sample)(`matches ${label}`, () => {
      const c = sample as Contract;
      expect(Object.keys(camel(c.http.join_pending.request)).sort()).toEqual(keys(REQUEST));
      expect(Object.keys(camel(c.http.invite_preview.invite)).sort()).toEqual(keys(PREVIEW));
      for (const k of Object.keys(ROOM_V2)) expect(camel(c.http.create.room)).toHaveProperty(k);
      expect(Object.keys(camel(c.ws.reaction)).sort()).toEqual(["key", "seq", "type", "userIds"]);
    });
  }

  it("distinguishes joined and pending", async () => {
    let joined = false;
    const { mock, api } = client({
      "POST /api/rooms/join": () => (joined ? json({ room: ROOM }) : json(C.http.join_pending, 202)),
      "POST /api/rooms": () => json(C.http.create),
      "GET /api/rooms/invite/tok": () => json(C.http.invite_preview),
    });
    expect((await joinRoomV2(api, "482913")).kind).toBe("pending");
    expect((await createRoomV2(api, { scenario: "cafe", joinMode: "approval" })).scenario).toBe("cafe");
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ scenario: "cafe", join_mode: "approval" });
    expect((await previewInvite(api, "tok")).maxMembers).toBe(4);
    joined = true;
    const res = await joinRoomV2(api, "482913");
    expect(res.kind === "joined" && res.room.id).toBe("r1");
  });

  it("omits a blank name and unset keys", async () => {
    const { mock, api } = client({ "POST /api/rooms": () => json(C.http.create) });
    await createRoomV2(api, { name: "  ", scenario: "free", level: undefined, maxMembers: 4, aiPublic: true, allowVoice: false });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ scenario: "free", max_members: 4, ai_public: true, allow_voice: false });
  });

  it("calls the request, settings and invite endpoints with encoded ids", async () => {
    const request = { request: REQUEST_WIRE };
    const link = { token: "abc", path: "/rooms/invite/abc" };
    const { mock, api } = client({
      "PATCH /api/rooms/r%2F1": () => json(C.http.create),
      "GET /api/rooms/requests/q%2F1": () => json(request),
      "DELETE /api/rooms/requests/q1": () => json({ request: { ...REQUEST_WIRE, status: "cancelled" } }),
      "GET /api/rooms/r1/requests": () => json({ requests: [REQUEST_WIRE] }),
      "POST /api/rooms/r1/requests/q1/approve": () => json({ request: { ...REQUEST_WIRE, status: "approved" } }),
      "POST /api/rooms/r1/requests/q1/deny": () => json({ request: { ...REQUEST_WIRE, status: "denied" } }),
      "POST /api/rooms/r1/invite": () => json(link),
      "POST /api/rooms/r1/invite/rotate": () => json(link),
      "POST /api/rooms/invite/a%2Bb/join": () => json({ room: ROOM }),
    });
    await updateRoomSettings(api, "r/1", { joinMode: "approval", locked: true });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ join_mode: "approval", locked: true });
    expect((await getJoinRequest(api, "q/1")).roomName).toBe("美食角");
    expect((await cancelJoinRequest(api, "q1")).status).toBe("cancelled");
    expect((await listJoinRequests(api, "r1")).map((r) => r.userId)).toEqual([22222222]);
    expect((await decideJoinRequest(api, "r1", "q1", true)).status).toBe("approved");
    expect((await decideJoinRequest(api, "r1", "q1", false)).status).toBe("denied");
    expect(await getInvite(api, "r1")).toEqual(link);
    expect(await rotateInvite(api, "r1")).toEqual(link);
    expect((await joinByInvite(api, "a+b")).id).toBe("r1");
  });

  it("maps every v2 server error to a key", () => {
    expect(Object.keys(ROOMS_V2_SERVER_ERRORS).sort()).toEqual(
      ["Below current members", "Invalid settings", "Request not found", "Too many requests for this room", "Try again later"]);
    for (const key of Object.values(ROOMS_V2_SERVER_ERRORS)) {
      for (const lng of ["en", "zh-CN"]) expect(i18n.exists(key, { lng }), `${lng} ${key}`).toBe(true);
    }
  });
});
