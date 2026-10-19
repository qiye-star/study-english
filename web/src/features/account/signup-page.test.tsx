import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { RegisterPage } from "./signup-page";

const USER = { id: "12345678", name: "dan", created_at: "t", access_token: "tok" };
const CODE_OK = { ok: true, cooldown_seconds: 60 };

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock({ "POST /api/email/code": () => json(CODE_OK), ...routes });
  render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider fetchImpl={mock.fetch}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/practice" element={<div>practice home</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return mock;
}

async function sendCode(email = "dan@example.com") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("Verification code");
}

async function fillStepTwo(values: { code?: string; username?: string; nickname?: string; password?: string } = {}) {
  const fields: Array<[string, string]> = [
    ["Verification code", values.code ?? "918273"],
    ["Username", values.username ?? "dan"],
    ["Nickname", values.nickname ?? "Dan"],
    ["Password", values.password ?? "password123"],
  ];
  for (const [label, text] of fields) {
    if (text) await userEvent.type(screen.getByLabelText(label), text);
  }
}

describe("RegisterPage", () => {
  beforeEach(() => {
    clearAuth();
    localStorage.clear();
    window.history.replaceState(null, "", "/register");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a register code, then counts down 60 seconds before resend is enabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const mock = setup({});
    await user.type(screen.getByLabelText("Email"), "dan@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByRole("button", { name: "Resend in 60s" });
    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ email: "dan@example.com", purpose: "register" });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);
    for (let second = 0; second < 60; second += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled());
  });

  it("shows the same neutral note whatever the email's registration state", async () => {
    setup({});
    await sendCode();
    expect(screen.getByTestId("register-code-note")).toHaveTextContent("If this address can receive mail, a code is on its way.");
  });

  it.each([
    [429, "Too many codes, please wait", "Too many codes. Please wait before trying again."],
    [422, "Email domain not allowed", "This email domain can't be used."],
    [503, "Email temporarily unavailable", "Email is temporarily unavailable. Try again later."],
  ])("maps a %i on send to a message (%s)", async (status, message, text) => {
    setup({ "POST /api/email/code": () => json({ error: message }, status) });
    await userEvent.type(screen.getByLabelText("Email"), "dan@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByTestId("register-error")).toHaveTextContent(text);
    expect(screen.queryByLabelText("Verification code")).toBeNull();
  });

  it("rejects a malformed email before calling the server", async () => {
    const mock = setup({});
    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(screen.getByTestId("register-error")).toHaveTextContent("Enter a valid email address.");
    expect(mock.calls).toHaveLength(0);
  });

  it("validates step two locally, then creates the account with email, code, nickname and invite", async () => {
    const mock = setup({ "POST /api/users": () => json(USER) });
    await sendCode();
    await fillStepTwo({ code: "12a", nickname: "" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByTestId("register-error")).toHaveTextContent("Enter the 6-digit code.");
    expect(mock.calls.some((c) => c.url.pathname === "/api/users")).toBe(false);

    await userEvent.clear(screen.getByLabelText("Verification code"));
    await userEvent.type(screen.getByLabelText("Verification code"), "654321");
    await userEvent.type(screen.getByLabelText("Nickname"), "Dan");
    await userEvent.type(screen.getByLabelText("Invite code (optional)"), "INVITE-1");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("practice home")).toBeInTheDocument();
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/users")!.body as string)).toEqual({
      username: "dan", password: "password123", email: "dan@example.com", email_code: "654321", nickname: "Dan", invite_code: "INVITE-1",
    });
  });

  it("rejects a nickname longer than 20 characters without echoing it", async () => {
    const mock = setup({ "POST /api/users": () => json(USER) });
    await sendCode();
    await fillStepTwo({ nickname: "x".repeat(21) });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByTestId("register-error")).toHaveTextContent("Nickname must be 1–20 characters.");
    expect(screen.getByTestId("register-error").textContent).not.toContain("xxxxx");
    expect(mock.calls.some((c) => c.url.pathname === "/api/users")).toBe(false);
  });

  it("reads #invite= from the fragment on mount and clears the fragment", async () => {
    window.history.replaceState(null, "", "/register#invite=ABCDE-FGHJK");
    setup({});
    await waitFor(() => expect(screen.getByLabelText("Invite code (optional)")).toHaveValue("ABCDE-FGHJK"));
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
  });

  it("keeps the email and the code out of localStorage", async () => {
    setup({ "POST /api/users": () => json(USER) });
    await sendCode("dan@example.com");
    await fillStepTwo();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText("practice home");
    const stored = Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`).join("\n");
    expect(stored).not.toContain("dan@example.com");
    expect(stored).not.toContain("918273");
  });

  it("uses the numeric one-time-code attributes on the code input", async () => {
    setup({});
    await sendCode();
    const code = screen.getByLabelText("Verification code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("maxlength", "6");
  });

  it("keeps the primary button on one line and links back to login", async () => {
    setup({});
    const submit = await screen.findByRole("button", { name: "Send code" });
    expect(submit.className).toContain("whitespace-nowrap");
    expect(within(document.body).getByRole("link", { name: "Already have an account? Log in" })).toHaveAttribute("href", "/login");
  });
});
