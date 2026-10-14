import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api/client";
import { createEntry, deleteEntry, listEntries, publishEntry, unpublishEntry, updateEntry, type ChangelogInput } from "./api";

vi.mock("../../api/client", () => ({ request: vi.fn() }));

/** 契约(计划 R-13):`server/tests/fixtures/changelog_contract.json` 由 `test_changelog_contract.py` 录制。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/changelog_contract.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const STAMP = "2026-10-14T00:00:00+00:00";

const input: ChangelogInput = {
  entryDate: "2026-10-14", version: "v1.12", titleZh: "标题", titleEn: "Title",
  items: [{ tag: "fix", zh: "修好了", en: "Fixed" }],
};
const wire = { entry_date: "2026-10-14", version: "v1.12", title_zh: "标题", title_en: "Title", items: [{ tag: "fix", zh: "修好了", en: "Fixed" }] };

beforeEach(() => vi.mocked(request).mockReset());

describe("changelog admin api", () => {
  it("lists entries and maps the recorded wire shape to camelCase", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_list);
    const entries = await listEntries();
    expect(request).toHaveBeenCalledWith("/api/admin/changelog");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 2, status: "published", entryDate: "2026-10-14", version: "v1.12", titleZh: "第二条", titleEn: "第二条 (en)",
      items: [{ tag: "new", zh: "新功能一句话", en: "A new thing" }, { tag: "library", zh: "跟读库一句话", en: "" }],
      createdBy: "operator1", createdAt: STAMP, updatedAt: STAMP, publishedAt: STAMP,
    });
    expect(entries[1].version).toBeNull();
  });

  it("maps a draft: no published time", async () => {
    vi.mocked(request).mockResolvedValue({ entries: [{ ...contract.admin_entry, status: "draft", published_at: null }] });
    expect((await listEntries())[0]).toMatchObject({ status: "draft", publishedAt: null });
  });

  it("creates with snake_case keys", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_entry);
    expect((await createEntry(input)).id).toBe(2);
    expect(request).toHaveBeenCalledWith("/api/admin/changelog", { method: "POST", json: wire });
  });

  it("updates, publishes, unpublishes and deletes by id", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_entry);
    await updateEntry(5, input);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5", { method: "PATCH", json: wire });
    await publishEntry(5);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5/publish", { method: "POST" });
    await unpublishEntry(5);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5/unpublish", { method: "POST" });
    vi.mocked(request).mockResolvedValue({ id: 5, deleted: true });
    await expect(deleteEntry(5)).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5", { method: "DELETE" });
  });
});
