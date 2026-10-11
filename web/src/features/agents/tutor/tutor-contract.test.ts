import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import enJson from "./locales/en.json";
import zhJson from "./locales/zh-CN.json";
import type { TutorHintResult, TutorMeta, TutorRecap, TutorSession } from "./tutor-api";
import { parseTutorMeta } from "./tutor-model";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../../server/tests/fixtures/agents_tutor_contract.json"), "utf8"));
const camel = <T,>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;

const SESSION: Record<keyof TutorSession, true> = {
  id: true, conversationId: true, personaId: true, status: true, phase: true, stepIndex: true, stepsTotal: true, level: true,
  kind: true, hintsUsed: true, hintsMax: true, goal: true, answers: true, say: true, recap: true, resumed: true, createdAt: true, updatedAt: true,
};
const RECAP: Record<keyof TutorRecap, true> = {
  total: true, answered: true, skipped: true, scores: true, strengths: true, weaknesses: true, words: true, levelStart: true, levelEnd: true, topic: true,
};
const HINT: Record<keyof TutorHintResult, true> = { hint: true, session: true };
const META: Record<keyof TutorMeta, true> = { stepIndex: true, stepsTotal: true, verdict: true, kind: true, done: true, retry: true, say: true };
const keys = (o: object) => Object.keys(o).sort();

it("matches the server's tutor session, hint and recap shapes", () => {
  for (const name of ["start", "get", "skip", "finish"]) expect(keys(camel<TutorSession>(contract[name])), name).toEqual(keys(SESSION));
  expect(keys(camel<TutorSession>(contract.active.session))).toEqual(keys(SESSION));
  expect(keys(camel<TutorHintResult>(contract.hint))).toEqual(keys(HINT));
  const recap = camel<TutorSession>(contract.finish).recap!;
  expect(keys(recap)).toEqual(keys(RECAP));
  expect(keys(recap.scores)).toEqual(["good", "ok", "skip", "weak"]);
  expect(keys(recap.strengths[0] ?? recap.weaknesses[0])).toEqual(["focus", "kind"]);
  expect(keys(camel<TutorSession>(contract.start).goal)).toEqual(["input", "length", "mix", "scenario", "topic"]);
});

it("parses the server's meta events (null keys are omitted on the wire)", () => {
  for (const name of ["meta_opening", "meta_answer"]) {
    const meta = camel<Record<string, unknown>>(contract[name]);
    for (const k of Object.keys(meta)) expect(Object.keys(META), `${name}.${k}`).toContain(k);
    for (const k of ["stepIndex", "stepsTotal", "done", "retry"]) expect(meta, `${name}.${k}`).toHaveProperty(k);
    expect(parseTutorMeta(contract[name])).not.toBeNull();
  }
  expect(parseTutorMeta(contract.meta_answer)!.verdict).toBe("good");
  expect(parseTutorMeta(contract.meta_opening)!.verdict).toBeNull();
});

it("tutor strings have the same keys in both languages", () => {
  const flat = (o: unknown, p = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)) : [p];
  expect(flat(enJson).sort()).toEqual(flat(zhJson).sort());
});
