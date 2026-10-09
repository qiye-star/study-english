import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import type { Invite } from "./api";
import { InvitesPage } from "./invites-page";

vi.mock("./api");

const invite = (id: number, state: Invite["state"], label = `班级 ${id}`): Invite => ({
  id, label, uses: state === "used_up" ? 5 : 1, maxUses: 5, expiresAt: null, revokedAt: null, createdBy: "ops",
  createdAt: "2026-10-09T09:00:00Z", state,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listInvites).mockResolvedValue([invite(1, "active"), invite(2, "used_up"), invite(3, "expired"), invite(4, "revoked")]);
});

const renderPage = () => render(<MemoryRouter><InvitesPage /></MemoryRouter>);

it("lists invites with state badges and no codes", async () => {
  renderPage();
  expect(await screen.findByText("班级 1")).toBeInTheDocument();
  for (const label of ["可用", "已用完", "已过期", "已撤销"]) expect(screen.getByText(label)).toBeInTheDocument();
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
