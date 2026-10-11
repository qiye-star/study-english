import { expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AGENTS_WIRE, ROOM_WIRE } from "./fixtures";
import { fetchRoomAgents, reportRoomAgent, resumeRoomTutor, skipRoomTutor, startRoomTutor, stopRoomTutor, updateRoomAgents } from "./room-agents-api";

it("talks to the room agents endpoints in snake_case", async () => {
  const none = null as null | string | number;
  const tutor = { persona_id: "builtin:coach", persona_name: "Emma", phase: "generating", step_index: 0, steps_total: 5, current_user_id: none,
    current_name: none, deadline_at: none, remaining_ms: none, started_by: 1, paused_reason: none };
  const mock = createFetchMock({
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
    "PATCH /api/rooms/r1": () => json({ room: ROOM_WIRE }),
    "POST /api/rooms/r1/agents/builtin%3Acoach/report": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/start": () => json({ tutor }),
    "POST /api/rooms/r1/agents/tutor/skip": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/stop": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/resume": () => json({ tutor }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  expect((await fetchRoomAgents(api, "r1")).agents[0]).toMatchObject({ name: "Emma", promptPublic: true });
  expect((await updateRoomAgents(api, "r1", ["builtin:coach"])).agentIds).toEqual(["builtin:coach"]);
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ agents: ["builtin:coach"] });
  await reportRoomAgent(api, "r1", "builtin:coach", "abuse");
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ reason: "abuse" });
  expect((await startRoomTutor(api, "r1", "builtin:coach", 5)).stepsTotal).toBe(5);
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ persona_id: "builtin:coach", steps: 5 });
  await skipRoomTutor(api, "r1");
  await stopRoomTutor(api, "r1");
  expect((await resumeRoomTutor(api, "r1")).personaName).toBe("Emma");
});
