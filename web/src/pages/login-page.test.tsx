import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { altchaCalls, resetFakeAltcha, solveCaptcha, widgetElement } from "~/test/captcha-element";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { HOME_PATH } from "~/lib/home-route";
import { LoginPage } from "./login-page";

// 组件本体的 altcha 依赖在 jsdom 里替换(真实求解器需要浏览器 WebCrypto 与真实元素)。
vi.mock("altcha", () => ({}));
vi.mock("altcha/i18n/en", () => ({}));
vi.mock("altcha/i18n/zh-cn", () => ({}));

const USER = { id: "12345678", name: "alice", created_at: "t", access_token: "tok" };

function setup(routes: Parameters<typeof createFetchMock>[0], mode: "off" | "adaptive" | "always" = "off") {
  const mock = createFetchMock({ "GET /api/captcha/config": () => json({ mode }), ...routes });
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path={HOME_PATH} element={<div>home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

describe("LoginPage", () => {
  beforeEach(() => { clearAuth(); localStorage.clear(); });

  it("logs in, stores the token and goes to the home page", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await userEvent.type(screen.getByTestId("login-username"), " Alice ");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/sessions")!.body as string))
      .toEqual({ provider: "password", username: "alice", password: "password123" });
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
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("accepts an email in the username field and sends it trimmed and lowercased", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await userEvent.type(screen.getByTestId("login-username"), " Alice@Example.COM ");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/sessions")!.body as string))
      .toEqual({ provider: "password", username: "alice@example.com", password: "password123" });
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

describe("LoginPage human verification (W7, spec R-C1/R-C8)", () => {
  const P1 = "PAYLOAD-LOGIN-A-" + "g".repeat(24);
  const P2 = "PAYLOAD-LOGIN-B-" + "h".repeat(24);

  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    resetFakeAltcha();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function fillAndSubmit() {
    await userEvent.type(screen.getByTestId("login-username"), "alice");
    await userEvent.type(screen.getByTestId("login-password"), "password123");
    await userEvent.click(screen.getByTestId("login-submit"));
  }

  it("off: renders no widget and makes no challenge request", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) });
    await fillAndSubmit();
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(widgetElement()).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname.startsWith("/api/captcha/challenge"))).toBe(false);
  });

  it("adaptive: a wrong password keeps the existing message and does not open the widget", async () => {
    setup({ "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) }, "adaptive");
    await fillAndSubmit();
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password.");
    expect(widgetElement()).toBeNull();
  });

  it("adaptive: a 428 captcha_required opens the widget, then the retry carries a payload in X-Captcha only", async () => {
    let attempts = 0;
    const mock = setup({
      "POST /api/sessions": () => (attempts++ === 0 ? json({ error: "captcha_required" }, 428) : json(USER)),
    }, "adaptive");
    await fillAndSubmit();
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Please complete the verification first.");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    solveCaptcha(P1);
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("home")).toBeInTheDocument();
    const sessions = mock.calls.filter((c) => c.url.pathname === "/api/sessions");
    expect(sessions[0].headers.has("X-Captcha")).toBe(false);
    expect(sessions[1].headers.get("X-Captcha")).toBe(P1);
    expect(JSON.stringify(sessions[1].body)).not.toContain(P1);
    expect(sessions[1].url.search).toBe("");
    expect(document.body.textContent).not.toContain(P1);
    expect(Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? "").join("|")).not.toContain(P1);
  });

  it("adaptive: a 428 captcha_invalid shows the fixed message and re-arms the widget", async () => {
    setup({ "POST /api/sessions": () => json({ error: "captcha_invalid" }, 428) }, "adaptive");
    await fillAndSubmit();
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    solveCaptcha(P1);
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Verification expired or failed. Please try again.");
    expect(altchaCalls.reset).toBeGreaterThanOrEqual(1);
  });

  it("always: the widget shows at once and nothing is sent until it is solved", async () => {
    const mock = setup({ "POST /api/sessions": () => json(USER) }, "always");
    await waitFor(() => expect(widgetElement()).not.toBeNull());
    await fillAndSubmit();
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Please complete the verification first.");
    expect(mock.calls.some((c) => c.url.pathname === "/api/sessions")).toBe(false);
    solveCaptcha(P2);
    await userEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("home")).toBeInTheDocument();
    expect(mock.calls.find((c) => c.url.pathname === "/api/sessions")!.headers.get("X-Captcha")).toBe(P2);
  });
});
