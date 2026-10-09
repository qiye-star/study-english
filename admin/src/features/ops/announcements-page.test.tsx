import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { AnnouncementsPage } from "./announcements-page";

vi.mock("./api");

const root = {
  username: "root", role: "superadmin" as const, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
  totpEnabled: true, safeMode: false, maintenanceMode: "off" as const,
};

beforeEach(() => {
  vi.mocked(api.listAnnouncements).mockReset().mockResolvedValue([]);
  vi.mocked(api.getMaintenance).mockReset().mockResolvedValue({ mode: "off", messageZh: "", messageEn: "" });
  vi.mocked(api.setMaintenance).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.createAnnouncement).mockReset();
  vi.spyOn(session, "useAdminSession").mockReturnValue(root);
  vi.spyOn(session, "refreshSession").mockResolvedValue(undefined);
});

it("switching to read-only requires reason and typed confirmation", async () => {
  render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("radio", { name: "只读" }));
  await userEvent.click(screen.getByRole("button", { name: "应用维护模式" }));
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "确认" });
  await userEvent.type(within(dialog).getByLabelText("理由"), "数据库迁移");
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("输入 MAINTENANCE_MODE 以确认"), "MAINTENANCE_MODE");
  await userEvent.click(confirm);
  expect(api.setMaintenance).toHaveBeenCalledWith(expect.objectContaining({ mode: "read_only", reason: "数据库迁移", confirm: "MAINTENANCE_MODE" }));
  expect(await screen.findByText("维护设置已生效")).toBeInTheDocument();
  expect(session.refreshSession).toHaveBeenCalled();
});

it("turning maintenance off needs a reason but no typed phrase", async () => {
  vi.mocked(api.getMaintenance).mockResolvedValue({ mode: "full", messageZh: "升级中", messageEn: "" });
  render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("radio", { name: "全站" })).toHaveAttribute("aria-checked", "true"));
  await userEvent.click(screen.getByRole("radio", { name: "关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "应用维护模式" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByLabelText("输入 MAINTENANCE_MODE 以确认")).toBeNull();
  await userEvent.type(within(dialog).getByLabelText("理由"), "升级完成");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.setMaintenance).toHaveBeenCalledWith(expect.objectContaining({ mode: "off", confirm: undefined }));
});

it("operators see the maintenance switch read-only", async () => {
  vi.spyOn(session, "useAdminSession").mockReturnValue({ ...root, role: "operator" });
  render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);
  expect(await screen.findByText("只有超级管理员可以切换维护模式")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "只读" })).toBeDisabled();
});

it("counts characters up to 280 for each language and creates with a preview", async () => {
  vi.mocked(api.createAnnouncement).mockResolvedValue({
    id: 1, level: "warning", textZh: "今晚维护", textEn: "", dismissible: true, startsAt: "2026-10-09T00:00:00Z", endsAt: null,
    status: "active", createdBy: "root",
  });
  render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "新建公告" }));
  await userEvent.type(screen.getByLabelText("中文"), "今晚维护");
  expect(screen.getByText("4/280")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "提醒" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByText("今晚维护").length).toBeGreaterThan(0); // banner preview
  await userEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  expect(api.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ level: "warning", textZh: "今晚维护", endsAt: null, dismissible: true }));
  await waitFor(() => expect(api.listAnnouncements).toHaveBeenCalledTimes(2));
});

it("lists announcements with their status", async () => {
  vi.mocked(api.listAnnouncements).mockResolvedValue([
    { id: 1, level: "info", textZh: "新功能上线", textEn: "", dismissible: false, startsAt: "2026-10-09T00:00:00Z", endsAt: null, status: "scheduled", createdBy: "root" },
  ]);
  render(<MemoryRouter><AnnouncementsPage /></MemoryRouter>);
  expect(await screen.findByText("新功能上线")).toBeInTheDocument();
  expect(screen.getByText("未开始")).toBeInTheDocument();
  expect(screen.getByText("常驻")).toBeInTheDocument();
});
