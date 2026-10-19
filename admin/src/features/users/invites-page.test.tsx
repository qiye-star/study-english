import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import type { Invite } from "./api";
import { InvitesPage } from "./invites-page";

vi.mock("./api");

const invite = (id: number, state: Invite["state"], label = `班级 ${id}`, over: Partial<Invite> = {}): Invite => ({
  id, label, kind: "admin", uses: state === "used_up" ? 5 : 1, maxUses: 5, expiresAt: null, revokedAt: null, createdBy: "ops",
  createdAt: "2026-10-09T09:00:00Z", state, owner: null, redeemers: { total: 0, usernames: [] }, ...over,
});

const userCode = (id: number, over: Partial<Invite> = {}): Invite => invite(id, "active", "", {
  kind: "user", maxUses: 10, uses: 2, createdBy: "user", owner: { id: 7, username: "alice", nickname: "小艾" },
  redeemers: { total: 2, usernames: ["bob", "carol"] }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listInvites).mockResolvedValue([invite(1, "active"), invite(2, "used_up"), invite(3, "expired"), invite(4, "revoked")]);
});

const renderPage = () => render(<MemoryRouter><InvitesPage /></MemoryRouter>);

it("lists invites with state badges and no codes", async () => {
  renderPage();
  expect(await screen.findByText("班级 1")).toBeInTheDocument();
  const table = within(screen.getByRole("table"));
  for (const label of ["可用", "已用完", "已过期", "已撤销"]) expect(table.getByText(label)).toBeInTheDocument();
  expect(screen.getByText("5 / 5")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "撤销" })).toHaveLength(3); // revoked ones have no action
});

it("shows a new code exactly once", async () => {
  vi.mocked(api.createInvite).mockResolvedValue({ invite: invite(9, "active", "三年二班"), code: "ABCD-EFGH-JKMN" });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "新建邀请码" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("标签"), "三年二班");
  await userEvent.clear(within(dialog).getByLabelText("可用次数"));
  await userEvent.type(within(dialog).getByLabelText("可用次数"), "30");
  await userEvent.click(within(dialog).getByRole("button", { name: "创建" }));
  expect(api.createInvite).toHaveBeenCalledWith({ label: "三年二班", maxUses: 30, expiresAt: null });
  expect(await screen.findByText("ABCD-EFGH-JKMN")).toBeInTheDocument();
  expect(screen.getByText(/仅显示这一次/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "我已保存,关闭" }));
  expect(screen.queryByText("ABCD-EFGH-JKMN")).toBeNull();
});

it("validates the use count", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "新建邀请码" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.clear(within(dialog).getByLabelText("可用次数"));
  await userEvent.type(within(dialog).getByLabelText("可用次数"), "0");
  await userEvent.click(within(dialog).getByRole("button", { name: "创建" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("可用次数为 1–1000");
  expect(api.createInvite).not.toHaveBeenCalled();
});

it("revokes an invite after confirmation", async () => {
  vi.mocked(api.revokeInvite).mockResolvedValue(undefined);
  renderPage();
  await screen.findByText("班级 1");
  await userEvent.click(screen.getAllByRole("button", { name: "撤销" })[0]);
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "撤销" }));
  expect(api.revokeInvite).toHaveBeenCalledWith(1);
});

it("filters by kind, state and owner and sends them to the listing", async () => {
  renderPage();
  await screen.findByText("班级 1");
  await userEvent.selectOptions(screen.getByLabelText("种类"), "user");
  expect(api.listInvites).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "user", state: "all" }));
  await userEvent.selectOptions(screen.getByLabelText("状态"), "active");
  expect(api.listInvites).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "user", state: "active" }));
  await userEvent.type(screen.getByLabelText("所有者"), "alice");
  await userEvent.click(screen.getByRole("button", { name: "筛选" }));
  expect(api.listInvites).toHaveBeenLastCalledWith({ kind: "user", state: "active", owner: "alice" });
});

it("shows the owner by login name with the nickname beside it, and the redeemers count", async () => {
  vi.mocked(api.listInvites).mockResolvedValue([userCode(5)]);
  renderPage();
  const row = (await screen.findByText("alice")).closest("tr") as HTMLElement;
  expect(within(row).getByText("小艾")).toBeInTheDocument();
  expect(within(row).getByText("用户码")).toBeInTheDocument();
  expect(within(row).getByText("2 人")).toBeInTheDocument();
  expect(within(row).getByText("bob、carol")).toBeInTheDocument();
  expect(within(row).getByText("2 / 10")).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "撤销" })).toBeNull(); // user codes are revoked from the user's card
});

it("opens the redemption list with usernames and a disabled marker", async () => {
  vi.mocked(api.listRedemptions).mockResolvedValue([
    { userId: 11, username: "bob", nickname: null, redeemedAt: "2026-10-18T09:00:00Z", disabled: false },
    { userId: 12, username: "dan", nickname: "丹", redeemedAt: "2026-10-17T09:00:00Z", disabled: true },
    { userId: null, username: null, nickname: null, redeemedAt: "2026-10-16T09:00:00Z", disabled: false },
  ]);
  renderPage();
  await screen.findByText("班级 2");
  const row = screen.getByText("班级 2").closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: "兑换明细" }));
  expect(api.listRedemptions).toHaveBeenCalledWith(2);
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("bob")).toBeInTheDocument();
  expect(within(dialog).getByText("已停用")).toBeInTheDocument();
  expect(within(dialog).getByText("已删除")).toBeInTheDocument();
});

it("opens the batch dialog from the page header", async () => {
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "批量新建" }));
  expect(within(screen.getByRole("dialog")).getByText("批量新建邀请码")).toBeInTheDocument();
});
