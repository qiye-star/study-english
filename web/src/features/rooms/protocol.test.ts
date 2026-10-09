import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { encodeAssist, encodeHello, encodePing, encodeSay, isTerminalClose, mentionsAi, parseRoomEvent, ROOM_CLOSE, ROOM_LIMITS, ROOM_SERVER_EVENT_TYPES, roomWsUrl } from "./protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = readFileSync(path.resolve(here, "../../../../server/app/rooms/protocol.py"), "utf8");
const mentions = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/room_mentions.json"), "utf8")) as { text: string; ai: boolean; question: string }[];
const pyInt = (name: string) => Number(new RegExp(`^${name} = ([\\d_]+)`, "m").exec(server)![1].replace(/_/g, ""));

describe("room protocol mirrors server/app/rooms/protocol.py", () => {
  it("close codes and limits", () => {
    for (const [key, code] of Object.entries(ROOM_CLOSE)) expect(pyInt(`CLOSE_${key}`)).toBe(code);
    expect([pyInt("MAX_CLIENT_TEXT"), pyInt("MAX_SAY_RAW"), pyInt("MAX_ASSIST_TEXT"), pyInt("MAX_ID")])
      .toEqual([ROOM_LIMITS.clientText, ROOM_LIMITS.sayRaw, ROOM_LIMITS.assistText, ROOM_LIMITS.id]);
  });

  it("server event types", () => {
    const tuple = /SERVER_EVENT_TYPES = \(([\s\S]*?)\)/.exec(server)![1];
    expect([...tuple.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...ROOM_SERVER_EVENT_TYPES]);
  });

  it.each(mentions)("mentionsAi($text)", ({ text, ai, question }) => {
    expect(mentionsAi(text)).toEqual({ ai, question });
  });
});

describe("encoders and parser", () => {
  it("encodes frames within limits", () => {
    expect(JSON.parse(encodeHello(7))).toEqual({ type: "hello", last_seq: 7 });
    expect(JSON.parse(encodePing())).toEqual({ type: "ping" });
    expect(encodeSay({ clientId: "c", text: "   " })).toBeNull();
    expect(Array.from(JSON.parse(encodeSay({ clientId: "c", text: "😀".repeat(3000) })!).text)).toHaveLength(ROOM_LIMITS.sayRaw);
    expect(JSON.parse(encodeSay({ clientId: "c", text: " hi ", assistId: "a1" })!)).toEqual({ type: "say", client_id: "c", text: "hi", assist_id: "a1" });
    expect(Array.from(JSON.parse(encodeAssist({ requestId: "r", text: "巧".repeat(900) })!).text)).toHaveLength(500);
    expect(encodeAssist({ requestId: "r", text: " " })).toBeNull();
  });

  it("parses and camelCases events, rejecting unknown types", () => {
    const ev = parseRoomEvent(JSON.stringify({ type: "assist_reply", request_id: "r", message: { seq: 3, meta: { reply_zh: "x", suggestions: [{ en: "a", note_zh: "b" }] } } }));
    expect(ev).toMatchObject({ type: "assist_reply", requestId: "r", message: { seq: 3, meta: { replyZh: "x", suggestions: [{ noteZh: "b" }] } } });
    expect(parseRoomEvent('{"type":"nope"}')).toBeNull();
    expect(parseRoomEvent("garbage")).toBeNull();
    expect(parseRoomEvent("[1]")).toBeNull();
  });

  it("knows which closes are final", () => {
    expect([4003, 4004, 4010, 4400].every(isTerminalClose)).toBe(true);
    expect([1000, 1006, 1012, 4001, 4029].some(isTerminalClose)).toBe(false);
  });

  it("builds the socket url on the page origin", () => {
    expect(roomWsUrl("a b", { protocol: "https:", host: "x.test" })).toBe("wss://x.test/api/rooms/ws?ticket=a%20b");
    expect(roomWsUrl("t", { protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/api/rooms/ws?ticket=t");
  });
});
