import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  encodeAssist, encodeHello, encodePing, encodeReact, encodeSay, encodeTyping, encodeVoiceRetry, encodeVoiceTranslate, isTerminalClose,
  mentionsAi, parseRoomEvent, REACTION_GLYPHS, REACTION_KEYS, ROOM_AGENTS, ROOM_CLOSE, ROOM_LIMITS, ROOM_NOTICE_VOICE_UNCLEAR, ROOM_PROTOCOL_VERSION, ROOM_SERVER_EVENT_TYPES, roomWsUrl,
} from "./protocol";

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

  it("say.to exists on the server model and the protocol version still matches (plan addressing-web R-AW2)", () => {
    const say = /class SayMsg\(_Msg\):([\s\S]*?)\nclass /.exec(server)![1];
    expect(say).toMatch(/\n\s+to: str \| None/);
    expect(pyInt("PROTOCOL_VERSION")).toBe(ROOM_PROTOCOL_VERSION);
  });

  it.each(mentions)("mentionsAi($text)", ({ text, ai, question }) => {
    expect(mentionsAi(text)).toEqual({ ai, question });
  });
});

describe("encoders and parser", () => {
  it("adds say.to only while an agent is addressed, clipped to an id", () => {
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi" })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: null })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: "  " })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", replyTo: 5, to: "builtin:coach" })!))
      .toEqual({ type: "say", client_id: "c", text: "hi", assist_id: null, reply_to: 5, to: "builtin:coach" });
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: "x".repeat(100) })!).to).toHaveLength(ROOM_LIMITS.id);
  });

  it("parses the unclear-voice notice and the optional tutor hint_zh", () => {
    expect(parseRoomEvent('{"type":"notice","code":"voice_unclear"}')).toEqual({ type: "notice", code: ROOM_NOTICE_VOICE_UNCLEAR });
    const e = parseRoomEvent(JSON.stringify({ type: "agent_tutor", tutor: { persona_id: "p", hint_zh: "想想过去式" } }));
    expect((e as { tutor: { hintZh?: string } }).tutor.hintZh).toBe("想想过去式");
  });

  it("encodes frames within limits", () => {
    expect(JSON.parse(encodeHello(7))).toEqual({ type: "hello", last_seq: 7, v: 2 });
    expect(JSON.parse(encodePing())).toEqual({ type: "ping" });
    expect(encodeSay({ clientId: "c", text: "   " })).toBeNull();
    expect(Array.from(JSON.parse(encodeSay({ clientId: "c", text: "😀".repeat(3000) })!).text)).toHaveLength(ROOM_LIMITS.sayRaw);
    expect(JSON.parse(encodeSay({ clientId: "c", text: " hi ", assistId: "a1" })!)).toEqual({ type: "say", client_id: "c", text: "hi", assist_id: "a1", reply_to: null });
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

describe("protocol v2", () => {
  it("mirrors the server constants", () => {
    expect(server).toContain(`PROTOCOL_VERSION = ${ROOM_PROTOCOL_VERSION}`);
    expect(server).toContain(`REACTION_KEYS = (${REACTION_KEYS.map((k) => `"${k}"`).join(", ")})`);
    expect(Object.keys(REACTION_GLYPHS)).toEqual([...REACTION_KEYS]);
    expect(server).toContain('ACTIVITY_STATES = ("typing", "recording", "idle")');
  });
  it("encodes the new client frames", () => {
    expect(encodeHello(3)).toBe('{"type":"hello","last_seq":3,"v":2}');
    expect(encodeSay({ clientId: "c", text: " hi ", replyTo: 5 })).toBe('{"type":"say","client_id":"c","text":"hi","assist_id":null,"reply_to":5}');
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", replyTo: 0 })!).reply_to).toBeNull(); // the server would reject it (ge=1)
    expect(encodeTyping("recording")).toBe('{"type":"typing","state":"recording"}');
    expect(encodeReact(4, "like", true)).toBe('{"type":"react","seq":4,"key":"like","on":true}');
    expect(encodeVoiceTranslate(4)).toBe('{"type":"voice_translate","seq":4}');
    expect(encodeVoiceRetry(4)).toBe('{"type":"voice_retry","seq":4}');
  });
  it("keeps reaction keys as values after camelcasing", () => {
    expect(parseRoomEvent('{"type":"reaction","seq":4,"key":"haha","user_ids":[1,2]}')).toEqual({ type: "reaction", seq: 4, key: "haha", userIds: [1, 2] });
    expect(parseRoomEvent('{"type":"voice_update","seq":4,"voice":{"duration_ms":6400,"status":"done","transcript":"Hi","lang":"en","translation":null,"translation_status":null,"attempts":1,"audio":true}}'))
      .toMatchObject({ type: "voice_update", voice: { durationMs: 6400, translationStatus: null } });
  });
});

describe("agents in rooms (plan 2026-10-12-agents-rooms)", () => {
  it("mirrors the server constants", () => {
    expect(pyInt("MAX_AGENTS")).toBe(ROOM_AGENTS.max);
    expect(pyInt("TUTOR_TURN_SECONDS")).toBe(ROOM_AGENTS.tutorTurnSeconds);
    expect(ROOM_SERVER_EVENT_TYPES.slice(-3)).toEqual(["agent_step", "agent_thought", "agent_tutor"]);
  });
  it("parses the private process frames with camelCased keys", () => {
    const ev = parseRoomEvent(JSON.stringify({ type: "agent_step", turn_id: "t1", reply_to: 4,
      step: { id: "s1", group: "context", key: "learned_words", status: "done", label_key: "agents.step.learned_words", params: { count: 6 }, ms: 12, private: true } }));
    expect(ev).toEqual({ type: "agent_step", turnId: "t1", replyTo: 4,
      step: { id: "s1", group: "context", key: "learned_words", status: "done", labelKey: "agents.step.learned_words", params: { count: 6 }, ms: 12, private: true } });
    expect(parseRoomEvent('{"type":"agent_tutor","tutor":null}')).toEqual({ type: "agent_tutor", tutor: null });
  });
});
