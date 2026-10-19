import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import type { AvatarReportRow } from "./api";
import { AvatarReportsPage } from "./avatar-reports-page";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });

const row = (over: Partial<AvatarReportRow> = {}): AvatarReportRow => ({
  userId: "11",
  username: "alice",
  nickname: "小艾",
  avatarUrl: "/api/avatars/abc123",
  reports: 3,
  lastReason: "inappropriate",
  lastReportedAt: "2026-10-18T08:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  asRole("operator");
  vi.mocked(api.listAvatarReports).mockResolvedValue({ users: [row()], page: 1, next: null });
});
afterEach(() => vi.restoreAllMocks());

const renderPage = () =>
  render(
    <MemoryRouter>
      <AvatarReportsPage />
    </MemoryRouter>,
  );

it("lists the open queue with thumbnail, names, count and a localized reason", async () => {
  const { container } = renderPage();
  expect(await screen.findByText("alice")).toBeInTheDocument();
  expect(screen.getByText("小艾")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.getByText("不当内容")).toBeInTheDocument();
  const img = container.querySelector("img");
  expect(img).toHaveAttribute("src", "/api/avatars/abc123");
  expect(img).toHaveAttribute("alt", "");
  expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(api.listAvatarReports).toHaveBeenLastCalledWith("open", 1);
});

it("removes the avatar only after a reason, then refreshes the queue", async () => {
  vi.mocked(api.removeUserAvatar).mockResolvedValue({ userId: "11", reportsResolved: 3 });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "移除头像" }));
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "移除头像" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "冒充管理员");
  await userEvent.click(confirm);
  expect(api.removeUserAvatar).toHaveBeenCalledWith("11", "冒充管理员");
  expect(await screen.findByText("已移除头像,处理了 3 条举报")).toBeInTheDocument();
  await waitFor(() => expect(api.listAvatarReports).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("dismisses the open reports after a plain confirm", async () => {
  vi.mocked(api.dismissAvatarReports).mockResolvedValue({ userId: "11", reportsResolved: 3 });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "忽略举报" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.dismissAvatarReports).toHaveBeenCalledWith("11");
  expect(await screen.findByText("已忽略,处理了 3 条举报")).toBeInTheDocument();
});

it("switches to resolved reports and shows the resolved empty state without ignore", async () => {
  renderPage();
  await screen.findByText("alice");
  vi.mocked(api.listAvatarReports).mockResolvedValue({ users: [], page: 1, next: null });
  await userEvent.click(screen.getByRole("tab", { name: "已处理" }));
  await waitFor(() => expect(api.listAvatarReports).toHaveBeenLastCalledWith("resolved", 1));
  expect(await screen.findByText("还没有处理过的头像举报")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "忽略举报" })).toBeNull();
});

it("shows the open empty state", async () => {
  vi.mocked(api.listAvatarReports).mockResolvedValue({ users: [], page: 1, next: null });
  renderPage();
  expect(await screen.findByText("暂无待处理的头像举报")).toBeInTheDocument();
});

it("pages forward with the next page number", async () => {
  vi.mocked(api.listAvatarReports).mockResolvedValue({ users: [row()], page: 1, next: 2 });
  renderPage();
  await screen.findByText("alice");
  await userEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(api.listAvatarReports).toHaveBeenLastCalledWith("open", 2);
});

it("shows initials and no remove action for a user without an avatar", async () => {
  vi.mocked(api.listAvatarReports).mockResolvedValue({ users: [row({ avatarUrl: null })], page: 1, next: null });
  const { container } = renderPage();
  expect(await screen.findByText("alice")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByRole("button", { name: "移除头像" })).toBeNull();
  expect(screen.getByRole("button", { name: "忽略举报" })).toBeInTheDocument();
});

it("hides every action from viewers", async () => {
  asRole("viewer");
  renderPage();
  expect(await screen.findByText("alice")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "移除头像" })).toBeNull();
  expect(screen.queryByRole("button", { name: "忽略举报" })).toBeNull();
});
