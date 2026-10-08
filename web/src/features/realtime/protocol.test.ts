import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLOSE, CLOSE_REASONS, CONTROL_TYPES, START_LIMITS, StartPayloadError, closeErrorKey, encodeControl, encodeStart, encodeUserText, parseServerEvent, splitAudioFrame } from "./protocol";

const SERVER_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../server/app/realtime/realtime_protocol.py");

describe("contract with server/app/realtime/realtime_protocol.py", () => {
  // 两端已合并:服务端文件缺失(改名/移动)必须让契约测试失败,而不是静默跳过
  it("can read the server protocol file", () => {
    expect(existsSync(SERVER_FILE)).toBe(true);
  });
  const py = () => readFileSync(SERVER_FILE, "utf8");
  const serverCodes = () => Object.fromEntries([...py().matchAll(/^CLOSE_([A-Z_]+) = (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));

  it("has exactly the server's close codes", () => {
    expect(CLOSE).toEqual(serverCodes());
  });

  it("has exactly the server's close reasons", () => {
    const codes = serverCodes();
    const block = py().match(/^CLOSE_REASONS[^{]*\{([\s\S]*?)^\}/m)?.[1] ?? "";
    const server = Object.fromEntries([...block.matchAll(/CLOSE_([A-Z_]+): "([a-z_]+)"/g)].map((m) => [codes[m[1]], m[2]]));
    expect(Object.keys(server).length).toBeGreaterThan(0);
    expect(CLOSE_REASONS).toEqual(server);
  });

  it("sends exactly the fields of StartMsg (extra=forbid: any other key is a 4400 close)", () => {
    const body = py().match(/^class StartMsg\(_Msg\):\r?\n([\s\S]*?)(?=^\S)/m)?.[1] ?? "";
    const fields = [...body.matchAll(/^ {4}([a-z_]+):/gm)].map((m) => m[1]).sort();
    expect(fields.length).toBeGreaterThan(0);
    const sent = Object.keys(JSON.parse(encodeStart({ systemPrompt: "", model: "", temperature: 0.7, voice: "v_1x", saveRecordings: false }))).sort();
    expect(sent).toEqual(fields);
  });

  it("uses the server's size limits", () => {
    const num = (name: string) => Number(py().match(new RegExp(`^${name} = ([\\d_]+)\\r?$`, "m"))?.[1].replace(/_/g, ""));
    expect(START_LIMITS.systemPrompt).toBe(num("MAX_SYSTEM_PROMPT"));
    expect(START_LIMITS.clientText).toBe(num("MAX_CLIENT_TEXT"));
    expect(START_LIMITS.userText).toBe(num("MAX_USER_TEXT"));
    expect(py()).toContain(`model: str = Field("", max_length=${START_LIMITS.model})`);
    expect(py()).toContain(`voice: str = Field(pattern=r"${START_LIMITS.voice.source}")`);
  });

  it("every control message the client sends is a message type the server accepts", () => {
    const serverTypes = [...py().matchAll(/^ {4}type: Literal\["([a-z_]+)"\]/gm)].map((m) => m[1]);
    for (const type of CONTROL_TYPES) {
      expect(serverTypes).toContain(type);
      expect(JSON.parse(encodeControl(type))).toEqual({ type });
    }
    expect(CONTROL_TYPES).toContain("utterance_cancel");
  });

  it("user_text sends exactly the fields of UserTextMsg, with the server's bounds", () => {
    const body = py().match(/^class UserTextMsg\(_Msg\):\r?\n([\s\S]*?)(?=^\S)/m)?.[1] ?? "";
    const fields = [...body.matchAll(/^ {4}([a-z_]+):/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual(["text", "type"]);
    expect(body).toContain('type: Literal["user_text"]');
    expect(body).toContain("text: str = Field(min_length=1, max_length=MAX_USER_TEXT)");
    expect(Object.keys(JSON.parse(encodeUserText("hi")!)).sort()).toEqual(fields);
  });

  it("maps close codes to translatable keys", () => {
    expect(closeErrorKey(1000)).toBeNull();
    expect(closeErrorKey(4008)).toBe("web.realtime.errors.idle_timeout");
    expect(closeErrorKey(1006)).toBe("web.realtime.errors.generic");
  });
});

describe("encodeStart stays inside the server's limits (never a 4400 for oversize)", () => {
  const base = { systemPrompt: "", model: "m", temperature: 0.7, voice: "v_1x", saveRecordings: false };
  const cp = (s: string) => Array.from(s).length;

  it("clamps the system prompt to 8000 characters without splitting a surrogate pair", () => {
    const msg = JSON.parse(encodeStart({ ...base, systemPrompt: "😀".repeat(9000) }));
    expect(cp(msg.system_prompt)).toBe(8000);
    expect(msg.system_prompt).toBe("😀".repeat(8000));
  });

  it("keeps the whole message within MAX_CLIENT_TEXT even when the prompt escapes badly", () => {
    const text = encodeStart({ ...base, systemPrompt: "\u0001".repeat(8000) }); // 每个都转义成 6 个字符
    expect(cp(text)).toBeLessThanOrEqual(START_LIMITS.clientText);
    expect(cp(text)).toBeGreaterThan(START_LIMITS.clientText - 10);
    const prompt: string = JSON.parse(text).system_prompt;
    expect(prompt).toBe("\u0001".repeat(prompt.length));
  });

  it("drops an over-long model name (server default) and clamps the temperature", () => {
    const msg = JSON.parse(encodeStart({ ...base, model: "x".repeat(201), temperature: 5 }));
    expect(msg.model).toBe("");
    expect(msg.temperature).toBe(2);
    expect(JSON.parse(encodeStart({ ...base, temperature: Number.NaN })).temperature).toBe(0.7);
    expect(JSON.parse(encodeStart({ ...base, temperature: -1 })).temperature).toBe(0);
  });

  it("replaces unpaired surrogates with U+FFFD (the server rejects them with 4400), keeping real pairs", () => {
    const text = encodeStart({ ...base, systemPrompt: "a\ud800b\udc00c😀d\ud83d", model: "m\udfff" });
    expect(text).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i); // JSON.stringify 把孤立代理写成 \udXXX 转义
    const msg = JSON.parse(text);
    expect(msg.system_prompt).toBe("a�b�c😀d�");
    expect(msg.model).toBe("m�");
  });

  it("rejects a voice the server would refuse", () => {
    expect(() => encodeStart({ ...base, voice: "a b" })).toThrow(StartPayloadError);
    expect(() => encodeStart({ ...base, voice: "ab" })).toThrow(StartPayloadError);
  });
});

describe("messages", () => {
  it("encodes start in snake_case and control messages", () => {
    expect(JSON.parse(encodeStart({ systemPrompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", saveRecordings: true }))).toEqual({
      type: "start", system_prompt: "Hi", model: "m", temperature: 0.5, voice: "v_1x", language: "en", save_recordings: true,
    });
    expect(encodeControl("interrupt")).toBe('{"type":"interrupt"}');
  });

  it("encodes user_text trimmed, well-formed and within MAX_USER_TEXT; blank text is not sent", () => {
    expect(JSON.parse(encodeUserText("  A latte, please. ")!)).toEqual({ type: "user_text", text: "A latte, please." });
    expect(encodeUserText("   ")).toBeNull();
    expect(encodeUserText("")).toBeNull();
    const long = JSON.parse(encodeUserText("😀".repeat(START_LIMITS.userText + 5))!).text as string;
    expect(Array.from(long)).toHaveLength(START_LIMITS.userText); // 按码点截,不拆代理对
    expect(JSON.parse(encodeUserText("a\uD800b")!).text).toBe("a�b");
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
