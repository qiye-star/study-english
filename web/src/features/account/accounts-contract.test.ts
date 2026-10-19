import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import type { AuthUser, EmailBindingInfo, UserProfile } from "~/api/types";
import { bindingRequiredOf, emailStatusOf } from "~/auth/email-binding";
import { createFetchMock, json } from "~/test/fetch-mock";
import { requestEmailCode } from "./account-api";

/**
 * 跨计划契约(INDEX X28):server/tests/test_accounts_contract.py 录制 accounts_contract.json,
 * 这里按键读取,并核对 web 的类型、解析器与绑定状态逻辑能处理夹具里的每个字段。
 * 夹具里的 token / 邮箱 / 时间都是占位值(REDACTED、a***@example.com)。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const C: Record<string, Record<string, unknown>> = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/accounts_contract.json"), "utf8"),
);

const KEYS = ["me", "me_unbound", "register", "login", "email_code", "password_changed", "error_binding_required"];

// 编译期守卫:新增或删除 UserProfile / AuthUser / EmailBindingInfo 字段时,这里必须同步改。
const PROFILE: Record<keyof UserProfile, true> = {
  id: true, name: true, createdAt: true, nickname: true, displayName: true,
  emailMasked: true, emailVerified: true, emailBinding: true,
};
const AUTH_USER: Record<keyof AuthUser, true> = { id: true, name: true, createdAt: true, accessToken: true, nickname: true, displayName: true };
const BINDING: Record<keyof EmailBindingInfo, true> = { state: true, deadline: true };

const camel = (value: unknown) => camelcaseKeys(value as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keysOf = (value: unknown) => Object.keys(camel(value)).sort();
const within = (keys: string[], allowed: Record<string, true>) => keys.every((k) => k in allowed);

function clientWith(routes: Parameters<typeof createFetchMock>[0], onBindingRequired?: () => void) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "tok", fetchImpl: mock.fetch, onBindingRequired });
  return { api, mock };
}

describe("accounts contract fixture (INDEX X28)", () => {
  it("records exactly the keys the web client mirrors", () => {
    expect(Object.keys(C).sort()).toEqual([...KEYS].sort());
  });

  it("me: every field is known to UserProfile and parsed into the email status", () => {
    const me = C.me as Record<string, unknown>;
    expect(within(keysOf(me), PROFILE)).toBe(true);
    expect(within(keysOf(me.email_binding), BINDING)).toBe(true);
    expect(me.email_masked).toBe("a***@example.com");
    expect(me.email_verified).toBe(true);
    expect(typeof (me.email_binding as { deadline: unknown }).deadline).toBe("string");

    const status = emailStatusOf(camel(me) as unknown as UserProfile);
    expect(status).toEqual({
      masked: "a***@example.com",
      verified: true,
      binding: { state: "pending", deadline: "2026-12-01T00:00:00+08:00" },
    });
    expect(bindingRequiredOf(status)).toBe(false);
  });

  it("me_unbound: an optional email_masked may be absent; enforced binding without a deadline gates the user", () => {
    const legacy = C.me_unbound as Record<string, unknown>;
    expect("email_masked" in legacy).toBe(false);
    expect(within(keysOf(legacy), PROFILE)).toBe(true);
    expect(within(keysOf(legacy.email_binding), BINDING)).toBe(true);

    const status = emailStatusOf(camel(legacy) as unknown as UserProfile);
    expect(status.masked).toBeNull();
    expect(status.verified).toBe(false);
    expect(status.binding).toEqual({ state: "enforced", deadline: null });
    expect(bindingRequiredOf(status)).toBe(true);
  });

  it("error_binding_required: a 403 with that body calls onBindingRequired", async () => {
    const onBindingRequired = vi.fn();
    const { api } = clientWith({
      "GET /api/me": () => json(C.error_binding_required, 403),
    }, onBindingRequired);
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("email_binding_required");
    expect(onBindingRequired).toHaveBeenCalledTimes(1);
  });

  it("register and login: every field is an AuthUser field and the token is present", async () => {
    for (const key of ["register", "login"] as const) {
      const body = C[key] as Record<string, unknown>;
      expect(within(keysOf(body), AUTH_USER), key).toBe(true);
      const { api } = clientWith({
        "POST /api/users": () => json(body),
        "POST /api/sessions": () => json(body),
      });
      const user = key === "register"
        ? await api.register({ username: "alice", password: "contract-password-1" })
        : await api.login("alice", "contract-password-1");
      expect(user.accessToken).toBe("REDACTED");
      expect(user.displayName).toBe("Newbie");
      expect(user.nickname).toBe("Newbie");
    }
  });

  it("email_code: the receipt parses through requestEmailCode (cooldown in seconds)", async () => {
    const { api } = clientWith({ "POST /api/email/code": () => json(C.email_code) });
    await expect(requestEmailCode(api, "alice@example.com", "register")).resolves.toEqual({ ok: true, cooldownSeconds: 60 });
  });

  it("password_changed: the rotated token parses as accessToken", async () => {
    const { api } = clientWith({ "POST /api/me/password": () => json(C.password_changed) });
    await expect(api.changePassword("old-password", "new-password1")).resolves.toEqual({ accessToken: "REDACTED" });
  });
});
