import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api/client";
import * as endpoints from "./api/endpoints";
import { clearSession, resetSessionForTests, type AdminSession } from "./api/session";
import { AppRoutes } from "./app";

vi.mock("./api/endpoints", () => ({
  getOverview: vi.fn(async () => ({
    totals: { users: 3, conversations: 4, messages: 5, assessments: 6, vocabulary: 7, practice_items: 8, recording_bytes: 5 * 1024 * 1024 },
    daily: [{ date: "2026-10-08", new_users: 1, messages: 2, assessments: 3 }],
  })),
  getSession: vi.fn(),
  login: vi.fn(),
  loginTotp: vi.fn(),
  logout: vi.fn(),
}));

const ROOT: AdminSession = {
  username: "root",
  role: "superadmin",
  csrfToken: "c",
  expiresAt: "2099-01-01T00:00:00+00:00",
  stepUpUntil: null,
  totpEnabled: false,
  safeMode: false,
  maintenanceMode: "off",
};

afterEach(() => {
  cleanup(); // unmount before the store reset, or the guard would try to reload the session
  resetSessionForTests();
  vi.mocked(endpoints.getSession).mockReset();
});

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

describe("route guard", () => {
  it("asks the server for the cookie session and redirects anonymous visitors to the login page", async () => {
    vi.mocked(endpoints.getSession).mockRejectedValue(new ApiError(401, "Unauthorized"));
    open("/users");
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(endpoints.getSession).toHaveBeenCalledTimes(1);
  });

  it("lets an authenticated session through and shows the overview inside the desktop shell", async () => {
    vi.mocked(endpoints.getSession).mockResolvedValue(ROOT);
    open("/");
    expect(await screen.findByText("5.00 MB")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "管理员与会话" })).toBeInTheDocument();
  });

  it("kicks the user back to login when the session is cleared (e.g. after a 401)", async () => {
    vi.mocked(endpoints.getSession).mockResolvedValue(ROOT);
    open("/");
    await screen.findByText("5.00 MB");
    act(() => clearSession());
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("serves v2 placeholder routes from the feature folders", async () => {
    vi.mocked(endpoints.getSession).mockResolvedValue(ROOT);
    open("/rank/rules");
    expect(await screen.findByRole("heading", { name: "段位规则" })).toBeInTheDocument();
  });

  it("shows a use-a-desktop notice instead of business pages below 1024px", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      vi.mocked(endpoints.getSession).mockResolvedValue(ROOT);
      open("/");
      expect(await screen.findByRole("heading", { name: "请使用桌面浏览器访问管理后台" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "主导航" })).toBeNull();
      expect(screen.queryByText("5.00 MB")).toBeNull();
      expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
