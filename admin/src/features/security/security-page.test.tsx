import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { SecurityPage } from "./security-page";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: role === "viewer" ? "vic" : "boss", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });

const me = (over: Partial<api.MySecurity> = {}): api.MySecurity => ({
  username: "boss", role: "superadmin", env: false, totpEnabled: false, encryption: true, requireTotp: false, recoveryCodesLeft: 0, ...over,
});

beforeEach(() => {
  vi.mocked(api.listAccounts).mockResolvedValue([
    { id: null, username: "root", role: "superadmin", env: true, totp: false, disabled: false, createdBy: null, createdAt: null, lastLoginAt: null },
    { id: 1, username: "boss", role: "superadmin", env: false, totp: true, disabled: false, createdBy: "root", createdAt: "2026-10-01T00:00:00Z", lastLoginAt: null },
  ]);
  vi.mocked(api.listSessions).mockResolvedValue([
    { id: "s1", username: "boss", ip: "203.0.113.5", userAgent: "Firefox", createdAt: "2026-10-09T00:00:00Z", lastSeenAt: "2026-10-09T00:00:00Z", expiresAt: "2026-10-09T08:00:00Z", current: true, env: false },
  ]);
  vi.mocked(api.getMySecurity).mockResolvedValue(me());
});
afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <SecurityPage />
    </MemoryRouter>,
  );

it("shows the accounts table to superadmins with a locked emergency row", async () => {
  asRole("superadmin");
  renderPage();
  const table = await screen.findByRole("table", { name: "管理员账号" });
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1]).getByText("应急")).toBeInTheDocument();
  expect(within(rows[1]).queryByRole("button")).toBeNull();
  expect(within(rows[1]).queryByRole("combobox")).toBeNull();
  expect(within(rows[2]).getByRole("combobox", { name: "boss 的角色" })).toBeInTheDocument();
  expect(within(rows[2]).getByRole("button", { name: "停用" })).toBeInTheDocument();
});

it("validates the new-admin form before creating", async () => {
  asRole("superadmin");
  vi.mocked(api.createAccount).mockResolvedValue({ id: 2, username: "ops", role: "operator", env: false, totp: false, disabled: false, createdBy: "boss", createdAt: null, lastLoginAt: null });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "新建管理员" }));
  const dialog = screen.getByRole("dialog");
  const create = within(dialog).getByRole("button", { name: "创建" });
  await userEvent.type(within(dialog).getByLabelText("用户名"), "Bad Name");
  await userEvent.type(within(dialog).getByLabelText("初始密码"), "short");
  expect(within(dialog).getByText(/3–32 位小写字母/)).toBeInTheDocument();
  expect(within(dialog).getByText("密码至少 12 位")).toBeInTheDocument();
  expect(create).toBeDisabled();
  await userEvent.clear(within(dialog).getByLabelText("用户名"));
  await userEvent.type(within(dialog).getByLabelText("用户名"), "ops");
  await userEvent.type(within(dialog).getByLabelText("初始密码"), "-long-enough");
  await userEvent.selectOptions(within(dialog).getByLabelText("角色"), "operator");
  await userEvent.click(create);
  expect(api.createAccount).toHaveBeenCalledWith({ username: "ops", password: "short-long-enough", role: "operator" });
});

it("hides accounts from viewers but shows their sessions and two-step card", async () => {
  asRole("viewer");
  vi.mocked(api.getMySecurity).mockResolvedValue(me({ username: "vic", role: "viewer", encryption: false }));
  renderPage();
  expect(await screen.findByRole("heading", { name: "我的会话" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "两步验证" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "管理员账号" })).toBeNull();
  expect(api.listAccounts).not.toHaveBeenCalled();
  expect(screen.getByText(/需要先在 .env 设置加密主密钥/)).toBeInTheDocument();
  expect(screen.queryByLabelText("显示全部管理员")).toBeNull();
});

it("walks through TOTP enrolment and shows recovery codes once", async () => {
  asRole("viewer");
  vi.mocked(api.getMySecurity).mockResolvedValue(me({ username: "vic", role: "viewer" }));
  vi.mocked(api.beginTotp).mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Enjoy%20Admin:vic?secret=JBSWY3DPEHPK3PXP", enrolment: "enc" });
  const codes = ["aaaa-bbbb", "cccc-dddd", "eeee-ffff", "gggg-hhhh", "iiii-jjjj", "kkkk-llll", "mmmm-nnnn", "oooo-pppp"];
  vi.mocked(api.confirmTotp).mockResolvedValue(codes);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "开始绑定" }));
  expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
  expect(screen.getByText(/^otpauth:\/\/totp\//)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("6 位验证码"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "确认绑定" }));
  expect(api.confirmTotp).toHaveBeenCalledWith("enc", "123456");
  const list = await screen.findByRole("list", { name: "恢复码(只显示这一次)" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  expect(screen.getByRole("button", { name: "我已保存" })).toBeInTheDocument();
});
