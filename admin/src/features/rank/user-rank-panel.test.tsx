import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { userRankFixture } from "./test-fixtures";
import { UserRankPanel } from "./user-rank-panel";

vi.mock("./api");
beforeEach(() => {
  vi.mocked(api.getUserRank).mockResolvedValue(userRankFixture());
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role: "operator", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });
});

it("shows gate, cooldown and quota override, and clears the cooldown", async () => {
  vi.mocked(api.clearCooldown).mockResolvedValue(undefined);
  render(<MemoryRouter><UserRankPanel userId={11111111} /></MemoryRouter>);
  expect(await screen.findByText("黄金 I")).toBeInTheDocument();
  expect(screen.getByText("段位门")).toBeInTheDocument();
  expect(screen.getByText("已覆盖为 5 次/日")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "清除冷却" }));
  expect(api.clearCooldown).toHaveBeenCalledWith(11111111);
});

it("resets rank through a confirmed dialog", async () => {
  vi.mocked(api.resetUserRank).mockResolvedValue({ batchId: "b1" });
  render(<MemoryRouter><UserRankPanel userId={11111111} /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "重置段位 / 定级" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.selectOptions(within(dialog).getByLabelText("段位"), "silver");
  await userEvent.type(within(dialog).getByLabelText("理由"), "老用户定级");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.resetUserRank).toHaveBeenCalledWith(11111111, { tier: 1, division: 3, rp: 0, reason: "老用户定级" });
});

it("hides actions from viewers", async () => {
  vi.mocked(session.useAdminSession).mockReturnValue({ ...session.useAdminSession()!, role: "viewer" });
  render(<MemoryRouter><UserRankPanel userId={11111111} /></MemoryRouter>);
  await screen.findByText("黄金 I");
  expect(screen.queryByRole("button", { name: "清除冷却" })).toBeNull();
  expect(screen.queryByRole("button", { name: "作废" })).toBeNull();
});

it("adjusts points with a reason and shows admin adjustments with their author", async () => {
  vi.mocked(api.adjustPoints).mockResolvedValue(userRankFixture().profile!);
  render(<MemoryRouter><UserRankPanel userId="11111111" /></MemoryRouter>);
  expect(await screen.findByText("由 ops · 评委故障补偿")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "加减点" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("点数(正数加、负数减)"), "-20");
  const confirm = within(dialog).getByRole("button", { name: "确认" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "误记的点数");
  await userEvent.click(confirm);
  expect(api.adjustPoints).toHaveBeenCalledWith(11111111, -20, "误记的点数");
});

it("lists matches with status badges and voids a failed one", async () => {
  vi.mocked(api.voidMatch).mockResolvedValue({ ...userRankFixture().matches[0], status: "voided", restored: true });
  render(<MemoryRouter><UserRankPanel userId={11111111} /></MemoryRouter>);
  expect(await screen.findByText("未通过 · 任务完成不足")).toBeInTheDocument();
  expect(screen.getByText("评分失败")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "重评" })).toHaveLength(1);
  await userEvent.click(screen.getAllByRole("button", { name: "作废" })[0]);
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "评委上游故障");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.voidMatch).toHaveBeenCalledWith("m-failed", "评委上游故障");
});

it("grants an achievement from the catalogue", async () => {
  vi.mocked(api.setAchievement).mockResolvedValue(undefined);
  render(<MemoryRouter><UserRankPanel userId={11111111} /></MemoryRouter>);
  await userEvent.click(await screen.findByRole("button", { name: "授予 / 撤销成就" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByLabelText("一周全勤"));
  await userEvent.click(within(dialog).getByLabelText("三日不辍"));
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(vi.mocked(api.setAchievement).mock.calls).toEqual([
    [11111111, "streak_3", false],
    [11111111, "streak_7", true],
  ]);
});
