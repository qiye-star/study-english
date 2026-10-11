import { describe, expect, it } from "vitest";
import { createAgentSseParser, parseTurnEvent, type RawSseEvent } from "./sse";

const collect = (chunks: string[]) => {
  const out: RawSseEvent[] = [];
  const parser = createAgentSseParser((e) => out.push(e));
  for (const c of chunks) parser.push(c);
  parser.flush();
  return out;
};

describe("agent SSE parser (spec §4.4, R-W11)", () => {
  it("keeps event names, joins multi-line data, skips comment heartbeats and survives any chunk split", () => {
    const body = ': ping\n\nevent: start\ndata: {"turn_id":"t1"}\n\nevent: delta\ndata: {"text":"Hel"}\r\n\r\nevent: delta\ndata: {"text":\ndata: "lo"}\n\n';
    const whole = collect([body]);
    expect(whole.map((e) => e.event)).toEqual(["start", "delta", "delta"]);
    expect(whole[2].data).toBe('{"text":\n"lo"}');
    for (let cut = 1; cut < body.length; cut++) expect(collect([body.slice(0, cut), body.slice(cut)])).toEqual(whole);
  });

  it("emits a trailing block without a blank line on flush", () => {
    expect(collect(['event: done\ndata: {"text_len":2}'])).toEqual([{ event: "done", data: '{"text_len":2}' }]);
  });

  it("maps every event type of the spec and camelCases keys", () => {
    const step = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false };
    const camelStep = { id: "s1", group: "tool", key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false };
    expect(parseTurnEvent({ event: "start", data: '{"turn_id":"t1"}' })).toEqual({ type: "start", turnId: "t1" });
    expect(parseTurnEvent({ event: "step", data: JSON.stringify(step) })).toEqual({ type: "step", step: camelStep });
    expect(parseTurnEvent({ event: "thought", data: '{"source":"summary","text":"Give a synonym first."}' }))
      .toEqual({ type: "thought", thought: { source: "summary", text: "Give a synonym first." } });
    expect(parseTurnEvent({ event: "delta", data: '{"text":"Hi"}' })).toEqual({ type: "delta", text: "Hi" });
    expect(parseTurnEvent({ event: "meta", data: '{"step_index":2,"steps_total":8,"verdict":"good","kind":"ask","done":false}' }))
      .toEqual({ type: "meta", meta: { stepIndex: 2, stepsTotal: 8, verdict: "good", kind: "ask", done: false } });
    // tutor extras (retry, dictation sentence); null / empty keys stay absent
    expect(parseTurnEvent({ event: "meta", data: '{"step_index":3,"steps_total":8,"kind":"dictate","done":false,"retry":true,"say":"I left early."}' }))
      .toEqual({ type: "meta", meta: { stepIndex: 3, stepsTotal: 8, kind: "dictate", done: false, retry: true, say: "I left early." } });
    expect(parseTurnEvent({ event: "meta", data: '{"step_index":3,"steps_total":8,"say":null}' }))
      .toEqual({ type: "meta", meta: { stepIndex: 3, stepsTotal: 8 } });
    // server done.trace: steps carry `label` (no id), ms is {ctx,ttft,total}, thought has `chars`
    const trace = {
      v: 1, tools: "prefetch", ms: { ctx: 10, ttft: 200, total: 3400 },
      steps: [{ key: "word_lookup", group: "tool", status: "done", ms: 90, private: false, label: "agents.step.word_lookup", params: { word: "abandon" } }],
      thought: { source: "summary", text: "Synonym first.", chars: 14 },
    };
    expect(parseTurnEvent({ event: "done", data: JSON.stringify({ usage: { in: 10, out: 20 }, trace, text_len: 12 }) })).toEqual({
      type: "done", usage: { in: 10, out: 20 }, textLen: 12,
      trace: {
        v: 1, ms: 3400, thought: { source: "summary", text: "Synonym first." },
        steps: [{ id: "word_lookup-0", group: "tool", key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false }],
      },
    });
    expect(parseTurnEvent({ event: "error", data: '{"code":"limit"}' })).toEqual({ type: "error", code: "limit" });
  });

  it("ignores unknown events, bad JSON and malformed steps; an unknown error code is llm_unavailable", () => {
    expect(parseTurnEvent({ event: "future", data: "{}" })).toBeNull();
    expect(parseTurnEvent({ event: "delta", data: "not json" })).toBeNull();
    expect(parseTurnEvent({ event: "step", data: '{"id":"s1","group":"weird","status":"done"}' })).toBeNull();
    expect(parseTurnEvent({ event: "error", data: '{"code":"mystery"}' })).toEqual({ type: "error", code: "llm_unavailable" });
    expect(parseTurnEvent({ event: "done", data: '{"trace":"x"}' })).toEqual({ type: "done", usage: null, trace: null, textLen: 0 });
  });
});
