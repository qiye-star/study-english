import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, saveAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { altchaCalls, resetFakeAltcha, solveCaptcha, widgetElement } from "~/test/captcha-element";
import { createFetchMock, json } from "~/test/fetch-mock";
import { BindEmailPage } from "./lazy";

// 组件本体的 altcha 依赖在 jsdom 里替换(真实求解器需要浏览器 WebCrypto 与真实元素)。
vi.mock("altcha", () => ({}));
vi.mock("altcha/i18n/en", () => ({}));
vi.mock("altcha/i18n/zh-cn", () => ({}));

interface Profile {
  state: "none" | "pending" | "enforced";
  verified?: boolean;
  deadline?: string;
}

function profileBody(p: Profile) {
  return {
    id: "1", name: "alice", created_at: "t",
    email_masked: p.verified ? "a***@example.com" : null,
    email_verified: p.verified === true,
    email_binding: { state: p.state, deadline: p.deadline ?? null },
  };
}

/** 绑定后 /api/me 返回已验证,模拟服务端状态变化。 */
function setup(profile: Profile, state?: object, mode: "off" | "adaptive" | "always" = "off", extra: Parameters<typeof createFetchMock>[0] = {}) {
  let bound = false;
  const mock = createFetchMock({
    "GET /api/captcha/config": () => json({ mode }),
    "GET /api/me": () => json(profileBody(bound ? { ...profile, state: "none", verified: true } : profile)),
    "POST /api/me/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
    "POST /api/me/email": () => {
      bound = true;
      return new Response(null, { status: 204 });
    },
    ...extra,
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/account/email", search: "?required=1", state: state ?? { from: "/chat" } }]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/account/email" element={<BindEmailPage />} />
          <Route path="/chat" element={<div>chat page</div>} />
          <Route path="/me" element={<div>me page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

describe("BindEmailPage (X26, W6)", () => {
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    saveAuth({ token: "tok", user: { id: "1", name: "alice" } });
    resetFakeAltcha();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the pending deadline, sends a bind code with the signed-in endpoint, binds, and returns to the page it came from", async () => {
    const mock = setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" });
    expect(await screen.findByTestId("bind-deadline")).toHaveTextContent("2026");
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("button", { name: "Resend in 60s" });
    const sent = mock.calls.find((c) => c.url.pathname === "/api/me/email/code")!;
    expect(JSON.parse(sent.body as string)).toEqual({ email: "dan@example.com", purpose: "bind" });
    expect(sent.headers.get("Authorization")).toBe("Bearer tok");

    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.click(screen.getByRole("button", { name: "Bind email" }));
    expect(await screen.findByText("chat page")).toBeInTheDocument();
    const bind = mock.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/me/email")!;
    expect(JSON.parse(bind.body as string)).toEqual({ email: "dan@example.com", code: "918273" });
  });

  it("off: renders no widget and makes no challenge request", async () => {
    const mock = setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" });
    await screen.findByTestId("bind-deadline");
    expect(widgetElement()).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/captcha/challenge"))).toBe(false);
  });

  it("adaptive: the send-code request carries the payload, the bind request never does", async () => {
    const mock = setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" }, undefined, "adaptive");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    expect(screen.getByRole("button", { name: "Send code" })).toBeDisabled();
    solveCaptcha("PAYLOAD-BIND-SEND-" + "e".repeat(24));
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("button", { name: "Resend in 60s" });
    const sent = mock.calls.find((c) => c.url.pathname === "/api/me/email/code")!;
    expect(sent.headers.get("X-Captcha")).toBe("PAYLOAD-BIND-SEND-" + "e".repeat(24));
    expect(altchaCalls.verify).toBeGreaterThanOrEqual(1);

    solveCaptcha("PAYLOAD-BIND-OTHER-" + "f".repeat(24));
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.click(screen.getByRole("button", { name: "Bind email" }));
    expect(await screen.findByText("chat page")).toBeInTheDocument();
    const bind = mock.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/me/email")!;
    expect(bind.headers.has("X-Captcha")).toBe(false);
  });

  it("off, then a 428 captcha_required on send opens the widget", async () => {
    setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" }, undefined, "off", {
      "POST /api/me/email/code": () => json({ error: "captcha_required" }, 428),
    });
    await screen.findByTestId("bind-deadline");
    expect(widgetElement()).toBeNull();
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByTestId("bind-error")).toHaveTextContent("Please complete the verification first.");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
  });

  it("explains that the app stays locked until an email is bound when binding is enforced", async () => {
    setup({ state: "enforced" });
    expect(await screen.findByTestId("bind-note")).toHaveTextContent("Bind an email to keep using your account.");
  });

  it("does not put the email or the code into localStorage", async () => {
    setup({ state: "pending", deadline: "2026-11-01T10:00:00+08:00" });
    await screen.findByTestId("bind-deadline");
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "").join("|");
    expect(stored).not.toContain("dan@example.com");
  });

  it("a bound user changes the email with the current password", async () => {
    const mock = setup({ state: "none", verified: true });
    expect(await screen.findByText("Current email: a***@example.com. Changing it needs your password.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("button", { name: "Resend in 60s" });
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/me/email/code")!.body as string))
      .toEqual({ email: "dan@example.com", purpose: "change_email" });
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    await waitFor(() => expect(screen.getByText("chat page")).toBeInTheDocument());
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST" && c.url.pathname === "/api/me/email")!.body as string))
      .toEqual({ email: "dan@example.com", code: "918273", password: "old-password" });
  });
});
