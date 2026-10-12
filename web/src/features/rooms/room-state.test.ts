import { describe, expect, it } from "vitest";
import { encodeSay, type RoomInfo, type RoomMessage, type VoiceInfo } from "./protocol";
import { initialRoomState, normalizeMessage, roomReducer, type RoomAction, type RoomState } from "./room-state";

const msg = (seq: number, over: Partial<RoomMessage> = {}): RoomMessage => ({
  seq, id: `m${seq}`, lane: "public", kind: "text", sender: { kind: "user", id: 1, name: "alice" }, text: `t${seq}`,
  assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "", quote: null, voice: null, reactions: [], ...over,
});
const ev = (event: object): RoomAction => ({ type: "event", event: event as never });
const run = (actions: RoomAction[], s: RoomState = initialRoomState()) => actions.reduce(roomReducer, s);

describe("roomReducer", () => {
  it("goes live on welcome and keeps public messages ordered and unique", () => {
    const s = run([
      ev({ type: "welcome", room: { id: "r" }, me: { userId: 1, role: "owner" }, members: [], lastSeq: 9, truncated: false, assistHistory: [] }),
      ev({ type: "message", message: msg(3) }), ev({ type: "message", message: msg(1) }), ev({ type: "message", message: msg(3) }),
      ev({ type: "message", message: msg(4, { lane: "private" }) }),
    ]);
    expect(s.status).toBe("live");
    expect(s.messages.map((m) => m.seq)).toEqual([1, 3]);
    expect(s.lastSeq).toBe(4);
  });

  it("marks a message hidden by an administrator and drops its text", () => {
    const s = run([
      ev({ type: "message", message: msg(1) }), ev({ type: "message", message: msg(2, { meta: { a: 1 } }) }),
      ev({ type: "message_hidden", seq: 2 }), ev({ type: "message_hidden", seq: 99 }),
    ]);
    expect(s.messages.map((m) => [m.seq, m.hidden ?? false, m.text, m.meta])).toEqual([[1, false, "t1", null], [2, true, "", null]]);
  });

  it("keeps a pending say until its own message arrives, without advancing the resume cursor on ack", () => {
    let s = run([{ type: "say", pending: { clientId: "c1", text: "hi", assistId: null, seq: null } }]);
    expect(s.pending).toHaveLength(1);
    s = run([ev({ type: "ack", clientId: "c1", seq: 5 })], s);
    expect(s.pending).toEqual([{ clientId: "c1", text: "hi", assistId: null, seq: 5 }]); // no frame without the bubble
    expect(s.lastSeq).toBe(0); // message 5 (and anything before it) has not been received yet
    s = run([ev({ type: "message", message: msg(4) }), ev({ type: "message", message: msg(5) })], s);
    expect(s.pending).toEqual([]);
    expect(s.lastSeq).toBe(5);
  });

  it("an ack for a message that already arrived (resend after reconnect) drops the pending bubble", () => {
    const s = run([
      { type: "say", pending: { clientId: "c1", text: "hi", assistId: null, seq: null } },
      ev({ type: "message", message: msg(7) }), ev({ type: "ack", clientId: "c1", seq: 7 }),
    ]);
    expect(s.pending).toEqual([]);
    expect(s.messages.map((m) => m.seq)).toEqual([7]);
  });

  it("a truncated replay restarts the list from the newest page and clears stale AI typing", () => {
    const welcome = (truncated: boolean) => ev({ type: "welcome", room: { id: "r" }, me: { userId: 1, role: "owner" }, members: [], lastSeq: 900, truncated, assistHistory: [] });
    let s = run([welcome(false), ev({ type: "message", message: msg(1) }), ev({ type: "message", message: msg(2, { aiStatus: "pending" }) }), ev({ type: "ai_typing", replyTo: 2 }),
      { type: "say", pending: { clientId: "c1", text: "hi", assistId: null, seq: null } }]);
    s = run([welcome(true), ev({ type: "message", message: msg(700) })], s);
    expect(s.messages.map((m) => m.seq)).toEqual([700]); // no silent gap between 2 and 700; "load earlier" pages back from 700
    expect(s.truncated).toBe(true);
    expect(s.pending).toHaveLength(1);
    expect(s.aiTyping).toEqual([]);
    s = run([welcome(false), ev({ type: "message", message: msg(701) })], s);
    expect(s.messages.map((m) => m.seq)).toEqual([700, 701]); // an untruncated replay merges
  });

  it("handles the @ai lifecycle", () => {
    let s = run([ev({ type: "message", message: msg(2, { aiStatus: "pending" }) }), ev({ type: "ai_typing", replyTo: 2 })]);
    expect(s.aiTyping).toEqual([2]);
    s = run([ev({ type: "message", message: msg(3, { kind: "ai_answer", sender: { kind: "ai", id: null, name: null }, replyTo: 2 }) })], s);
    expect(s.aiTyping).toEqual([]);
    expect(s.messages[0].aiStatus).toBe("done");
    s = run([ev({ type: "message", message: msg(4, { aiStatus: "pending" }) }), ev({ type: "ai_failed", replyTo: 4, code: "upstream" })], s);
    expect(s.messages.find((m) => m.seq === 4)?.aiStatus).toBe("failed");
  });

  it("pairs assistant requests with replies and failures", () => {
    let s = run([{ type: "assist", requestId: "r1", text: "I like 巧克力" }]);
    expect(s.assist[0]).toMatchObject({ status: "waiting", request: "I like 巧克力" });
    const reply = msg(6, { lane: "private", kind: "assist_reply", meta: { replyZh: "x", suggestions: [], glossary: [] } });
    s = run([ev({ type: "assist_reply", requestId: "r1", message: reply })], s);
    expect(s.assist[0]).toMatchObject({ status: "done", reply });
    s = run([{ type: "assist", requestId: "r2", text: "?" }, ev({ type: "assist_failed", requestId: "r2", code: "quota" })], s);
    expect(s.assist[1]).toMatchObject({ status: "failed", error: "quota" });
  });

  it("fills a waiting assistant request from a replayed private reply after a reconnect", () => {
    const reply = msg(8, { lane: "private", kind: "assist_reply" });
    let s = run([{ type: "assist", requestId: "r1", text: "q" }, ev({ type: "message", message: reply })]);
    expect(s.assist[0]).toMatchObject({ status: "done", reply });
    s = run([ev({ type: "assist_reply", requestId: "r1", message: reply }), ev({ type: "message", message: reply })], s);
    expect(s.assist).toHaveLength(1);
    expect(s.messages).toEqual([]);
  });

  it("rebuilds assistant history from welcome", () => {
    const history = [msg(1, { lane: "private", kind: "assist_request", text: "q" }), msg(2, { lane: "private", kind: "assist_reply", text: "a" })];
    const s = run([ev({ type: "welcome", room: { id: "r" }, me: { userId: 1, role: "member" }, members: [], lastSeq: 2, truncated: true, assistHistory: history })]);
    expect(s.assist).toEqual([{ requestId: null, request: "q", reply: history[1], status: "done", error: null }]);
    expect(s.truncated).toBe(true);
  });

  it("records notices, errors, closes and earlier pages", () => {
    let s = run([ev({ type: "notice", code: "ai_off" }), ev({ type: "error", code: "rate_limited" })]);
    expect([s.notice, s.error]).toEqual(["ai_off", "rate_limited"]);
    s = run([{ type: "dismiss" }, ev({ type: "closed", reason: "owner" })], s);
    expect([s.notice, s.error, s.status, s.closeReason]).toEqual([null, null, "closed", "owner"]);
    s = run([ev({ type: "message", message: msg(10) }), { type: "prepend", messages: [msg(8), msg(9)] }], s);
    expect(s.messages.map((m) => m.seq)).toEqual([8, 9, 10]);
    expect(run([{ type: "status", status: "reconnecting" }], s).status).toBe("closed"); // closed is final
  });

  it("keeps my role across room updates and tracks whether earlier pages remain", () => {
    let s = run([
      ev({ type: "welcome", room: { id: "r", myRole: "owner", locked: false }, me: { userId: 1, role: "owner" }, members: [], lastSeq: 0, truncated: true, assistHistory: [] }),
      ev({ type: "room_update", room: { id: "r", myRole: null, locked: true } }),
    ]);
    expect(s.room).toMatchObject({ myRole: "owner", locked: true });
    s = run([{ type: "prepend", messages: [msg(1)], more: false }], s);
    expect(s.truncated).toBe(false);
  });

  it("opens an ended room as read-only history", () => {
    const room = { id: "r", status: "closed" } as never;
    const s = run([
      { type: "status", status: "closed", reason: "not_found" },
      { type: "history", room, members: [{ userId: 1, name: "alice", role: "owner", online: false }], meId: 1, messages: [msg(2), msg(3, { lane: "private" })], more: true },
    ]);
    expect(s).toMatchObject({ status: "closed", closeReason: "ended", room, me: { userId: 1, role: "owner" }, truncated: true, lastSeq: 3 });
    expect(s.messages.map((m) => m.seq)).toEqual([2]);
  });
});

const ROOM_INFO = { id: "r1" } as RoomInfo;
const voiceMsg = (seq: number, voice: Partial<VoiceInfo>) => msg(seq, { text: "", kind: "voice",
  voice: { durationMs: 6400, status: "pending", transcript: null, lang: null, translation: null, translationStatus: null, attempts: 0, audio: true, ...voice } });

describe("roomReducer v2", () => {
  it("tracks activity with injected time and expires it", () => {
    let s = roomReducer(initialRoomState(), { type: "event", event: { type: "activity", userId: 22, state: "recording" }, at: 1_000 });
    expect(s.activity[22]).toEqual({ state: "recording", at: 1_000 });
    s = roomReducer(s, { type: "event", event: { type: "activity", userId: 22, state: "idle" }, at: 2_000 });
    expect(s.activity[22]).toBeUndefined();
    s = roomReducer(s, { type: "event", event: { type: "activity", userId: 33, state: "typing" }, at: 3_000 });
    expect(roomReducer(s, { type: "activity_expire", now: 8_000 }).activity[33]).toBeDefined();
    expect(roomReducer(s, { type: "activity_expire", now: 9_001 }).activity).toEqual({});
  });
  it("applies reactions and voice updates by seq", () => {
    let s = roomReducer(initialRoomState(), { type: "event", event: { type: "message", message: voiceMsg(5, {}) } });
    s = roomReducer(s, { type: "event", event: { type: "reaction", seq: 5, key: "like", userIds: [1, 2] } });
    expect(s.messages[0].reactions).toEqual([{ key: "like", userIds: [1, 2] }]);
    s = roomReducer(s, { type: "event", event: { type: "reaction", seq: 99, key: "like", userIds: [1] } }); // unknown seq: ignored
    s = roomReducer(s, { type: "event", event: { type: "reaction", seq: 5, key: "like", userIds: [] } });
    expect(s.messages[0].reactions).toEqual([]);
    s = roomReducer(s, { type: "event", event: { type: "voice_update", seq: 5, voice: { ...s.messages[0].voice!, status: "done", transcript: "Hi there", lang: "en" } } });
    expect(s.messages[0].voice?.status).toBe("done");
    expect(s.messages[0].text).toBe("Hi there");
  });
  it("keeps the owner's join requests in sync", () => {
    const req = { id: "q1", roomId: "r1", roomName: "美食", userId: 3, name: "carol", status: "pending" as const, createdAt: "" };
    let s = roomReducer(initialRoomState(), { type: "event", event: { type: "join_request", request: req } });
    s = roomReducer(s, { type: "event", event: { type: "join_request", request: req } });
    expect(s.joinRequests).toHaveLength(1);
    s = roomReducer(s, { type: "event", event: { type: "join_request_closed", id: "q1", status: "approved" } });
    expect(s.joinRequests).toEqual([]);
  });
  it("welcome refreshes reactions for the last 200 seqs", () => {
    let s = roomReducer(initialRoomState(), { type: "event", event: { type: "message", message: msg(9, { reactions: [{ key: "wow", userIds: [7] }] }) } });
    s = roomReducer(s, { type: "event", event: { type: "message", message: msg(10) } });
    s = roomReducer(s, { type: "event", event: { type: "welcome", room: ROOM_INFO, me: { userId: 1, role: "owner" }, members: [], lastSeq: 10, truncated: false,
      assistHistory: [], protocol: 2, reactions: [{ seq: 10, key: "clap", userIds: [3] }], joinRequests: [] } });
    expect(s.messages.map((m) => m.reactions)).toEqual([[], [{ key: "clap", userIds: [3] }]]);
    expect(s.protocol).toBe(2);
  });
  it("hiding a message clears its v2 fields and the quotes of it", () => {
    let s = roomReducer(initialRoomState(), { type: "event", event: { type: "message", message: msg(1, { reactions: [{ key: "like", userIds: [1] }] }) } });
    s = roomReducer(s, { type: "event", event: { type: "message", message: msg(2, { replyTo: 1, quote: { seq: 1, name: "alice", kind: "text", text: "t1" } }) } });
    s = roomReducer(s, { type: "event", event: { type: "message_hidden", seq: 1 } });
    expect(s.messages[0]).toMatchObject({ hidden: true, quote: null, voice: null, reactions: [] });
    expect(s.messages[1].quote).toEqual({ seq: 1, name: "alice", kind: "text", text: "" });
  });
  it("fills v2 fields a v1 server does not send", () => {
    const { quote: _q, voice: _v, reactions: _r, ...v1 } = msg(3);
    expect(normalizeMessage(v1 as RoomMessage)).toMatchObject({ quote: null, voice: null, reactions: [] });
    const s = roomReducer(initialRoomState(), { type: "event", event: { type: "message", message: v1 as RoomMessage } });
    expect(s.messages[0].reactions).toEqual([]);
  });

  it("merges an own HTTP voice upload without advancing the resume cursor (review M2)", () => {
    let s = run([ev({ type: "message", message: msg(3) })]);
    s = run([{ type: "local_message", message: msg(7, { kind: "voice", sender: { kind: "user", id: 1, name: "alice" } }) }], s);
    expect(s.messages.map((m) => m.seq)).toEqual([3, 7]);
    expect(s.lastSeq).toBe(3); // 4..6 have not been received: a reconnect hello must still ask for them
    expect(s.announce?.seq).not.toBe(7); // not read out as a live message
    s = run([ev({ type: "message", message: msg(5) }), ev({ type: "message", message: msg(7) })], s);
    expect(s.lastSeq).toBe(7);
  });

  it("reconciles voice state fetched after a reconnect without adding messages (review M1)", () => {
    const pending: VoiceInfo = { durationMs: 2000, status: "pending", transcript: null, lang: null, translation: null,
      translationStatus: null, attempts: 1, audio: true };
    const done: VoiceInfo = { ...pending, status: "done", transcript: "Hello there.", lang: "en", translation: "你好。", translationStatus: "done" };
    let s = run([ev({ type: "message", message: msg(2, { kind: "voice", text: "", voice: pending }) }), ev({ type: "message", message: msg(4) })]);
    s = run([{ type: "voice_sync", messages: [msg(1), msg(2, { kind: "voice", text: "Hello there.", voice: done }), msg(3)] }], s);
    expect(s.messages.map((m) => m.seq)).toEqual([2, 4]);
    expect(s.messages[0].voice).toEqual(done);
    expect(s.messages[0].text).toBe("Hello there.");
  });

  it("follows an ownership transfer from presence and room updates (review m8)", () => {
    let s = run([ev({ type: "welcome", room: { id: "r", ownerId: 1, myRole: "member" }, me: { userId: 2, role: "member" }, members: [],
      lastSeq: 0, truncated: false, assistHistory: [] })]);
    s = run([ev({ type: "presence", members: [{ userId: 2, name: "lily", role: "owner", online: true }] })], s);
    expect(s.me?.role).toBe("owner");
    s = run([ev({ type: "room_update", room: { id: "r", ownerId: 2, myRole: null } })], s);
    expect(s.room?.myRole).toBe("owner");
  });
});

describe("reopened rooms (R-O3)", () => {
  const closed = roomReducer(initialRoomState(), { type: "event", event: { type: "closed", reason: "owner" } });
  it("a reopened event updates the room and raises the reconnect signal once per event", () => {
    const room = { ...ROOM_INFO, status: "open" as const, code: "573920", closeReason: null as string | null };
    const next = roomReducer(closed, { type: "event", event: { type: "reopened", room } });
    expect(next.room?.code).toBe("573920");
    expect(next.reopenSignal).toBe(closed.reopenSignal + 1);
    expect(next.status).toBe("closed"); // the hook resets and reconnects; the reducer does not pretend to be live
  });
  it("reset returns to a fresh connecting state but keeps the signal counter (no reconnect loop)", () => {
    const signalled = roomReducer(closed, { type: "event", event: { type: "reopened", room: { ...ROOM_INFO, status: "open" } } });
    const reset = roomReducer(signalled, { type: "reset" });
    expect(reset.status).toBe("connecting");
    expect(reset.closeReason).toBeNull();
    expect(reset.messages).toEqual([]);
    expect(reset.lastSeq).toBe(0);
    expect(reset.reopenSignal).toBe(signalled.reopenSignal);
  });
});

it("keeps say.to on the pending entry so the resend after a reconnect still addresses the agent", () => {
  const s = roomReducer(initialRoomState(), { type: "say", pending: { clientId: "c1", text: "hi", assistId: null, seq: null, replyTo: null, to: "builtin:coach" } });
  expect(JSON.parse(encodeSay(s.pending[0])!).to).toBe("builtin:coach");
  const plain = roomReducer(initialRoomState(), { type: "say", pending: { clientId: "c2", text: "hi", assistId: null, seq: null } });
  expect(JSON.parse(encodeSay(plain.pending[0])!)).not.toHaveProperty("to");
});
