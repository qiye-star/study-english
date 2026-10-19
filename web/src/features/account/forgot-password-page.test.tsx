import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, loadAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ForgotPasswordPage } from "./forgot-password-page";

/** 登录页的占位:记录跳转后的 state,确认是否带着「密码已重置」提示到达。 */
function LoginProbe() {
  const state = useLocation().state as { notice?: string } | null;
  return <div data-testid="login-probe">{state?.notice ?? "no-notice"}</div>;
}

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock({ "POST /api/email/code": () => json({ ok: true, cooldown_seconds: 60 }), ...routes });
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
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ email: "dan@example.com", purpose: "reset" });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);
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
