import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
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

  it("registers with an optional invite code", async () => {
    const mock = setup({ "POST /api/users": () => json(USER) });
    await userEvent.click(screen.getByTestId("login-mode-toggle"));
    await userEvent.type(screen.getByTestId("login-username"), "ab");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(screen.getByTestId("login-error")).toHaveTextContent("Username: 3–32");
    expect(mock.calls).toHaveLength(0);
    await userEvent.type(screen.getByTestId("login-username"), "c");
    await userEvent.type(screen.getByTestId("register-invite"), "invite-1");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ username: "abc", password: "password123", invite_code: "invite-1" });
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
    expect(screen.getByTestId("login-username").className).toMatch(/\bh-11\b/);
    expect(screen.getByTestId("login-username").className).toMatch(/\btext-base\b/);
  });
});
