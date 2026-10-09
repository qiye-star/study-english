import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { closeRoom, createRoom, getRoom, joinRoom, kickMember, leaveRoom, myRooms, normalizeCode, reportMessage, roomHistory, roomTicket, ROOMS_SERVER_ERRORS, updateRoom } from "./rooms-api";
import { ROOM } from "./room-fixtures";


describe("rooms api", () => {
  it("normalizes codes like the server", () => {
    expect([normalizeCode(" 482 913 "), normalizeCode("４８２９１３"), normalizeCode("012345"), normalizeCode("48291")]).toEqual(["482913", "482913", null, null]);
  });

  it("calls the endpoints with snake_case bodies", async () => {
    const mock = createFetchMock({
      "POST /api/rooms": () => json({ room: ROOM }),
      "POST /api/rooms/join": () => json({ room: ROOM }),
      "POST /api/rooms/r1/ticket": () => json({ ticket: "secret", expires_in: 60 }),
      "PATCH /api/rooms/r1": () => json({ room: { ...ROOM, ai_public: false } }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await createRoom(api, "美食")).aiPublic).toBe(true);
    await joinRoom(api, "482913");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ code: "482913" });
    expect(await roomTicket(api, "r1")).toBe("secret");
    expect((await updateRoom(api, "r1", { aiPublic: false })).aiPublic).toBe(false);
    expect(JSON.parse(mock.calls[3].body as string)).toEqual({ ai_public: false });
  });

  it("reads rooms, members and history, and sends owner actions", async () => {
    const mock = createFetchMock({
      "GET /api/rooms/mine": () => json({ rooms: [ROOM] }),
      "GET /api/rooms/r1": () => json({ room: ROOM, members: [{ user_id: 1, name: "a", role: "owner", online: true }] }),
      "GET /api/rooms/r1/messages": () => json({ messages: [{ seq: 1, reply_to: null }] }),
      "POST /api/rooms/r1/kick": () => json({ ok: true }),
      "POST /api/rooms/r1/leave": () => json({ ok: true }),
      "POST /api/rooms/r1/close": () => json({ room: { ...ROOM, status: "closed", code: null } }),
      "POST /api/rooms/r1/messages/m1/report": () => json({ ok: true }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await myRooms(api))[0].ownerId).toBe(11111111);
    expect((await getRoom(api, "r1")).members[0].userId).toBe(1);
    expect((await roomHistory(api, "r1", 9))[0].replyTo).toBeNull();
    expect(mock.calls[2].url.search).toBe("?before_seq=9&limit=50");
    await kickMember(api, "r1", 22);
    expect(JSON.parse(mock.calls[3].body as string)).toEqual({ user_id: 22 });
    await leaveRoom(api, "r1");
    expect((await closeRoom(api, "r1")).status).toBe("closed");
    await reportMessage(api, "r1", "m1", "spam");
    expect(JSON.parse(mock.calls[6].body as string)).toEqual({ reason: "spam" });
  });

  it("maps the join errors", () => {
    expect(Object.keys(ROOMS_SERVER_ERRORS)).toEqual(expect.arrayContaining(["Room not found", "Room is locked", "Room is full", "Removed from room", "Too many rooms", "Room capacity reached"]));
  });
});
