import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { LoginPage } from "./login-page";

const USER = { id: "12345678", name: "alice", created_at: "t", access_token: "tok" };

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/practice" element={<div>practice home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

describe("LoginPage", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });

  it("logs in, stores the token and goes to /practice", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await userEvent.type(screen.getByTestId("login-username"), " Alice ");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ provider: "password", username: "alice", password: "password123" });
    expect(JSON.parse(localStorage.getItem("enjoy-web.auth")!).token).toBe("tok");
  });

  it("shows a translated server error", async () => {
    setup({ "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) });
    await userEvent.type(screen.getByTestId("login-username"), "alice");
    await userEvent.type(screen.getByTestId("login-password"), "wrong");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password.");
  });

  it("validates before calling the server", async () => {
    const mock = setup({});
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(screen.getByTestId("login-error")).toHaveTextContent("Please enter username and password.");
    expect(mock.calls).toHaveLength(0);
  });

  it("accepts an email in the username field and sends it trimmed and lowercased", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await userEvent.type(screen.getByTestId("login-username"), " Alice@Example.COM ");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ provider: "password", username: "alice@example.com", password: "password123" });
  });

  it("no longer has a register mode, and links to registration and password reset", () => {
    setup({});
    expect(screen.queryByTestId("login-mode-toggle")).toBeNull();
    expect(screen.queryByTestId("register-invite")).toBeNull();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/register");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByLabelText("Username or email")).toBeInTheDocument();
  });

  it("shows a notice after a password reset, asking the user to log in with the new password", () => {
    const mock = createFetchMock({});
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { notice: "passwordReset" } }]}>
        <AuthProvider fetchImpl={mock.fetch}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("login-notice")).toHaveTextContent("Password reset. Log in with your new password.");
  });

  it("shows a friendly error when a 2xx response is not JSON", async () => {
    setup({ "POST /api/sessions": () => new Response("<html>proxy</html>", { status: 200 }) });
    await userEvent.type(screen.getByTestId("login-username"), "alice");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Something went wrong.");
  });

  it("inputs are at least 44px tall and use 16px text", () => {
    setup({});
    expect(screen.getByTestId("login-username").className).toMatch(/\bh-(11|12)\b/);
    expect(screen.getByTestId("login-username").className).toMatch(/\btext-base\b/);
  });

  it("liquid: form panel, pill fields, accent submit (plan 2026-10-15-liquid-glass L11-2)", () => {
    setLiquid(true);
    try {
      setup({});
      expect(screen.getByTestId("login-submit").className).toContain("liquid:shadow-accent");
      expect(screen.getByTestId("login-username").className).toMatch(/\bh-(11|12)\b/);
      expect(screen.getByTestId("login-username").className).toContain("liquid:rounded-full");
      expect(screen.getByTestId("login-username").closest("form")!.className).toContain("mat-surface-strong");
    } finally {
      setLiquid(false);
    }
  });
});
