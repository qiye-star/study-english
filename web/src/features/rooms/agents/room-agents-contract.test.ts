import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseRoomEvent, type AgentStepWire, type RoomEvent, type RoomMessage, type RoomTutorInfo } from "../protocol";
import { initialRoomState, roomReducer } from "../room-state";
import { agentOf } from "./agent-meta";
import type { RoomAgent } from "./room-agents-api";

/** server/tests/fixtures/rooms_agents_contract.json is recorded by server/tests/test_rooms_agents_contract.py (tutor parts: lane T re-records). */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../server/tests/fixtures");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: { http: Record<string, any>; ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "rooms_agents_contract.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: { ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "rooms_contract.json"), "utf8"));
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const wireKeys = (v: unknown) => Object.keys(camelcaseKeys(v as Record<string, unknown>, { deep: true })).sort();
const AGENT: Record<keyof RoomAgent, true> = { id: true, name: true, intro: true, level: true, style: true, builtin: true, promptPublic: true, prompt: true, disabled: true };
const STEP: Record<keyof AgentStepWire, true> = { id: true, group: true, key: true, status: true, labelKey: true, params: true, ms: true, private: true };
const TUTOR: Record<keyof RoomTutorInfo, true> = { personaId: true, personaName: true, phase: true, stepIndex: true, stepsTotal: true,
  currentUserId: true, currentName: true, deadlineAt: true, remainingMs: true, startedBy: true, pausedReason: true };
const ev = (raw: unknown) => parseRoomEvent(JSON.stringify(raw))!;
// The tutor frames/endpoints are recorded by lane T; until that lands in the fixture these checks are skipped, not weakened.
const hasTutorWs = !!C.ws.agent_tutor;
const hasTutorHttp = !!C.http.tutor_start;

describe("room agents payloads (recorded from the real server)", () => {
  it("HTTP", () => {
    expect(wireKeys(C.http.agents)).toEqual(["agents", "available", "tutor"]);
    for (const a of C.http.agents.agents) expect(wireKeys(a)).toEqual(keys(AGENT));
    expect(C.http.patch.room.agent_ids).toEqual(["builtin:coach"]);
  });

  it.skipIf(!hasTutorHttp)("HTTP tutor start", () => {
    expect(wireKeys(C.http.tutor_start.tutor)).toEqual(keys(TUTOR));
  });

  it("WebSocket frames", () => {
    const step = ev(C.ws.agent_step) as Extract<RoomEvent, { type: "agent_step" }>;
    const seen = Object.keys(step.step);
    expect(keys(STEP)).toEqual(expect.arrayContaining(seen)); // no key the web does not know
    expect(seen).toEqual(expect.arrayContaining(["id", "group", "key", "status", "labelKey", "private"])); // params / ms are optional
    expect(ev(C.ws.agent_thought).type).toBe("agent_thought");
    const answer = (ev(C.ws.message_agent_answer) as { message: RoomMessage }).message;
    expect(agentOf(answer)).toMatchObject({ agent: { personaId: "builtin:coach" }, asker: { name: "bob" }, handoffFrom: null });
    const trace = (ev(C.ws.message_agent_trace) as { message: RoomMessage }).message;
    expect([trace.lane, trace.kind, trace.replyTo]).toEqual(["private", "agent_trace", answer.seq]);
  });

  it.skipIf(!hasTutorWs)("WebSocket tutor frame", () => {
    const tutor = ev(C.ws.agent_tutor) as Extract<RoomEvent, { type: "agent_tutor" }>;
    expect(Object.keys(tutor.tutor!).sort()).toEqual(keys(TUTOR));
  });

  it("the reducer folds them; welcome clears the tutor until the server re-sends it", () => {
    let s = initialRoomState();
    for (const name of ["agent_step", "agent_thought", "message_agent_answer", "message_agent_trace", ...(hasTutorWs ? ["agent_tutor"] : [])]) {
      s = roomReducer(s, { type: "event", event: ev(C.ws[name]), at: 5 });
    }
    const answer = (ev(C.ws.message_agent_answer) as { message: RoomMessage }).message;
    expect(s.agentRuns[answer.replyTo!].answerSeq).toBe(answer.seq);
    expect(s.agentTraces[answer.seq]).toBeTruthy();
    if (hasTutorWs) expect([s.tutor?.phase, s.tutorAt]).toEqual(["await_answer", 5]);
    s = roomReducer(s, { type: "event", event: ev(R.ws.welcome) });
    expect(s.tutor).toBeNull();
  });
});
