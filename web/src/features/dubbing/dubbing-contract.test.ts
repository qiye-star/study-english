// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import {
  DUBBING_DISABLED, DUBBING_SERVER_ERRORS, type DubbingConfig, type DubbingLimits, type DubbingTake, type LineResult, type RoleName, type RolesState,
  type SpeakerEntry, type TakeLineMissing, type TakeLineScored,
} from "./dubbing-api";

/**
 * 契约(计划 L5 R24):`server/tests/fixtures/dubbing_contract.json` 由 S11 的 test_dubbing_contract.py 录制。
 * `Record<keyof T, true>` 在编译期把键表绑定到 dubbing-api.ts 的类型;键集合必须逐一相等。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/dubbing_contract.json");
const c = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, any>;
const cc = <T>(v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as T;
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const keysOf = (o: object) => Object.keys(o).sort();

const CONFIG: Record<keyof DubbingConfig, true> = { enabled: true, suggest: true, limits: true };
const LIMITS: Record<keyof DubbingLimits, true> = {
  maxLines: true, maxMs: true, windowBeforeMs: true, windowAfterMs: true, syncToleranceMs: true, weights: true, maxRoles: true,
};
const WEIGHTS: Record<"pronunciation" | "fluency" | "sync", true> = { pronunciation: true, fluency: true, sync: true };
const ROLES: Record<keyof RolesState, true> = { names: true, speakers: true, editable: true, locked: true };
const NAME: Record<keyof RoleName, true> = { key: true, name: true };
const SPEAKER: Record<keyof SpeakerEntry, true> = { idx: true, speaker: true };
const TAKE: Record<keyof DubbingTake, true> = {
  id: true, itemId: true, segFrom: true, segTo: true, role: true, status: true, expected: true, totalScore: true, summary: true, lines: true,
  createdAt: true, finishedAt: true,
};
const SCORED: Record<keyof TakeLineScored, true> = {
  segIdx: true, assessmentId: true, pronunciation: true, fluency: true, sync: true, syncBasis: true, score: true, onsetMs: true, ratioPct: true, stale: true,
};
const MISSING: Record<keyof TakeLineMissing, true> = { segIdx: true, missing: true, reason: true, stale: true };
const LINE: Record<keyof LineResult, true> = { segIdx: true, pronunciation: true, fluency: true, sync: true, syncBasis: true, score: true };

describe("dubbing contract (server fixture, plan L5 R24)", () => {
  it("has the server-recorded fixture (never skipped)", () => {
    expect(c.config).toBeDefined();
  });

  it("config and its limits match the fixture", () => {
    const config = cc<DubbingConfig>(c.config);
    expect(keysOf(config)).toEqual(keys(CONFIG));
    expect(keysOf(config.limits as DubbingLimits)).toEqual(keys(LIMITS));
    expect(keysOf((config.limits as DubbingLimits).weights)).toEqual(keys(WEIGHTS));
    expect(keysOf(DUBBING_DISABLED)).toEqual(keys(CONFIG));
  });

  it("roles (GET and PUT) match the fixture", () => {
    for (const name of ["roles_get", "roles_put"]) {
      const roles = cc<RolesState>(c[name]);
      expect(keysOf(roles)).toEqual(keys(ROLES));
      for (const row of roles.speakers) expect(keysOf(row)).toEqual(keys(SPEAKER));
    }
    const named = cc<RolesState>(c.roles_put).names[0];
    expect(keysOf(named)).toEqual(keys(NAME));
  });

  it("suggest, take create, list, finish and detail match the fixture", () => {
    expect(keysOf(cc<{ speakers: SpeakerEntry[] }>(c.suggest))).toEqual(["speakers"]);
    const created = cc<{ take: DubbingTake }>(c.take_create).take;
    expect(keysOf(created)).toEqual(keys(TAKE));
    const listed = cc<{ takes: DubbingTake[] }>(c.takes_list).takes[0];
    expect(keysOf(listed)).toEqual(keys(TAKE));
    for (const name of ["finish", "take_detail"]) {
      const take = cc<{ take: DubbingTake }>(c[name]).take;
      expect(keysOf(take)).toEqual(keys(TAKE));
      expect(keysOf(take.lines[0])).toEqual(keys(SCORED));
      expect(keysOf(take.lines[1])).toEqual(keys(MISSING));
    }
  });

  it("a scored line result matches the fixture", () => {
    expect(keysOf(cc<{ line: LineResult }>(c.line).line)).toEqual(keys(LINE));
  });

  it("the client error map covers exactly the fixture's error texts", () => {
    expect(Object.keys(DUBBING_SERVER_ERRORS).sort()).toEqual(Object.values(c.errors as Record<string, string>).sort());
  });
});
