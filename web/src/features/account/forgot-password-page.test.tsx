import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, loadAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { altchaCalls, resetFakeAltcha, solveCaptcha, widgetElement } from "~/test/captcha-element";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ForgotPasswordPage } from "./forgot-password-page";

// 组件本体的 altcha 依赖在 jsdom 里替换(真实求解器需要浏览器 WebCrypto 与真实元素)。
vi.mock("altcha", () => ({}));
vi.mock("altcha/i18n/en", () => ({}));
vi.mock("altcha/i18n/zh-cn", () => ({}));

/** 登录页的占位:记录跳转后的 state,确认是否带着「密码已重置」提示到达。 */
function LoginProbe() {
  const state = useLocation().state as { notice?: string } | null;
  return <div data-testid="login-probe">{state?.notice ?? "no-notice"}</div>;
}

function setup(routes: Parameters<typeof createFetchMock>[0], mode: "off" | "adaptive" | "always" = "off") {
  const mock = createFetchMock({
    "GET /api/captcha/config": () => json({ mode }),
    "POST /api/email/code": () => json({ ok: true, cooldown_seconds: 60 }),
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

async function sendCode(email = "dan@example.com") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("New password");
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
  });

  it("sends a reset code, then asks for the code and a new password, with a neutral note", async () => {
    const mock = setup({});
    await sendCode();
    const send = mock.calls.find((c) => c.url.pathname === "/api/email/code")!;
    expect(JSON.parse(send.body as string)).toEqual({ email: "dan@example.com", purpose: "reset" });
    expect(send.headers.has("Authorization")).toBe(false);
    expect(screen.getByTestId("forgot-note")).toHaveTextContent("If this email is registered, you'll receive a code.");
    expect(screen.getByLabelText("Verification code")).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("resets the password, goes to login with the notice, and does not sign in", async () => {
    const mock = setup({ "POST /api/password/reset": () => new Response(null, { status: 204 }) });
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("login-probe")).toHaveTextContent("passwordReset");
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/password/reset")!.body as string)).toEqual({
      email: "dan@example.com", code: "918273", new_password: "new-password1",
    });
    expect(loadAuth()).toBeNull();
  });

  it("validates the new password locally before calling the server", async () => {
    const mock = setup({ "POST /api/password/reset": () => new Response(null, { status: 204 }) });
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.getByTestId("forgot-error")).toHaveTextContent("Password must be 8–128 characters.");
    expect(mock.calls.some((c) => c.url.pathname === "/api/password/reset")).toBe(false);
  });

  it("shows the shared message for an invalid or expired code", async () => {
    setup({ "POST /api/password/reset": () => json({ error: "Invalid or expired code" }, 400) });
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("forgot-error")).toHaveTextContent("The code is invalid or has expired.");
    expect(screen.queryByTestId("login-probe")).toBeNull();
  });

  it("keeps the email, the code and the new password out of localStorage", async () => {
    setup({ "POST /api/password/reset": () => new Response(null, { status: 204 }) });
    await sendCode("dan@example.com");
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("login-probe")).toBeInTheDocument();
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join("\n");
    expect(stored).not.toContain("dan@example.com");
    expect(stored).not.toContain("918273");
    expect(stored).not.toContain("new-password1");
  });

  it("links back to log in", () => {
    setup({});
    expect(screen.getByRole("link", { name: "Back to log in" })).toHaveAttribute("href", "/login");
  });
});

describe("ForgotPasswordPage human verification (W5, spec §10)", () => {
  const P1 = "PAYLOAD-RESET-SEND-" + "c".repeat(24);
  const P2 = "PAYLOAD-RESET-SUBMIT-" + "d".repeat(24);

  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    resetFakeAltcha();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sendButton() {
    return screen.getByRole("button", { name: /Send code|Resend/ });
  }

  it("off: renders no widget and makes no challenge request", async () => {
    const mock = setup({});
    await sendCode();
    expect(widgetElement()).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/captcha/challenge"))).toBe(false);
  });

  it("adaptive: the send button is disabled until solved; the code request then carries the payload in X-Captcha", async () => {
    const mock = setup({}, "adaptive");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText("Please complete the verification first.")).toBeInTheDocument();
    solveCaptcha(P1);
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(sendButton());
    await screen.findByLabelText("New password");
    const send = mock.calls.find((c) => c.url.pathname === "/api/email/code")!;
    expect(send.headers.get("X-Captcha")).toBe(P1);
    expect(JSON.stringify(send.body)).not.toContain(P1);
    expect(altchaCalls.verify).toBeGreaterThanOrEqual(1);
  });

  it("adaptive: the reset uses a fresh payload in X-Captcha and nothing is sent without one", async () => {
    const mock = setup({ "POST /api/password/reset": () => new Response(null, { status: 204 }) }, "adaptive");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    solveCaptcha(P1);
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(screen.getByTestId("forgot-error")).toHaveTextContent("Please complete the verification first.");
    expect(mock.calls.some((c) => c.url.pathname === "/api/password/reset")).toBe(false);

    solveCaptcha(P2);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("login-probe")).toHaveTextContent("passwordReset");
    const reset = mock.calls.find((c) => c.url.pathname === "/api/password/reset")!;
    expect(reset.headers.get("X-Captcha")).toBe(P2);
    expect(JSON.stringify(reset.body)).not.toContain(P2);
  });

  it("adaptive: a 428 captcha_invalid on reset shows the fixed message and re-arms the widget", async () => {
    setup({ "POST /api/password/reset": () => json({ error: "captcha_invalid" }, 428) }, "adaptive");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    solveCaptcha(P1);
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    solveCaptcha(P2);
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("forgot-error")).toHaveTextContent("Verification expired or failed. Please try again.");
    expect(altchaCalls.reset).toBeGreaterThanOrEqual(1);
  });

  it("off, then a 428 captcha_required on reset opens the widget", async () => {
    setup({ "POST /api/password/reset": () => json({ error: "captcha_required" }, 428) });
    await sendCode();
    await userEvent.type(screen.getByLabelText("Verification code"), "918273");
    await userEvent.type(screen.getByLabelText("New password"), "new-password1");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByTestId("forgot-error")).toHaveTextContent("Please complete the verification first.");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
  });
});
