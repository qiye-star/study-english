import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RoomMessage } from "../protocol";
import { initialRoomState, type RoomState } from "../room-state";
import { EMMA, LEO, msg, TUTOR } from "./fixtures";
import type { RoomAgentsInfo } from "./room-agents-api";
import { targetKey } from "./target";
import { useAgentTarget } from "./use-agent-target";

const sys = (seq: number, text: string): RoomMessage => msg({ seq, kind: "system", text, sender: { kind: "system", id: null, name: null } });
const liveState = (over: Partial<RoomState> = {}): RoomState => ({ ...initialRoomState(), status: "live", lastSeq: 10, liveFrom: 10, ...over });
type P = Parameters<typeof useAgentTarget>[0];
const base = (over: Partial<P> = {}): P => ({ roomId: "r1", userId: 7, agents: [EMMA, LEO], state: liveState(), ended: false, info: null, ...over });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("toggles per persona, falls back to the default agent and remembers the choice per user and room", () => {
  const { result } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current).toMatchObject({ on: false, personaId: EMMA.id });
  act(() => result.current.toggle(LEO.id));
  expect(result.current).toMatchObject({ on: true, personaId: LEO.id });
  expect(JSON.parse(localStorage.getItem(targetKey(7, "r1"))!)).toMatchObject({ on: true, personaId: LEO.id });
  act(() => result.current.toggle(LEO.id));
  expect(result.current.on).toBe(false);
});

it("auto-opens when a tutor starts and closes when it ends — no timers involved", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  rerender(base({ state: liveState({ tutor: { ...TUTOR, currentUserId: 22 } }) }));
  expect(result.current).toMatchObject({ on: true, personaId: TUTOR.personaId });
  act(() => { vi.advanceTimersByTime(24 * 3600_000); });
  expect(result.current.on).toBe(true); // D2: never an idle auto-off
  rerender(base({ state: liveState({ tutor: null, messages: [sys(11, "tutor_done")], lastSeq: 11 }) }));
  expect(result.current.on).toBe(false);
  vi.useRealTimers();
});

it("closes a remembered auto-open when the REST roster says the tutor is gone", () => {
  localStorage.setItem(targetKey(7, "r1"), JSON.stringify({ on: true, personaId: EMMA.id, auto: { sig: "22:builtin:coach:8", sinceSeq: 3 }, ended: null }));
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current.on).toBe(true);
  const info: RoomAgentsInfo = { available: true, agents: [EMMA, LEO], tutor: null };
  rerender(base({ info }));
  expect(result.current.on).toBe(false);
});

it("closes when the room ends and is off with no agents", () => {
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  act(() => result.current.toggle(EMMA.id));
  rerender(base({ ended: true }));
  expect(result.current.on).toBe(false);
  rerender(base({ agents: [] }));
  expect(result.current).toMatchObject({ on: false, personaId: null, agent: null });
});

it("still toggles for this visit when storage is unavailable (starts off)", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  const { result } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current.on).toBe(false);
  act(() => result.current.toggle(EMMA.id));
  expect(result.current.on).toBe(true);
});
