import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { UserAdminPanel } from "./user-admin-panel";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getQuotas).mockResolvedValue({
    items: [{ key: "max_conversations", setting: "max_conversations", default: 200, override: null, expiresAt: null, note: "" }],
  });
  asRole("operator");
});
afterEach(() => vi.restoreAllMocks());

const renderPanel = (props: Partial<Parameters<typeof UserAdminPanel>[0]> = {}) =>
  render(
    <MemoryRouter>
      <UserAdminPanel userId={11111111} username="alice" disabledAt={null} {...props} />
    </MemoryRouter>,
  );

it("shows the temporary password once", async () => {
  vi.mocked(api.resetPassword).mockResolvedValue("Tmp4kQ9xW2mPa7Lr");
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "重置密码" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(await screen.findByText("Tmp4kQ9xW2mPa7Lr")).toBeInTheDocument();
  expect(screen.getByText(/请通过安全渠道告知用户/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "我已告知用户,关闭" }));
  expect(screen.queryByText("Tmp4kQ9xW2mPa7Lr")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("requires a reason to disable and hides delete from operators", async () => {
  vi.mocked(api.disableUser).mockResolvedValue({ userId: 11111111, disabledAt: "2026-10-09T09:00:00Z", revoked: 2 });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "停用账号" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "确认" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "批量注册");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.disableUser).toHaveBeenCalledWith(11111111, "批量注册");
  expect(await screen.findByText("已停用,撤销了 2 个登录")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "启用账号" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除用户" })).toBeNull();
});

it("edits a quota override", async () => {
  vi.mocked(api.setQuota).mockResolvedValue(undefined);
  renderPanel();
  const row = await screen.findByTestId("quota-max_conversations");
  await userEvent.click(within(row).getByRole("button", { name: "覆盖" }));
  await userEvent.type(within(row).getByLabelText("覆盖值"), "500");
  await userEvent.click(within(row).getByRole("button", { name: "保存" }));
  expect(api.setQuota).toHaveBeenCalledWith(11111111, "max_conversations", { value: 500, expiresAt: null, note: "" });
});

it("rejects a negative override without calling the server", async () => {
  renderPanel();
  const row = await screen.findByTestId("quota-max_conversations");
  await userEvent.click(within(row).getByRole("button", { name: "覆盖" }));
  await userEvent.type(within(row).getByLabelText("覆盖值"), "-1");
  await userEvent.click(within(row).getByRole("button", { name: "保存" }));
  expect(within(row).getByRole("alert")).toHaveTextContent("请输入不小于 0 的整数");
  expect(api.setQuota).not.toHaveBeenCalled();
});

it("lets a superadmin delete only after typing the username and a reason", async () => {
  asRole("superadmin");
  vi.mocked(api.deleteUser).mockResolvedValue({ deleted: 11111111, recordings_bytes: 0 });
  renderPanel();
  await userEvent.click(await screen.findByRole("button", { name: "删除用户" }));
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "永久删除" });
  await userEvent.type(within(dialog).getByLabelText("输入 alice 以确认"), "alice");
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "用户要求注销");
  await userEvent.click(confirm);
  expect(api.deleteUser).toHaveBeenCalledWith(11111111, "alice", "用户要求注销");
});

it("loads the name and status itself when the detail page passes only the id", async () => {
  vi.mocked(api.getUserStatus).mockResolvedValue({ id: "22222222", username: "bob", disabledAt: "2026-10-09T09:00:00Z" });
  render(
    <MemoryRouter>
      <UserAdminPanel userId="22222222" />
    </MemoryRouter>,
  );
  expect(await screen.findByText("已停用")).toBeInTheDocument();
  expect(api.getUserStatus).toHaveBeenCalledWith("22222222");
});

it("shows viewers the status only", async () => {
  asRole("viewer");
  renderPanel();
  expect(screen.getByText("正常")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "停用账号" })).toBeNull();
  expect(api.getQuotas).not.toHaveBeenCalled();
});
