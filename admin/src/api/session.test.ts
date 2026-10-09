import { afterEach, describe, expect, it, vi } from "vitest";
import * as endpoints from "./endpoints";
import {
  clearSession,
  getAdminSession,
  getCsrf,
  getSessionStatus,
  hasRole,
  loadSession,
  logout,
  resetSessionForTests,
  setPendingCsrf,
  setSession,
  type AdminSession,
} from "./session";

vi.mock("./endpoints", () => ({ getSession: vi.fn(), logout: vi.fn() }));

const S1: AdminSession = {
  username: "ops",
  role: "operator",
  csrfToken: "csrf-1",
  expiresAt: "2099-01-01T00:00:00+00:00",
  stepUpUntil: null,
  totpEnabled: false,
  safeMode: false,
  maintenanceMode: "off",
};

afterEach(() => {
  vi.mocked(endpoints.getSession).mockReset();
  vi.mocked(endpoints.logout).mockReset();
  resetSessionForTests();
});

describe("admin session store", () => {
  it("loads the cookie session from the server and exposes its CSRF token", async () => {
    vi.mocked(endpoints.getSession).mockResolvedValue(S1);
    expect(getSessionStatus()).toBe("unknown");
    const p = loadSession();
    expect(getSessionStatus()).toBe("loading");
    await expect(p).resolves.toEqual(S1);
    expect(getSessionStatus()).toBe("known");
    expect(getCsrf()).toBe("csrf-1");
  });

  it("treats a failed session load as logged out", async () => {
    vi.mocked(endpoints.getSession).mockRejectedValue(new Error("401"));
    await expect(loadSession()).resolves.toBeNull();
    expect(getSessionStatus()).toBe("known");
    expect(getAdminSession()).toBeNull();
  });

  it("shares one in-flight request between concurrent loads", async () => {
    vi.mocked(endpoints.getSession).mockResolvedValue(S1);
    await Promise.all([loadSession(), loadSession()]);
    expect(endpoints.getSession).toHaveBeenCalledTimes(1);
  });

  it("uses the pending CSRF only until a session exists", () => {
    setPendingCsrf("pending");
    expect(getCsrf()).toBe("pending");
    setSession(S1);
    expect(getCsrf()).toBe("csrf-1");
    clearSession();
    expect(getCsrf()).toBeNull();
  });

  it("logs out on the server and always clears locally", async () => {
    setSession(S1);
    vi.mocked(endpoints.logout).mockRejectedValue(new Error("network"));
    await logout();
    expect(endpoints.logout).toHaveBeenCalled();
    expect(getAdminSession()).toBeNull();
  });

  it("ranks roles", () => {
    expect(hasRole(S1, "viewer")).toBe(true);
    expect(hasRole(S1, "operator")).toBe(true);
    expect(hasRole(S1, "superadmin")).toBe(false);
    expect(hasRole(null, "viewer")).toBe(false);
  });
});
