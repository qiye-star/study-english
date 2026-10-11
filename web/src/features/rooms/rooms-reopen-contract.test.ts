import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseRoomEvent, type RoomEvent, type RoomInfo } from "./protocol";
import { initialRoomState, roomReducer } from "./room-state";
import type { EndedPage } from "./rooms-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../server");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: { http: Record<string, any>; ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "tests/fixtures/rooms_reopen_contract.json"), "utf8"));
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const wireKeys = (v: unknown) => Object.keys(camel(v)).sort();

const ROOM: Record<keyof RoomInfo, true> = { id: true, code: true, topic: true, status: true, locked: true, aiPublic: true, aiMuted: true, ownerId: true,
  myRole: true, memberCount: true, onlineCount: true, createdAt: true, closedAt: true, closeReason: true,
  name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true };
const ENDED_PAGE: Record<keyof EndedPage, true> = { rooms: true, nextCursor: true };

describe("reopen payloads (recorded from the real server) match the web types", () => {
  it("ended list rows and the page", () => {
    expect(wireKeys(C.http.ended)).toEqual(keys(ENDED_PAGE));
    expect(C.http.ended.rooms.length).toBeGreaterThan(0);
    for (const room of C.http.ended.rooms) expect(wireKeys(room)).toEqual([...keys(ROOM), "summaryStatus"].sort());
  });
  it("reopen response and the lobby overview", () => {
    expect(wireKeys(C.http.reopen.room)).toEqual(keys(ROOM));
    expect(wireKeys(C.http.mine)).toEqual(["endedCount", "rooms"]);
  });
  it("the reopened event parses and drives the reducer", () => {
    expect(wireKeys(C.ws.reopened)).toEqual(["room", "type"]);
    expect(wireKeys(C.ws.reopened.room)).toEqual(keys(ROOM));
    const event = parseRoomEvent(JSON.stringify(C.ws.reopened)) as Extract<RoomEvent, { type: "reopened" }>;
    expect(event.type).toBe("reopened");
    expect(roomReducer(initialRoomState(), { type: "event", event }).reopenSignal).toBe(1);
  });
  it("the system message that follows is the reopened key", () => {
    expect(C.ws.message_system.message.text).toBe("reopened");
  });
});
