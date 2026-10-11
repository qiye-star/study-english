import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type RecordedCall } from "~/test/fetch-mock";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import {
  MEMORY_SERVER_ERRORS, clearMemory, deleteItem, deleteRecap, exportMemory, fetchItems, fetchProfile, fetchRecaps,
  patchProfile, pinItem, setMemoryEnabled,
} from "./memory-api";
import { CLEAR, ITEM_B, PAGE, RECAPS, STATE } from "./test-fixtures";

const bodyOf = (call: RecordedCall) => JSON.parse(String(call.body));
const has = (dict: unknown, key: string) =>
  key.split(".").reduce<unknown>((node, k) => (node && typeof node === "object" ? (node as Record<string, unknown>)[k] : undefined), dict) !== undefined;
const leaves = (node: unknown, prefix = ""): string[] =>
  node && typeof node === "object" ? Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

describe("memory api", () => {
  it("uses the documented methods, paths, query strings and snake_case bodies", async () => {
    const mock = createFetchMock({
      "GET /api/agents/memory/profile": () => json(STATE),
      "PATCH /api/agents/memory/profile": () => json({ ...STATE, proposals: {} }),
      "GET /api/agents/memory/items": () => json(PAGE),
      "DELETE /api/agents/memory/items/a%2Fb": () => json({ id: "a/b" }),
      "POST /api/agents/memory/items/a%2Fb/pin": () => json({ ...ITEM_B, pinned: true }),
      "GET /api/agents/memory/recaps": () => json(RECAPS),
      "DELETE /api/agents/memory/recaps/r1": () => json({ id: "r1" }),
      "GET /api/agents/memory/export": () => new Response('{"version":1}', { headers: { "Content-Type": "application/json" } }),
      "DELETE /api/agents/memory": () => json({ ...CLEAR, scope: "persona" }),
      "PATCH /api/agents/settings": () => json({}),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const state = await fetchProfile(api);
    expect(state.memoryEnabled).toBe(true);
    expect(state.editedKeys).toEqual(["level"]);
    await patchProfile(api, { values: { level: "B1", native: null }, dismiss: ["goals"] });
    expect(bodyOf(mock.calls[1])).toEqual({ values: { level: "B1", native: null }, dismiss: ["goals"] });
    const page = await fetchItems(api, { kind: "goal", cursor: "30" });
    expect(page.personaCounts[1].persona?.name).toBe("英语教练");
    expect(Object.fromEntries(mock.calls[2].url.searchParams)).toEqual({ kind: "goal", cursor: "30", limit: "30" });
    await deleteItem(api, "a/b");
    expect((await pinItem(api, "a/b", true)).pinned).toBe(true);
    expect(bodyOf(mock.calls[4])).toEqual({ pinned: true });
    await fetchRecaps(api, "20");
    expect(mock.calls[5].url.searchParams.get("cursor")).toBe("20");
    await deleteRecap(api, "r1");
    const blob = await exportMemory(api);
    expect(blob.size).toBe('{"version":1}'.length); // raw bytes, not camelCased JSON
    expect((await clearMemory(api, "persona", "builtin:coach")).deleted.items).toBe(2);
    expect(bodyOf(mock.calls[8])).toEqual({ confirm: true, scope: "persona", persona_id: "builtin:coach" });
    await setMemoryEnabled(api, false);
    expect(bodyOf(mock.calls[9])).toEqual({ memory_enabled: false });
  });

  it("maps every server error to a message that exists in both languages", () => {
    for (const key of Object.values(MEMORY_SERVER_ERRORS)) {
      expect(has(en, key), key).toBe(true);
      expect(has(zh, key), key).toBe(true);
    }
  });

  it("keeps the strings in both languages key-aligned and under web.agents.memory (INDEX X11)", () => {
    expect(leaves(en).sort()).toEqual(leaves(zh).sort());
    expect(leaves(en).every((k) => k.startsWith("web.agents.memory."))).toBe(true);
  });
});
