import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseChangelogPage } from "./api";

/** 契约(计划 R-13):`server/tests/fixtures/changelog_contract.json` 由 `test_changelog_contract.py` 录制,这里逐键核对网页解析。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/changelog_contract.json"), "utf8")) as Record<string, Record<string, unknown>>;
const cc = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true });
const keys = (o: object) => Object.keys(o).sort();

describe("changelog contract", () => {
  it("has the six recorded answers", () => {
    expect(keys(contract)).toEqual(["admin_entry", "admin_list", "empty", "list", "probe", "seen"]);
  });
  it("an empty log is exactly four keys and parses to nothing", () => {
    expect(keys(contract.empty)).toEqual(["entries", "latest_id", "next", "unread"]);
    expect(parseChangelogPage(cc(contract.empty))).toEqual({ entries: [], next: null, unread: 0, latestId: null });
  });
  it("a page parses with every wire key accounted for", () => {
    expect(keys(contract.list)).toEqual(["entries", "latest_id", "next", "unread"]);
    const entries = contract.list.entries as Record<string, unknown>[];
    expect(keys(entries[0])).toEqual(["entry_date", "id", "is_new", "items", "published_at", "title_en", "title_zh", "version"]);
    const page = parseChangelogPage(cc(contract.list));
    expect(page.entries).toHaveLength(2);
    expect(page.unread).toBe(2);
    expect(page.latestId).toBe(2);
    expect(page.next).toBeNull();
    expect(page.entries[0]).toMatchObject({ entryDate: "2026-10-14", version: "v1.12", isNew: true });
    expect(page.entries[1].version).toBeNull();
    expect(page.entries[0].items.map((i) => i.tag)).toEqual(["new", "library"]);
  });
  it("the limit=1 probe carries a cursor for the rest", () => {
    const page = parseChangelogPage(cc(contract.probe));
    expect(page.entries).toHaveLength(1);
    expect(page.next).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
  it("seen answers with unread and lastSeenId", () => {
    expect(keys(contract.seen)).toEqual(["last_seen_id", "unread"]);
    expect(cc(contract.seen)).toEqual({ unread: 0, lastSeenId: 2 });
  });
});
