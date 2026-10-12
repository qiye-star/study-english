import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { normalizeConfig } from "./agents-api";
import { createAgentSseParser, parseTurnEvent } from "./sse";
import { normalizeTrace } from "./trace";
import type { AgentSettings, AgentStep, AgentTrace, AgentsConfigWire, Persona, TurnEvent } from "./types";

/**
 * 跨计划契约(spec §11.3):A1 用真实应用 + 假 LLM 录制 agents_contract.json(CONTRACT_UPDATE=1 重录)。
 * 这里按名读取并逐键核对 web 的类型;键名若与 A1 不同,只改下面 FIXTURE 一处。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<string, any> = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/agents_contract.json"), "utf8"));
const FIXTURE = {
  config: "config", personas: "personas", persona: "persona_created", settings: "settings",
  turnSse: "turn_sse", turnErrorSse: "turn_error_sse", message: "message_with_trace", tryLine: "persona_try", report: "persona_report",
} as const;

const keys = (r: Record<string, true>) => Object.keys(r).sort();
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keysOf = (v: unknown) => Object.keys(camel(v)).sort();
type Recorded = Array<{ event: string; data: unknown }>;
/** 录制的事件数组 → SSE 文本(与服务端 to_sse 同形),再走真实解析器。 */
const toSse = (list: Recorded) => list.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
const events = (body: string): TurnEvent[] => {
  const out: TurnEvent[] = [];
  const parser = createAgentSseParser((raw) => { const e = parseTurnEvent(raw); if (e) out.push(e); });
  parser.push(body);
  parser.flush();
  return out;
};

const PERSONA: Record<keyof Persona, true> = { id: true, builtin: true, mine: true, name: true, intro: true, prompt: true, level: true, style: true, voice: true,
  tools: true, promptPublic: true, deepThink: true, disabled: true, createdAt: true, updatedAt: true };
const SETTINGS: Record<keyof AgentSettings, true> = { tools: true, memoryEnabled: true, shareInRooms: true, showProcess: true, defaultPersonaId: true, tutor: true, processDefault: true, zhNote: true };
const CONFIG_WIRE: Record<keyof AgentsConfigWire, true> = { enabled: true, available: true, tutor: true, memory: true, rooms: true, toolsMode: true, limits: true, levels: true, styles: true, tools: true };
const STEP: Record<keyof AgentStep, true> = { id: true, group: true, key: true, status: true, labelKey: true, params: true, ms: true, private: true };
const TRACE: Record<keyof AgentTrace, true> = { v: true, ms: true, steps: true, thought: true, noteZh: true };
const OPTIONAL_TRACE = ["noteZh"];
const requiredTrace = (list: string[]) => list.filter((k) => !OPTIONAL_TRACE.includes(k)).sort();
const OPTIONAL_STEP = ["params", "ms"];

describe("agents contract (server/tests/fixtures/agents_contract.json)", () => {
  it("has every recording this lane reads", () => {
    expect(Object.values(FIXTURE).filter((k) => !(k in C))).toEqual([]);
  });

  it("REST payloads match the web types key by key", () => {
    expect(keysOf(C[FIXTURE.config])).toEqual(keys(CONFIG_WIRE));
    expect(normalizeConfig(camel(C[FIXTURE.config]) as unknown as AgentsConfigWire)).toMatchObject({
      enabled: true, available: true, tutorEnabled: true, memoryEnabled: true, roomsEnabled: false, promptMaxChars: 800, personasMax: 10,
    });
    expect(normalizeConfig(camel(C.config_off) as unknown as AgentsConfigWire).enabled).toBe(false);
    expect(keysOf(C[FIXTURE.persona])).toEqual(keys(PERSONA));
    for (const p of C[FIXTURE.personas]) expect(keysOf(p)).toEqual(keys(PERSONA));
    expect(C[FIXTURE.personas].some((p: { id: string }) => p.id.startsWith("builtin:"))).toBe(true);
    expect(keysOf(C[FIXTURE.settings])).toEqual(keys(SETTINGS));
    expect(Object.keys(C[FIXTURE.settings].tools).sort()).toEqual(["due_words", "learned_words", "lookup", "memory", "weak_words"]);
    expect(Object.values(C[FIXTURE.settings].tools).every((v) => v === true)).toBe(true); // D2:默认全开
    expect(C[FIXTURE.settings].zh_note).toBe("auto"); // spec addressing §5.1 默认 auto
    expect(C[FIXTURE.persona].prompt_public).toBe(true); // D3:默认公开
    expect(typeof C[FIXTURE.tryLine].text).toBe("string");
    expect(C[FIXTURE.report].ok).toBe(true);
  });

  it("the recorded turn parses into the event types of spec §4.4 with the web's step and trace shapes", () => {
    const list = events(toSse(C[FIXTURE.turnSse]));
    const types = list.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("step");
    expect(types).toContain("thought");
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
    expect(list.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("Hello there.");
    for (const rec of (C[FIXTURE.turnSse] as Recorded).filter((e) => e.event === "step")) {
      const k = keysOf(rec.data).filter((x) => !OPTIONAL_STEP.includes(x));
      expect(k).toEqual(keys(STEP).filter((x) => !OPTIONAL_STEP.includes(x)));
    }
    const steps = list.filter((e): e is Extract<TurnEvent, { type: "step" }> => e.type === "step");
    expect(steps.length).toBe((C[FIXTURE.turnSse] as Recorded).filter((e) => e.event === "step").length); // none dropped
    const done = list.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.textLen).toBe(12);
    expect(done.trace).not.toBeNull();
    expect(requiredTrace(Object.keys(done.trace!))).toEqual(requiredTrace(keys(TRACE)));
    expect(done.trace!.steps.length).toBeGreaterThan(0);
    expect(done.trace!.steps.every((s) => s.labelKey.startsWith("agents.step."))).toBe(true);
    expect(done.trace!.thought).toEqual({ source: "reasoning", text: "Thinking about tense." });
    const raw = (C[FIXTURE.turnSse] as Recorded).at(-1)!.data as { trace: unknown };
    expect(JSON.stringify(raw.trace).length).toBeLessThanOrEqual(4096);
  });

  it("an error event carries only a code", () => {
    const list = C[FIXTURE.turnErrorSse] as Recorded;
    const err = list.find((e) => e.event === "error")!;
    expect(Object.keys(err.data as object)).toEqual(["code"]);
    expect(events(toSse(list)).at(-1)).toEqual({ type: "error", code: "limit" });
  });

  it("stored assistant messages carry agent_trace that normalizes to the trace shape", () => {
    const stored = normalizeTrace(camel(C[FIXTURE.message]).agentTrace);
    expect(stored).not.toBeNull();
    expect(requiredTrace(Object.keys(stored!))).toEqual(requiredTrace(keys(TRACE)));
    expect(stored!.steps.map((s) => s.key)).toContain("word_lookup");
  });

  it("some recorded turn carries the optional done.note_zh, kept out of the visible text (spec addressing §5.2)", () => {
    const noted = Object.values(C).filter((v): v is Recorded =>
      Array.isArray(v) && v.some((e: { event?: string; data?: { note_zh?: unknown } }) => e?.event === "done" && typeof e.data?.note_zh === "string"));
    expect(noted.length).toBeGreaterThan(0);
    for (const list of noted) {
      const parsed = events(toSse(list));
      const raw = (list.find((e) => e.event === "done")!.data as { note_zh: string }).note_zh;
      const done = parsed.find((e): e is Extract<TurnEvent, { type: "done" }> => e.type === "done")!;
      expect(done.noteZh).toBe(raw.trim());
      const visible = parsed.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
      expect(visible).not.toContain(raw.trim());
      expect(visible).not.toContain("<<ZH>>");
    }
  });
});
