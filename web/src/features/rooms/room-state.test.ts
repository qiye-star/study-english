import { describe, expect, it } from "vitest";
import type { RoomMessage } from "./protocol";
import { initialRoomState, roomReducer, type RoomAction, type RoomState } from "./room-state";

const msg = (seq: number, over: Partial<RoomMessage> = {}): RoomMessage => ({
  seq, id: `m${seq}`, lane: "public", kind: "text", sender: { kind: "user", id: 1, name: "alice" }, text: `t${seq}`,
  assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "", ...over,
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
