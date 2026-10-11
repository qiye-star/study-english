import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { parseRoomEvent, type RoomEvent, type RoomInfo, type RoomMemberInfo, type RoomMessage, type RoomSender } from "./protocol";
import { ROOMS_ALL_SERVER_ERRORS } from "./create/rooms-v2-api";
import { initialRoomState, roomReducer } from "./room-state";
import {
  closeRoom, createRoom, fetchRoomsConfig, getRoom, joinRoom, kickMember, leaveRoom, myRooms, reportMessage, roomHistory, roomTicket,
  ROOMS_SERVER_ERRORS, updateRoom, type RoomsConfig,
} from "./rooms-api";

/**
 * 跨车道契约(F1):`server/tests/fixtures/rooms_contract.json` 由 `server/tests/test_web_contract.py` 用真实应用
 * (测试库 + 假 LLM)跑一整场房间会话录下并逐形状核对;这里核对 web 的 TypeScript 镜像与它逐键一致。
 * 下面的 `Record<keyof T, true>` 在编译期保证键表与类型一致,运行期再与样例比对——任一侧改名都会失败。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../server");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: { http: Record<string, any>; ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "tests/fixtures/rooms_contract.json"), "utf8"));
const protocolPy = readFileSync(path.join(root, "app/rooms/protocol.py"), "utf8");
const roomsPy = readFileSync(path.join(root, "app/routers/rooms.py"), "utf8");

const keys = (r: Record<string, true>) => Object.keys(r).sort();
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const wireKeys = (v: unknown) => Object.keys(camel(v)).sort();

const ROOM: Record<keyof RoomInfo, true> = { id: true, code: true, topic: true, status: true, locked: true, aiPublic: true, aiMuted: true, ownerId: true,
  myRole: true, memberCount: true, onlineCount: true, createdAt: true, closedAt: true, closeReason: true,
  name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true };
const MEMBER: Record<keyof RoomMemberInfo, true> = { userId: true, name: true, role: true, online: true };
const MESSAGE: Record<keyof RoomMessage, true> = { seq: true, id: true, lane: true, kind: true, sender: true, text: true, assisted: true,
  replyTo: true, aiStatus: true, meta: true, createdAt: true, hidden: true, quote: true, voice: true, reactions: true };
const SENDER: Record<keyof RoomSender, true> = { kind: true, id: true, name: true };
const CONFIG: Record<keyof RoomsConfig, true> = { enabled: true, aiAvailable: true, maxMembers: true, maxText: true,
  scenarios: true, levels: true, defaultMaxMembers: true, nameMax: true, voiceAvailable: true, maxVoiceMs: true, summaryAvailable: true, reactions: true };
type Ev<T extends RoomEvent["type"]> = Record<keyof Extract<RoomEvent, { type: T }>, true>;
const EVENTS: { [K in RoomEvent["type"]]: Ev<K> } = {
  welcome: { type: true, room: true, me: true, members: true, lastSeq: true, truncated: true, assistHistory: true, protocol: true, reactions: true, joinRequests: true },
  message: { type: true, message: true },
  ack: { type: true, clientId: true, seq: true },
  presence: { type: true, members: true },
  ai_typing: { type: true, replyTo: true },
  ai_failed: { type: true, replyTo: true, code: true },
  assist_reply: { type: true, requestId: true, message: true },
  assist_failed: { type: true, requestId: true, code: true },
  room_update: { type: true, room: true },
  notice: { type: true, code: true },
  error: { type: true, code: true },
  closed: { type: true, reason: true },
  pong: { type: true },
  message_hidden: { type: true, seq: true },
  // v2 events not in the recorded session: compile-time checked here, recorded by the lanes' own contract files
  activity: { type: true, userId: true, state: true },
  reaction: { type: true, seq: true, key: true, userIds: true },
  voice_update: { type: true, seq: true, voice: true },
  join_request: { type: true, request: true },
  join_request_closed: { type: true, id: true, status: true },
  reopened: { type: true, room: true },
};
type Code<T extends RoomEvent["type"]> = Extract<RoomEvent, { type: T }> extends { code: infer C } ? C & string : never;
const CODES: { [K in "error" | "notice" | "ai_failed" | "assist_failed"]: Record<Code<K>, true> } = {
  error: { rate_limited: true, empty: true, bad_assist: true, bad_reply: true, bad_seq: true },
  notice: { ai_off: true, ai_busy: true, ai_quota: true, voice_off: true, voice_quota: true, translate_quota: true, retry_limit: true },
  ai_failed: { upstream: true, quota: true, restart: true },
  assist_failed: { upstream: true, quota: true, format: true },
};
const pyTuple = (name: string) => [...new RegExp(`^${name} = \\(([^)]*)\\)`, "m").exec(protocolPy)![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();

describe("rooms HTTP payloads (recorded from the real server) match the web types", () => {
  it("config, room, members, messages", () => {
    expect(wireKeys(C.http.config)).toEqual(keys(CONFIG));
    for (const name of ["create", "join", "patch", "detail", "close"]) expect(wireKeys(C.http[name].room), name).toEqual(keys(ROOM));
    // 「我的房间」rows add the learning-summary status (integration, spec §6.1 entry)
    for (const room of C.http.mine.rooms) expect(wireKeys(room)).toEqual([...keys(ROOM), "summaryStatus"].sort());
    for (const m of C.http.detail.members) expect(wireKeys(m)).toEqual(keys(MEMBER));
    for (const m of C.http.messages.messages) {
      expect(wireKeys(m)).toEqual(keys(MESSAGE));
      expect(wireKeys(m.sender)).toEqual(keys(SENDER));
    }
    expect(Object.keys(C.http.ticket)).toContain("ticket");
    for (const name of ["kick", "leave", "report"]) expect(C.http[name]).toEqual({ ok: true });
  });

  it("the API client functions read those payloads", async () => {
    const id: string = C.http.create.room.id;
    const r = `/api/rooms/${id}`;
    const mock = createFetchMock({
      "GET /api/rooms/config": () => json(C.http.config),
      "POST /api/rooms": () => json(C.http.create),
      "POST /api/rooms/join": () => json(C.http.join),
      "GET /api/rooms/mine": () => json(C.http.mine),
      [`GET ${r}`]: () => json(C.http.detail),
      [`GET ${r}/messages`]: () => json(C.http.messages),
      [`POST ${r}/ticket`]: () => json(C.http.ticket),
      [`PATCH ${r}`]: () => json(C.http.patch),
      [`POST ${r}/kick`]: () => json(C.http.kick),
      [`POST ${r}/leave`]: () => json(C.http.leave),
      [`POST ${r}/close`]: () => json(C.http.close),
      [`POST ${r}/messages/m1/report`]: () => json(C.http.report),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await fetchRoomsConfig(api)).maxText).toBe(C.http.config.max_text);
    expect((await createRoom(api, "美食")).myRole).toBe("owner");
    expect((await joinRoom(api, C.http.create.room.code)).myRole).toBe("member");
    expect((await myRooms(api))[0].id).toBe(id);
    const detail = await getRoom(api, id);
    expect(detail.members[0].userId).toBe(C.http.detail.members[0].user_id);
    const history = await roomHistory(api, id, 2_147_483_647);
    expect(history.map((m) => m.seq)).toEqual(C.http.messages.messages.map((m: { seq: number }) => m.seq));
    expect(await roomTicket(api, id)).toBe("<redacted>");
    expect((await updateRoom(api, id, { aiPublic: false })).aiPublic).toBe(false);
    expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ ai_public: false }); // server reads snake_case
    await kickMember(api, id, 7);
    expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ user_id: 7 });
    await leaveRoom(api, id);
    expect((await closeRoom(api, id)).status).toBe(C.http.close.room.status);
    await reportMessage(api, id, "m1", "spam");
    // (an unmatched route would have answered 404 and thrown above)
    expect(mock.calls.every((c) => !c.url.pathname.includes("undefined"))).toBe(true);
  });

  it("every server error string has a translation (except the unreachable bad-reason)", () => {
    const block = /ROOM_ERRORS[^{]*\{([\s\S]*?)\n\}/.exec(roomsPy)![1];
    const messages = [...block.matchAll(/\(\d{3}, "([^"]+)"\)/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(5);
    // Ruling: "Invalid reason" is unreachable from the web (the report sheet only offers spam/abuse/other) → generic error text.
    // Integration ruling: v2 errors (SC) are mapped by WC's ROOMS_V2_SERVER_ERRORS; v2 callers use the union.
    expect(messages.filter((m) => m !== "Invalid reason" && !(m in ROOMS_ALL_SERVER_ERRORS))).toEqual([]);
    expect(ROOMS_SERVER_ERRORS).toHaveProperty(["Rooms are disabled"]);
  });
});

describe("rooms WebSocket events (recorded from the real server) match the protocol mirror", () => {
  it("each recorded event parses and has exactly the mirrored keys", () => {
    for (const [name, raw] of Object.entries(C.ws)) {
      const event = parseRoomEvent(JSON.stringify(raw));
      expect(event, name).not.toBeNull();
      expect(Object.keys(event!).sort(), name).toEqual(keys(EVENTS[event!.type]));
    }
    expect(wireKeys(C.ws.welcome.room)).toEqual(keys(ROOM));
    for (const m of C.ws.welcome.members) expect(wireKeys(m)).toEqual(keys(MEMBER));
    for (const name of ["message_text", "message_system", "message_ai_answer", "assist_reply"]) {
      expect(wireKeys(C.ws[name].message), name).toEqual(keys(MESSAGE));
    }
    expect(Object.keys(camel(C.ws.assist_reply.message.meta)).sort()).toEqual(["glossary", "replyZh", "suggestions"]);
    // v2 (F2 re-recorded the session): every message carries quote / voice / reactions; welcome has the v2 keys
    expect(Object.keys(C.ws.message_text.message)).toEqual(expect.arrayContaining(["quote", "voice", "reactions"]));
    expect(C.ws.welcome).toMatchObject({ protocol: 2, reactions: [], join_requests: [] });
    expect(C.http.config.reactions).toEqual(["like", "love", "haha", "wow", "clap", "thanks"]);
  });

  it("the code enums equal protocol.py", () => {
    expect(keys(CODES.error)).toEqual(pyTuple("ERROR_CODES"));
    expect(keys(CODES.notice)).toEqual(pyTuple("NOTICE_CODES"));
    expect(keys(CODES.ai_failed)).toEqual(pyTuple("AI_FAILED_CODES"));
    expect(keys(CODES.assist_failed)).toEqual(pyTuple("ASSIST_FAILED_CODES"));
  });

  it("the reducer folds the recorded session into a sensible room state", () => {
    let s = initialRoomState();
    s = roomReducer(s, { type: "assist", requestId: "r1", text: "I like 巧克力" });
    s = roomReducer(s, { type: "say", pending: { clientId: "c1", text: "I like chocolate.", assistId: null, seq: null } });
    const order = ["welcome", "message_system", "assist_reply", "ack", "message_text", "ai_typing", "message_ai_answer", "presence", "room_update", "notice", "error", "pong"];
    for (const name of order) s = roomReducer(s, { type: "event", event: parseRoomEvent(JSON.stringify(C.ws[name]))! });
    expect(s.status).toBe("live");
    expect(s.pending).toEqual([]);
    expect(s.assist[0]).toMatchObject({ status: "done" });
    expect(s.messages.every((m) => m.lane === "public")).toBe(true);
    expect(s.aiTyping).toEqual([]);
    expect(s.room?.myRole).toBe("owner"); // room_update carries my_role=null; the reducer keeps ours
    expect(s.room?.aiPublic).toBe(false);
    s = roomReducer(s, { type: "event", event: parseRoomEvent(JSON.stringify(C.ws.closed))! });
    expect(s).toMatchObject({ status: "closed", closeReason: "owner" });
  });
});
