import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ann from "~/api/announcements";
import { ApiClient } from "~/api/client";
import { AppRoutes } from "~/app";
import { AuthContext, type AuthContextValue } from "~/auth/auth-context";
import { SettingsProvider } from "~/settings/settings-context";
import { resetAnnouncementsForTests } from "./announcement-banner";
import { MaintenanceScreen } from "./maintenance-screen";

vi.mock("~/api/announcements");

// 测试默认英文界面;这里按中文界面断言(设置里存语言,SettingsProvider 读取)
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  resetAnnouncementsForTests();
});

function renderApp(route: string) {
  const value: AuthContextValue = {
    user: { id: "12345678", name: "alice" },
    api: new ApiClient({ getToken: () => "t", fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) }),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <SettingsProvider>
        <MemoryRouter initialEntries={[route]}>
          <AppRoutes />
        </MemoryRouter>
      </SettingsProvider>
    </AuthContext.Provider>,
  );
}

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

it("shows the maintenance page instead of the app (no bottom navigation) in full maintenance", async () => {
  vi.mocked(ann.fetchAnnouncements).mockResolvedValue({
    announcements: [],
    maintenance: { mode: "full", messageZh: "数据库升级,预计 10 分钟", messageEn: "Upgrading" },
  });
  renderApp("/me");
  expect(await screen.findByText("数据库升级,预计 10 分钟")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "服务维护中" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.getByRole("button", { name: "重新检查" })).toBeInTheDocument();
});

it("falls back to a default message", () => {
  render(<MaintenanceScreen />);
  expect(screen.getByText("我们正在升级服务,请稍后再来。")).toBeInTheDocument();
});

it("keeps the app (with the read-only notice) when maintenance is read-only", async () => {
  vi.mocked(ann.fetchAnnouncements).mockResolvedValue({
    announcements: [],
    maintenance: { mode: "read_only", messageZh: "", messageEn: "" },
  });
  renderApp("/me");
  expect(await screen.findByText(/暂时只能查看/)).toBeInTheDocument();
  expect(screen.getByRole("navigation")).toBeInTheDocument();
});
