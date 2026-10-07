import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOSE, CLOSE_REASONS, closeErrorKey, encodeControl, encodeStart, parseServerEvent, splitAudioFrame } from "./protocol";

const SERVER_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../server/app/realtime_protocol.py");

describe("contract with server/app/realtime_protocol.py", () => {
  const present = existsSync(SERVER_FILE);
  if (!present) console.warn(`[protocol.test] SKIPPED server cross-check: ${SERVER_FILE} is absent in this branch; it runs after the server lane is merged.`);

  it.skipIf(!present)("has exactly the server's close codes", () => {
    const py = readFileSync(SERVER_FILE, "utf8");
    const server = Object.fromEntries([...py.matchAll(/^CLOSE_([A-Z_]+) = (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
    expect(CLOSE).toEqual(server);
  });

  it("has the contract's close reasons", () => {
    expect(CLOSE_REASONS).toEqual({
      1000: "normal", 4001: "unauthorized", 4003: "disabled", 4004: "not_found", 4008: "idle_timeout",
      4009: "max_duration", 4013: "message_limit", 4029: "busy", 4400: "protocol", 4502: "upstream",
    });
  });

  it("maps close codes to translatable keys", () => {
    expect(closeErrorKey(1000)).toBeNull();
    expect(closeErrorKey(4008)).toBe("web.realtime.errors.idle_timeout");
    expect(closeErrorKey(1006)).toBe("web.realtime.errors.generic");
  });
});

describe("messages", () => {
  it("encodes start in snake_case and control messages", () => {
    expect(JSON.parse(encodeStart({ systemPrompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", saveRecordings: true }))).toEqual({
      type: "start", system_prompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", language: "en", save_recordings: true,
    });
    expect(encodeControl("interrupt")).toBe('{"type":"interrupt"}');
  });

  it("parses server events into camelCase and rejects unknown ones", () => {
    expect(parseServerEvent('{"type":"transcript_final","text":"hi","message_id":"m1"}')).toEqual({ type: "transcript_final", text: "hi", messageId: "m1" });
    expect(parseServerEvent('{"type":"reply_done","turn_id":2,"message_id":null,"interrupted":true}')).toEqual({ type: "reply_done", turnId: 2, messageId: null, interrupted: true });
    expect(parseServerEvent('{"type":"assessment","message_id":"m1","status":"done","result":{"pronunciation_score":81}}'))
      .toMatchObject({ result: { pronunciationScore: 81 } });
    expect(parseServerEvent('{"type":"party"}')).toBeNull();
    expect(parseServerEvent("nope")).toBeNull();
  });

  it("splits binary audio frames", () => {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, 7);
    view.setInt16(4, 1000, true);
    view.setInt16(6, -1000, true);
    const frame = splitAudioFrame(buf)!;
    expect(frame.turnId).toBe(7);
    expect(Array.from(frame.pcm)).toEqual([1000, -1000]);
    expect(splitAudioFrame(new ArrayBuffer(3))).toBeNull();
    expect(splitAudioFrame(new ArrayBuffer(7))).toBeNull();
  });
});
