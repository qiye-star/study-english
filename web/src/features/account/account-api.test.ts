import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient, ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { ACCOUNT_ERROR_KEYS, bindEmail, createMyInvite, fetchMyInvite, removeAvatar, requestBindCode, requestEmailCode, resetPassword, rotateMyInvite, uploadAvatar } from "./account-api";
import "./locales";

const make = (routes: Parameters<typeof createFetchMock>[0], extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) => {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "tok", fetchImpl: mock.fetch, ...extra });
  return { api, mock };
};

describe("account email api", () => {
  it("sends the captcha payload only in X-Captcha on both code endpoints (W4)", async () => {
    const { api, mock } = make({
      "POST /api/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
      "POST /api/me/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
    });
    await requestEmailCode(api, "a@example.com", "register", "CAP-1");
    await requestBindCode(api, "b@example.com", "bind", "CAP-2");
    expect(mock.calls[0].headers.get("X-Captcha")).toBe("CAP-1");
    expect(mock.calls[1].headers.get("X-Captcha")).toBe("CAP-2");
    expect(JSON.stringify(mock.calls.map((c) => c.body))).not.toContain("CAP-");
    expect(mock.calls.every((c) => !c.url.search)).toBe(true);
  });

  it("sends email codes and resets the password on the documented endpoints", async () => {
    const { api, mock } = make({
      "POST /api/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
      "POST /api/password/reset": () => new Response(null, { status: 204 }),
      "POST /api/me/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
      "POST /api/me/email": () => new Response(null, { status: 204 }),
    });
    expect(await requestEmailCode(api, "a@example.com", "register")).toEqual({ ok: true, cooldownSeconds: 60 });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ email: "a@example.com", purpose: "register" });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);

    await expect(resetPassword(api, { email: "a@example.com", code: "123456", newPassword: "new-password1" })).resolves.toBeUndefined();
    expect(mock.calls[1].url.pathname).toBe("/api/password/reset");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ email: "a@example.com", code: "123456", new_password: "new-password1" });

    expect(await requestBindCode(api, "b@example.com", "bind")).toEqual({ ok: true, cooldownSeconds: 60 });
    expect(JSON.parse(mock.calls[2].body as string)).toEqual({ email: "b@example.com", purpose: "bind" });
    expect(mock.calls[2].headers.get("Authorization")).toBe("Bearer tok");

    await expect(bindEmail(api, { email: "b@example.com", code: "654321" })).resolves.toBeUndefined();
    expect(JSON.parse(mock.calls[3].body as string)).toEqual({ email: "b@example.com", code: "654321" });
    expect(mock.calls[3].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("exposes Retry-After on a 429 so the UI can count down", async () => {
    const { api } = make({
      "POST /api/email/code": () => new Response(JSON.stringify({ error: "Too many codes, please wait" }), {
        status: 429, headers: { "Content-Type": "application/json", "Retry-After": "42" },
      }),
    });
    await expect(requestEmailCode(api, "a@example.com", "reset")).rejects.toMatchObject({
      status: 429, message: "Too many codes, please wait", retryAfter: 42,
    });
  });

  it("translates account email and binding messages in both languages without echoing input", () => {
    const t = i18n.t.bind(i18n);
    const cases: Array<[string, string, string, string]> = [
      ["Invalid or expired code", "web.account.errors.invalidCode", "The code is invalid or has expired.", "验证码无效或已过期。"],
      ["Too many codes, please wait", "web.account.errors.tooManyCodes", "Too many codes. Please wait before trying again.", "验证码发送过于频繁,请稍后再试。"],
      ["Email temporarily unavailable", "web.account.errors.emailUnavailable", "Email is temporarily unavailable. Try again later.", "邮件服务暂时不可用,请稍后再试。"],
      ["Email domain not allowed", "web.account.errors.emailDomainNotAllowed", "This email domain can't be used.", "该邮箱域名不支持。"],
      ["Email is not configured", "web.account.errors.emailNotConfigured", "Email is not set up on this server.", "服务器未配置邮件服务。"],
      ["Wrong password", "web.account.password.wrong", "Current password is incorrect", "当前密码不正确"],
      ["Email already bound", "web.account.errors.emailAlreadyBound", "This account already has an email.", "该账号已绑定邮箱。"],
      ["Email verification required: please register in the web app", "web.account.errors.emailVerificationRequired",
        "Email verification is required. Please register in the web app.", "需要邮箱验证,请在网页端注册。"],
    ];
    for (const [message, key, en, zh] of cases) {
      expect(ACCOUNT_ERROR_KEYS[message], message).toBe(key);
      expect(translateServerError(t, new ApiError(400, message), ACCOUNT_ERROR_KEYS), message).toBe(en);
      expect(i18n.t(key, { lng: "zh-CN" }), key).toBe(zh);
    }
    expect(translateServerError(t, new ApiError(422, "Email must not contain user@example.com"), ACCOUNT_ERROR_KEYS)).toBe("Something went wrong.");
  });
});

describe("avatar api", () => {
  it("uploads the picked image as multipart field file and removes it with DELETE", async () => {
    const { api, mock } = make({
      "POST /api/me/avatar": () => json({ avatar_url: "/api/avatars/00000000000000000000000000000000" }),
      "DELETE /api/me/avatar": () => new Response(null, { status: 204 }),
    });
    const blob = new Blob(["jpg"], { type: "image/jpeg" });
    expect(await uploadAvatar(api, blob)).toEqual({ avatarUrl: "/api/avatars/00000000000000000000000000000000" });
    const body = mock.calls[0].body as FormData;
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer tok");
    await expect(removeAvatar(api)).resolves.toBeUndefined();
    expect(mock.calls[1].method).toBe("DELETE");
  });
});

describe("my invite api (real server shapes: user_invites.view, R-I6/R-I9)", () => {
  it("GET not eligible: flat shape, reason and available_at, no code", async () => {
    const { api, mock } = make({
      "GET /api/me/invite": () => json({
        eligible: false, reason: "too_new", available_at: "2026-10-20T00:00:00+08:00",
        code: null, uses: 0, cap: 10, invitees: [],
      }),
    });
    expect(await fetchMyInvite(api)).toEqual({
      eligible: false, reason: "too_new", availableAt: "2026-10-20T00:00:00+08:00",
      code: null, uses: 0, cap: 10, invitees: [],
    });
    expect(mock.calls[0].method).toBe("GET");
    expect(mock.calls[0].url.search).toBe("");
  });

  it("GET eligible with a code: cumulative uses, cap and display-name invitees", async () => {
    const { api } = make({
      "GET /api/me/invite": () => json({
        eligible: true, reason: null, available_at: null, code: "ABCDE-FGHJK", uses: 3, cap: 10,
        invitees: [{ display_name: "小明", joined_at: "2026-10-18T09:00:00+08:00" }],
      }),
    });
    expect(await fetchMyInvite(api)).toEqual({
      eligible: true, reason: null, availableAt: null, code: "ABCDE-FGHJK", uses: 3, cap: 10,
      invitees: [{ displayName: "小明", joinedAt: "2026-10-18T09:00:00+08:00" }],
    });
  });

  it("GET rotate_required: eligible, no code, the reason says the code must be replaced", async () => {
    const { api } = make({
      "GET /api/me/invite": () => json({ eligible: true, reason: "rotate_required", available_at: null, code: null, uses: 2, cap: 10, invitees: [] }),
    });
    expect(await fetchMyInvite(api)).toMatchObject({ eligible: true, reason: "rotate_required", code: null, uses: 2 });
  });

  it("POST creates the permanent code; rotate sends confirm true to the real path", async () => {
    const body: Record<string, unknown> = { eligible: true, reason: null, available_at: null, code: "KMNPQ-RSTVW", uses: 0, cap: 10, invitees: [] };
    const { api, mock } = make({
      "POST /api/me/invite": () => json(body),
      "POST /api/me/invite/rotate": () => json(body),
    });
    expect(await createMyInvite(api)).toMatchObject({ eligible: true, code: "KMNPQ-RSTVW", cap: 10 });
    expect(mock.calls[0].method).toBe("POST");
    expect(await rotateMyInvite(api)).toMatchObject({ eligible: true, code: "KMNPQ-RSTVW" });
    expect(mock.calls[1].url.pathname).toBe("/api/me/invite/rotate");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ confirm: true });
    expect(mock.calls[1].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("a refused POST surfaces as ApiError with the server message (the reason comes from a re-read)", async () => {
    const { api } = make({
      "POST /api/me/invite": () => json({ error: "Not eligible", reason: "too_new", available_at: "2026-10-20T00:00:00+08:00" }, 403),
    });
    const err = await createMyInvite(api).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe("Not eligible");
  });
});
