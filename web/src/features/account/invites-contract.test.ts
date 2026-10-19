import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import type { InviteeInfo, MyInvite } from "~/api/types";
import { createFetchMock, json } from "~/test/fetch-mock";
import { createMyInvite, fetchMyInvite } from "./account-api";

/**
 * 跨计划契约(INDEX X28):server/tests/test_invites_contract.py 录制 invites_contract.json。
 * 用户侧两个键(my_invite_none、my_invite)经真实的 ApiClient 与 MyInvite 类型解析;
 * 管理端两个键(admin_batch、admin_list)只核对形状(网页端目前没有管理端类型)。
 * 夹具里的码、时间与用户 id 都是占位值(REDACTED / 固定时间)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/invites_contract.json"), "utf8"),
);

const KEYS = ["my_invite_none", "my_invite", "admin_batch", "admin_list"];

// 编译期守卫:MyInvite / InviteeInfo 增删字段时,这里必须同步改。
const MY_INVITE: Record<keyof MyInvite, true> = {
  eligible: true, reason: true, availableAt: true, code: true, uses: true, cap: true, invitees: true,
};
const INVITEE: Record<keyof InviteeInfo, true> = { displayName: true, joinedAt: true };

const ADMIN_INVITE_KEYS = ["id", "label", "kind", "uses", "max_uses", "expires_at", "revoked_at", "created_by", "created_at", "state"];
const ADMIN_LIST_EXTRA = ["owner", "redeemers"];
const STATES = ["active", "used_up", "expired", "revoked"];
const KINDS = ["admin", "user"];
const CODE_RE = /(?<![A-Za-z0-9])[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}(?![A-Za-z0-9])/;

const MY_INVITE_KEYS = Object.keys(MY_INVITE).sort();
const INVITEE_KEYS = Object.keys(INVITEE).sort();
const camel = (value: unknown) => camelcaseKeys(value as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const sortedKeys = (value: unknown) => Object.keys(value as Record<string, unknown>).sort();

function clientWith(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "tok", fetchImpl: mock.fetch });
  return { api, mock };
}

describe("invites contract fixture (INDEX X28)", () => {
  it("records exactly the keys the web client mirrors", () => {
    expect(Object.keys(FIXTURE).sort()).toEqual([...KEYS].sort());
  });

  it("my_invite_none: parses through fetchMyInvite into MyInvite with no code", async () => {
    const raw = FIXTURE.my_invite_none as Record<string, unknown>;
    expect(sortedKeys(camel(raw))).toEqual(MY_INVITE_KEYS);
    const { api } = clientWith({ "GET /api/me/invite": () => json(raw) });
    const parsed = await fetchMyInvite(api);
    expect(parsed).toEqual({
      eligible: true, reason: null, availableAt: null, code: null, uses: 0, cap: 10, invitees: [],
    });
  });

  it("my_invite: the owner's code and invitees parse with display name and join time only", async () => {
    const raw = FIXTURE.my_invite as Record<string, unknown>;
    expect(typeof raw.code).toBe("string");
    const invitees = raw.invitees as Array<Record<string, unknown>>;
    expect(invitees.length).toBeGreaterThan(0);
    for (const invitee of invitees) {
      expect(sortedKeys(invitee)).toEqual(["display_name", "joined_at"]);
      expect(sortedKeys(camel(invitee))).toEqual(INVITEE_KEYS);
    }
    const { api } = clientWith({ "GET /api/me/invite": () => json(raw) });
    const parsed = await fetchMyInvite(api);
    expect(parsed.eligible).toBe(true);
    expect(parsed.code).toBe("REDACTED");
    expect(parsed.uses).toBe(1);
    expect(parsed.cap).toBe(10);
    expect(parsed.invitees).toEqual([{ displayName: "guest_contract", joinedAt: "2026-01-01T00:00:00Z" }]);
    expect(sortedKeys(camel(raw))).toEqual(MY_INVITE_KEYS);
  });

  it("my_invite: the same keys come back from the create route, so the panel can use either", async () => {
    const raw = FIXTURE.my_invite as Record<string, unknown>;
    const { api } = clientWith({ "POST /api/me/invite": () => json(raw) });
    await expect(createMyInvite(api)).resolves.toMatchObject({ eligible: true, cap: 10 });
  });

  it("admin_batch: each invite row has the admin shape and one code per row, all placeholders", () => {
    const batch = FIXTURE.admin_batch as { invites: Array<Record<string, unknown>>; codes: string[] };
    expect(batch.invites.length).toBeGreaterThan(0);
    for (const row of batch.invites) {
      expect(sortedKeys(row)).toEqual([...ADMIN_INVITE_KEYS].sort());
      expect(KINDS).toContain(row.kind);
      expect(STATES).toContain(row.state);
      expect(row.max_uses).toBe(1); // batch codes are one-off (R-I10)
    }
    expect(batch.codes).toHaveLength(batch.invites.length);
    for (const code of batch.codes) expect(code).toBe("REDACTED");
  });

  it("admin_list: rows carry owner and redeemers beside the admin fields; no code anywhere", () => {
    const listing = FIXTURE.admin_list as { invites: Array<Record<string, unknown>> };
    expect(listing.invites.length).toBeGreaterThan(0);
    for (const row of listing.invites) {
      expect(sortedKeys(row)).toEqual([...ADMIN_INVITE_KEYS, ...ADMIN_LIST_EXTRA].sort());
      expect(KINDS).toContain(row.kind);
      expect(STATES).toContain(row.state);
      const redeemers = row.redeemers as { total: unknown; usernames: unknown };
      expect(sortedKeys(redeemers)).toEqual(["total", "usernames"]);
      expect(Array.isArray(redeemers.usernames)).toBe(true);
    }
    expect(JSON.stringify(listing)).not.toMatch(CODE_RE);
  });

  it("the whole fixture holds placeholders only: no invite-code-shaped string", () => {
    expect(JSON.stringify(FIXTURE)).not.toMatch(CODE_RE);
  });
});
