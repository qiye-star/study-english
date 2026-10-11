import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import {
  PROFILE_KEYS, type ClearResult, type ItemsPage, type MemoryItem, type ProfileState, type Recap, type RecapsPage,
} from "./memory-api";
import { CLEAR, EXPORT, ITEM_A, PAGE, RECAPS, STATE } from "./test-fixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../../server/tests/fixtures/agents_memory_contract.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Contract = Record<"profile" | "items" | "pin" | "recaps" | "export" | "clear", any>;
const recorded: Contract | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
/** spec §4.5 + 计划 S9 的形状;服务端样例存在时读真实样例。 */
const SPEC: Contract = { profile: STATE, items: PAGE, pin: { ...ITEM_A, pinned: true }, recaps: RECAPS, export: EXPORT, clear: CLEAR };
const C = recorded ?? SPEC;

const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keys = (r: object) => Object.keys(r).sort();
const ITEM: Record<keyof MemoryItem, true> = { id: true, kind: true, text: true, importance: true, pinned: true, persona: true, source: true, createdAt: true, updatedAt: true };
const RECAP: Record<keyof Recap, true> = { id: true, source: true, persona: true, conversationId: true, text: true, createdAt: true };
const STATE_KEYS: Record<keyof ProfileState, true> = { profile: true, editedKeys: true, proposals: true, memoryEnabled: true, memoryAvailable: true };
const PAGE_KEYS: Record<keyof ItemsPage, true> = { items: true, nextCursor: true, personaCounts: true };
const RECAPS_KEYS: Record<keyof RecapsPage, true> = { recaps: true, nextCursor: true };
const CLEAR_KEYS: Record<keyof ClearResult, true> = { scope: true, deleted: true };

describe("agents memory contract (server/tests/fixtures/agents_memory_contract.json)", () => {
  it("profile state has exactly the typed keys and only known profile keys", () => {
    const state = camel(C.profile);
    expect(keys(state)).toEqual(keys(STATE_KEYS));
    for (const k of Object.keys(state.profile as object)) expect(PROFILE_KEYS as readonly string[]).toContain(k);
    for (const k of state.editedKeys as string[]) expect(PROFILE_KEYS as readonly string[]).toContain(k);
    for (const k of Object.keys(state.proposals as object)) expect(PROFILE_KEYS as readonly string[]).toContain(k);
  });
  it("items page, item and pin result match the types", () => {
    const page = camel(C.items);
    expect(keys(page)).toEqual(keys(PAGE_KEYS));
    expect(keys((page.items as object[])[0])).toEqual(keys(ITEM));
    expect(keys(camel(C.pin))).toEqual(keys(ITEM));
    expect(keys((page.personaCounts as object[])[0])).toEqual(["count", "persona"]);
  });
  it("recaps and clear match the types", () => {
    const recaps = camel(C.recaps);
    expect(keys(recaps)).toEqual(keys(RECAPS_KEYS));
    expect(keys((recaps.recaps as object[])[0])).toEqual(keys(RECAP));
    expect(keys(camel(C.clear))).toEqual(keys(CLEAR_KEYS));
    expect(keys((camel(C.clear).deleted as object))).toEqual(["items", "profile", "recaps", "threads"]);
  });
  it("export keeps its raw snake_case top-level keys (downloaded as a file, never camelCased)", () => {
    expect(keys(C.export)).toEqual(["exported_at", "items", "profile", "recaps", "threads", "tombstones", "version"]);
  });
});
