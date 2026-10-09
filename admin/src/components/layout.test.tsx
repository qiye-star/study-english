import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { request } from "../api/client";
import * as session from "../api/session";
import { AppShell } from "./layout";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

it("hides superadmin-only navigation from viewers and shows the safe-mode bar", () => {
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "v", role: "viewer", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: true, maintenanceMode: "off",
  });
  render(<MemoryRouter><AppShell /></MemoryRouter>);
  expect(screen.getAllByRole("link", { name: "概览" }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: "管理员与会话" })).toBeNull();
  expect(screen.getByText(/安全模式/)).toBeInTheDocument();
});

it("shows the maintenance bar and superadmin navigation", () => {
  session.setSession({
    username: "root", role: "superadmin", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "read_only",
  });
  render(<MemoryRouter><AppShell /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "管理员与会话" })).toBeInTheDocument();
  expect(screen.getByText(/维护模式/)).toBeInTheDocument();
  expect(screen.queryByText(/安全模式/)).toBeNull();
});

it("hosts the step-up dialog and replays the original request after verification", async () => {
  session.setSession({
    username: "root", role: "superadmin", csrfToken: "csrf-9", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
  let guarded = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/admin/step-up") return body(200, { step_up_until: "2099-01-01T00:05:00+00:00" });
    if (url === "/api/admin/session") {
      return body(200, { username: "root", role: "superadmin", csrf_token: "csrf-9", expires_at: "2099-01-01T00:00:00Z", mfa_required: false,
        step_up_until: "2099-01-01T00:05:00+00:00", totp_enabled: false, safe_mode: false, maintenance_mode: "off" });
    }
    expect((init.headers as Record<string, string>)["X-Admin-CSRF"]).toBe("csrf-9");
    guarded += 1;
    return guarded === 1 ? body(403, { error: "Step-up required" }) : body(200, { ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter><AppShell /></MemoryRouter>);

  let result: Promise<unknown> = Promise.resolve();
  act(() => {
    result = request("/api/admin/_danger", { method: "POST", json: {} });
  });
  await userEvent.type(await screen.findByLabelText("密码"), "correct-horse-battery");
  await userEvent.click(screen.getByRole("button", { name: "验证并继续" }));
  await expect(result).resolves.toEqual({ ok: true });
  expect(guarded).toBe(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});
