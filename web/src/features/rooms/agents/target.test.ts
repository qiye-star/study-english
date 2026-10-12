import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomMessage, RoomTutorInfo } from "../protocol";
import { answer, EMMA, LEO, ME, msg, TUTOR } from "./fixtures";
import {
  loadTarget, myTutorTurn, nextTarget, recipientOf, saveTarget, TARGET_OFF, targetBlock, targetKey, tutorEnded, tutorSig, type TargetState,
} from "./target";

const sys = (seq: number, text: string): RoomMessage => msg({ seq, kind: "system", text, sender: { kind: "system", id: null, name: null } });
const live = { messages: [] as RoomMessage[], seq: 10, closed: false };
const T: RoomTutorInfo = { ...TUTOR, startedBy: 22, currentUserId: 22 };

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("storage (R-AW15)", () => {
  it("round-trips per user and room, and treats garbage or a broken storage as off", () => {
    const s: TargetState = { on: true, personaId: "u1", auto: { sig: "22:p:8", sinceSeq: 3 }, ended: null };
    saveTarget(7, "r1", s);
    expect(loadTarget(7, "r1")).toEqual(s);
    expect(loadTarget(8, "r1")).toEqual(TARGET_OFF);
    expect(loadTarget(null, "r1")).toEqual(TARGET_OFF);
    localStorage.setItem(targetKey(7, "r2"), JSON.stringify({ on: "yes" }));
    expect(loadTarget(7, "r2")).toEqual(TARGET_OFF);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(loadTarget(7, "r1")).toEqual(TARGET_OFF);
  });
});

describe("nextTarget (D2, R-AW4)", () => {
  it("turns on for the tutor's persona when a tutor starts, once per tutor", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    expect(on).toEqual({ on: true, personaId: T.personaId, auto: { sig: tutorSig(T), sinceSeq: 10 }, ended: null });
    expect(nextTarget(on, { ...live, tutor: { ...T, stepIndex: 3, phase: "generating" } })).toBe(on);
  });

  it("respects a manual off across a reconnect (welcome clears the tutor, the same frame comes back)", () => {
    const manualOff: TargetState = { ...nextTarget(TARGET_OFF, { ...live, tutor: T }), on: false };
    const afterWelcome = nextTarget(manualOff, { ...live, tutor: null });
    expect(afterWelcome).toBe(manualOff);
    expect(nextTarget(afterWelcome, { ...live, tutor: T })).toBe(manualOff);
  });

  it("turns off when the tutor stops or finishes, and a later tutor with the same signature turns it on again", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    const ended = nextTarget(on, { ...live, tutor: T, messages: [sys(11, "tutor_stopped")] });
    expect(ended).toMatchObject({ on: false, auto: null, ended: tutorSig(T) });
    expect(nextTarget(ended, { ...live, tutor: T, messages: [sys(11, "tutor_stopped")] })).toBe(ended); // frame not cleared yet: stays off
    const cleared = nextTarget(ended, { ...live, tutor: null, messages: [sys(11, "tutor_stopped")] });
    expect(cleared.ended).toBeNull();
    expect(nextTarget(cleared, { ...live, seq: 20, tutor: T, messages: [sys(11, "tutor_stopped")] })).toMatchObject({ on: true, auto: { sinceSeq: 20 } });
    expect(nextTarget(on, { ...live, tutor: null, messages: [sys(12, "tutor_done")] })).toMatchObject({ on: false, auto: null, ended: null });
  });

  it("ignores an older tutor's end message and turns everything off when the room closes", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    expect(nextTarget(on, { ...live, tutor: T, messages: [sys(9, "tutor_done")] })).toBe(on);
    const manual: TargetState = { on: true, personaId: "u1", auto: null, ended: null };
    expect(nextTarget(manual, { ...live, tutor: null, closed: true })).toEqual({ on: false, personaId: "u1", auto: null, ended: null });
    expect(nextTarget(TARGET_OFF, { ...live, tutor: null, closed: true })).toBe(TARGET_OFF);
  });

  it("does nothing without a tutor when it was not auto-opened (no idle timer, D2)", () => {
    const manual: TargetState = { on: true, personaId: "u1", auto: null, ended: null };
    expect(nextTarget(manual, { ...live, tutor: null, messages: [sys(11, "tutor_done")] })).toBe(manual);
  });

  it("tutorEnded only counts stop / done system messages after sinceSeq", () => {
    expect(tutorEnded([sys(5, "tutor_started"), sys(6, "tutor_done")], 5)).toBe(true);
    expect(tutorEnded([sys(5, "tutor_done")], 5)).toBe(false);
    expect(tutorEnded([msg({ seq: 9, text: "tutor_done" })], 0)).toBe(false); // a member typing the word is not a system message
  });
});

describe("targetBlock (spec §3.3)", () => {
  it("explains why the chip is greyed, in a fixed order", () => {
    const ok = { aiMuted: false, aiPublic: true, aiAvailable: true, agent: EMMA };
    expect(targetBlock(ok)).toBeNull();
    expect(targetBlock({ ...ok, aiMuted: true, aiPublic: false })).toBe("muted");
    expect(targetBlock({ ...ok, aiPublic: false })).toBe("aiOff");
    expect(targetBlock({ ...ok, aiAvailable: false })).toBe("unavailable");
    expect(targetBlock({ ...ok, agent: { ...EMMA, disabled: true } })).toBe("agentOff");
  });
});

describe("recipientOf (server priority: @ai > @name > reply > to; R-AW7)", () => {
  const agents = [EMMA, LEO];
  const leoAnswer = answer(5, 4, { agent: { personaId: LEO.id, name: "Leo" } });
  it("follows the server's order", () => {
    expect(recipientOf({ draft: "@ai hi", quote: leoAnswer, agents, to: LEO.id })).toEqual({ personaId: EMMA.id, name: "Emma", via: "mention" });
    expect(recipientOf({ draft: "@Leo hi", quote: null, agents, to: EMMA.id })).toEqual({ personaId: LEO.id, name: "Leo", via: "mention" });
    expect(recipientOf({ draft: "sure", quote: leoAnswer, agents, to: EMMA.id })).toEqual({ personaId: LEO.id, name: "Leo", via: "reply" });
    expect(recipientOf({ draft: "sure", quote: msg({ seq: 3 }), agents, to: EMMA.id })).toEqual({ personaId: EMMA.id, name: "Emma", via: "target" });
    expect(recipientOf({ draft: "sure", quote: null, agents, to: null })).toBeNull();
  });
});

it("myTutorTurn is true only while the tutor waits for my answer (R-AW3)", () => {
  expect(myTutorTurn({ ...TUTOR, currentUserId: ME }, ME)).toBe(true);
  expect(myTutorTurn({ ...TUTOR, currentUserId: 22 }, ME)).toBe(false);
  expect(myTutorTurn({ ...TUTOR, currentUserId: ME, phase: "generating" }, ME)).toBe(false);
  expect(myTutorTurn(null, ME)).toBe(false);
});
