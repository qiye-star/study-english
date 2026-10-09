import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import type { RoomInfo } from "../protocol";
import { getInvite, joinByInvite, previewInvite, rotateInvite, type InvitePreview, type RoomInvite } from "./invite-api";
import { getRoomSummary, retryRoomSummary, type RoomSummaryView } from "./summary-api";

/** WE 的邀请与小结接口对照服务端录制样例(SC6 rooms_v2_core_contract / SX3 rooms_v2_summary_contract,集成时补)。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../../../server/tests/fixtures");
const server = path.resolve(here, "../../../../../server/app/routers");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CORE: { http: Record<string, any> } = JSON.parse(readFileSync(path.join(fixtures, "rooms_v2_core_contract.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SUMMARY: { http: Record<string, any> } = JSON.parse(readFileSync(path.join(fixtures, "rooms_v2_summary_contract.json"), "utf8"));
const roomsPy = readFileSync(path.join(server, "rooms.py"), "utf8");
const summaryPy = readFileSync(path.join(server, "rooms_summary.py"), "utf8");

const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const INVITE: Record<keyof RoomInvite, true> = { token: true, path: true };
const PREVIEW: Record<keyof InvitePreview, true> = { roomId: true, name: true, scenario: true, level: true, memberCount: true, maxMembers: true, joined: true };
const SUMMARY_KEYS: Record<keyof RoomSummaryView, true> = {
  status: true, reason: true, overviewZh: true, words: true, myFixes: true, createdAt: true, finishedAt: true,
};
const ROOM_V2: Partial<Record<keyof RoomInfo, true>> = { name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true };

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("invite endpoints match the recorded server payloads", () => {
  it("the server has the routes the web calls", () => {
    for (const route of ['@router.post("/{room_id}/invite")', '@router.post("/{room_id}/invite/rotate")',
      '@router.get("/invite/{token}")', '@router.post("/invite/{token}/join"']) expect(roomsPy).toContain(route);
  });

  it("parses get / rotate / preview / join with exactly the recorded keys", async () => {
    const { mock, api } = client({
      "POST /api/rooms/r%201/invite": () => json(CORE.http.invite),
      "POST /api/rooms/r%201/invite/rotate": () => json(CORE.http.invite),
      "GET /api/rooms/invite/t%2Fk": () => json(CORE.http.invite_preview),
      "POST /api/rooms/invite/t%2Fk/join": () => json(CORE.http.invite_join),
    });
    expect(Object.keys(await getInvite(api, "r 1")).sort()).toEqual(Object.keys(INVITE).sort());
    expect(Object.keys(await rotateInvite(api, "r 1")).sort()).toEqual(Object.keys(INVITE).sort());
    const preview = await previewInvite(api, "t/k");
    expect(Object.keys(preview).sort()).toEqual(Object.keys(PREVIEW).sort());
    expect(preview).toEqual(camel(CORE.http.invite_preview.invite));
    const room = await joinByInvite(api, "t/k");
    for (const k of Object.keys(ROOM_V2)) expect(room).toHaveProperty(k);
    expect(room.myRole).toBe("member");
    expect(mock.calls).toHaveLength(4);
  });
});

describe("summary endpoints match the recorded server payloads", () => {
  it("the server has the routes the web calls", () => {
    expect(summaryPy).toContain('@router.get("/{room_id}/summary")');
    expect(summaryPy).toContain('@router.post("/{room_id}/summary/retry")');
  });

  it("a done summary keeps every recorded field", async () => {
    const { api } = client({
      "GET /api/rooms/r1/summary": () => json(SUMMARY.http.summary),
      "POST /api/rooms/r1/summary/retry": () => json({ summary: { ...SUMMARY.http.summary.summary, status: "pending" } }),
    });
    const recorded = camel(SUMMARY.http.summary.summary);
    expect(Object.keys(recorded).sort()).toEqual(Object.keys(SUMMARY_KEYS).sort());
    expect(await getRoomSummary(api, "r1")).toEqual(recorded);
    expect((await retryRoomSummary(api, "r1")).status).toBe("pending");
  });
});
