import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ann from "~/api/announcements";
import { renderWithProviders } from "~/test/render";
import { AnnouncementBanner, noteMaintenance, pickText, resetAnnouncementsForTests } from "./announcement-banner";

vi.mock("~/api/announcements");

// 测试默认英文界面;这里按中文界面断言(设置里存语言,SettingsProvider 读取)
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  resetAnnouncementsForTests();
  vi.mocked(ann.fetchAnnouncements).mockReset().mockResolvedValue({
    announcements: [{ id: 3, level: "warning", textZh: "今晚 23:00 维护 10 分钟", textEn: "Maintenance at 23:00", dismissible: true, startsAt: "", endsAt: null }],
    maintenance: { mode: "read_only", messageZh: "正在升级", messageEn: "Upgrading" },
  });
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

it("shows announcements and the read-only notice, and remembers dismissal", async () => {
  const { unmount } = renderWithProviders(<AnnouncementBanner />);
  expect(await screen.findByText("今晚 23:00 维护 10 分钟")).toBeInTheDocument();
  expect(screen.getByText(/暂时只能查看/)).toBeInTheDocument();
  expect(screen.getByText(/正在升级/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "关闭公告" }));
  expect(screen.queryByText("今晚 23:00 维护 10 分钟")).toBeNull();
  expect(JSON.parse(localStorage.getItem("announcement.dismissed")!)).toEqual([3]);
  unmount();
  resetAnnouncementsForTests();
  renderWithProviders(<AnnouncementBanner />);
  await screen.findByText(/暂时只能查看/);
  expect(screen.queryByText("今晚 23:00 维护 10 分钟")).toBeNull();
});

it("uses an amber tone for warnings, a neutral one for info, and has no close button when not dismissible", async () => {
  vi.mocked(ann.fetchAnnouncements).mockResolvedValue({
    announcements: [
      { id: 1, level: "warning", textZh: "提醒", textEn: "", dismissible: true, startsAt: "", endsAt: null },
      { id: 2, level: "info", textZh: "通知", textEn: "", dismissible: false, startsAt: "", endsAt: null },
    ],
    maintenance: { mode: "off", messageZh: "", messageEn: "" },
  });
  renderWithProviders(<AnnouncementBanner />);
  expect((await screen.findByText("提醒")).parentElement).toHaveClass("bg-amber-tint");
  expect(screen.getByText("通知").parentElement).toHaveClass("bg-surface-2");
  expect(screen.getAllByRole("button", { name: "关闭公告" })).toHaveLength(1);
  expect(screen.queryByText(/暂时只能查看/)).toBeNull();
});

it("renders nothing without announcements or maintenance, and survives broken storage", async () => {
  vi.mocked(ann.fetchAnnouncements).mockResolvedValue({ announcements: [], maintenance: { mode: "off", messageZh: "", messageEn: "" } });
  const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { container } = renderWithProviders(<AnnouncementBanner />);
  await vi.waitFor(() => expect(ann.fetchAnnouncements).toHaveBeenCalled());
  expect(container.querySelector("section")).toBeNull();
  getItem.mockRestore();
});

it("picks the text for the interface language", () => {
  expect(pickText("zh-CN", "中文", "English")).toBe("中文");
  expect(pickText("en", "中文", "English")).toBe("English");
  expect(pickText("es", "中文", "")).toBe("中文");
});

it("refreshes at once when an API call answers Maintenance, at most every 10 seconds", async () => {
  noteMaintenance(1_000);
  noteMaintenance(5_000);
  await vi.waitFor(() => expect(ann.fetchAnnouncements).toHaveBeenCalledTimes(1));
  noteMaintenance(11_500);
  await vi.waitFor(() => expect(ann.fetchAnnouncements).toHaveBeenCalledTimes(2));
});
