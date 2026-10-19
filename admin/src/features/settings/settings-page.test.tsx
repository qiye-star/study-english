import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { SettingsPage } from "./settings-page";
import { fixtureList, smtpHostItem } from "./test-fixtures";

vi.mock("./api");
beforeEach(() => {
  vi.mocked(api.listSettings).mockResolvedValue(fixtureList());
  vi.mocked(api.getDoctor).mockResolvedValue({ findings: [] });
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "root", role: "superadmin", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:group?" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

it("groups settings, masks secrets and flags restart-required rows", async () => {
  renderAt("/settings/llm");
  const row = await screen.findByTestId("setting-upstream_llm_key");
  expect(within(row).getByText("已设置 · a1b2c3d4")).toBeInTheDocument();
  expect(within(row).getByLabelText("新值(留空不修改)")).toHaveAttribute("type", "password");
  renderAt("/settings/asr");
  expect(await screen.findAllByText("待重启")).not.toHaveLength(0);
});

it("collects drafts and reviews a diff before saving", async () => {
  vi.mocked(api.saveSettings).mockResolvedValue({ revision: 7, changed: ["rate_limit_per_minute"], pendingRestart: [], applyErrors: [] });
  renderAt("/settings/limits");
  const input = await screen.findByLabelText("登录/注册每分钟次数(按 IP)");
  await userEvent.clear(input);
  await userEvent.type(input, "25");
  expect(screen.getByText("1 项未保存")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "检查并保存" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("10")).toBeInTheDocument();
  expect(within(dialog).getByText("25")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ changes: { rate_limit_per_minute: 25 } }));
  expect(await screen.findByText("已保存(修订 #7)")).toBeInTheDocument();
  expect(screen.queryByText("1 项未保存")).toBeNull();
});

it("is read-only for viewers", async () => {
  vi.mocked(session.useAdminSession).mockReturnValue({ ...session.useAdminSession()!, role: "viewer" });
  renderAt("/settings/limits");
  expect(await screen.findByLabelText("登录/注册每分钟次数(按 IP)")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "检查并保存" })).toBeNull();
  expect(screen.queryByRole("button", { name: "导出" })).toBeNull();
});

it("shows the doctor summary, the restart bar and flag availability", async () => {
  vi.mocked(api.getDoctor).mockResolvedValue({
    findings: [{ level: "error", code: "realtime_unavailable", keys: ["volcengine_tts_key"], message: "实时通话已开启但不可用" }],
  });
  renderAt("/settings");
  expect(await screen.findByText(/1 个错误 · 0 个提醒/)).toBeInTheDocument();
  expect(screen.getByText("1 项设置等待重启生效")).toBeInTheDocument();
  expect(screen.getByTestId("flag-realtime_enabled")).toHaveTextContent("缺少或无效:VOLCENGINE_TTS_KEY");
});

it("offers the SMTP probe on the smtp_host row", async () => {
  const list = fixtureList();
  vi.mocked(api.listSettings).mockResolvedValue({ ...list, groups: [...list.groups, ["accounts", "账号与邮件"]], items: [...list.items, smtpHostItem()] });
  renderAt("/settings/accounts");
  const row = await screen.findByTestId("setting-smtp_host");
  expect(within(row).getByRole("button", { name: "测试连接" })).toBeInTheDocument();
});
