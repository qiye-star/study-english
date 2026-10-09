import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as usersApi from "../features/users/api";
import type { UserRow } from "../features/users/api";
import { UsersPage } from "./users-page";

vi.mock("../features/users/api", () => ({ listUsers: vi.fn() }));
const listUsers = vi.mocked(usersApi.listUsers);
const DEFAULT = { status: "all", sort: "recent" };

const user = (n: number): UserRow => ({
  id: `u${n}`,
  username: `user${n}`,
  created_at: "2026-01-01T00:00:00Z",
  conversations: n,
  assessments: n * 2,
  recording_bytes: 2 * 1024 * 1024,
  last_active_at: null,
});
const renderPage = () =>
  render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );

beforeEach(() => listUsers.mockReset());

describe("UsersPage", () => {
  it("shows a loading skeleton, then user cards", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof listUsers>>) => void;
    listUsers.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    expect(screen.getByRole("status")).toBeInTheDocument();
    resolve({ users: [user(1)], page: 1, next: null, total: 1 });
    expect(await screen.findByText("user1")).toBeInTheDocument();
    expect(screen.getByText("共 1 位用户")).toBeInTheDocument();
    expect(screen.getByText("2.00 MB")).toBeInTheDocument();
    expect(screen.getByText(/最近活跃 从未/)).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    listUsers.mockResolvedValue({ users: [], page: 1, next: null, total: 0 });
    renderPage();
    expect(await screen.findByText("还没有用户")).toBeInTheDocument();
  });

  it("shows the server error message and retries", async () => {
    listUsers.mockRejectedValueOnce(new ApiError(500, "数据库繁忙"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("数据库繁忙");
    listUsers.mockResolvedValueOnce({ users: [user(1)], page: 1, next: null, total: 1 });
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("user1")).toBeInTheDocument();
  });

  it("loads the next page via the load-more button using `next`", async () => {
    listUsers.mockResolvedValueOnce({ users: [user(1)], page: 1, next: 2, total: 2 });
    renderPage();
    await screen.findByText("user1");
    listUsers.mockResolvedValueOnce({ users: [user(2)], page: 2, next: null, total: 2 });
    await userEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("user2")).toBeInTheDocument();
    expect(screen.getByText("user1")).toBeInTheDocument();
    expect(listUsers).toHaveBeenLastCalledWith("", 2, DEFAULT);
    expect(screen.queryByRole("button", { name: "加载更多" })).not.toBeInTheDocument();
  });

  it("searches (debounced) and resets to page 1", async () => {
    listUsers.mockResolvedValue({ users: [user(1)], page: 1, next: null, total: 1 });
    renderPage();
    await screen.findByText("user1");
    listUsers.mockResolvedValue({ users: [], page: 1, next: null, total: 0 });
    await userEvent.type(screen.getByRole("searchbox"), "zz");
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith("zz", 1, DEFAULT));
    expect(await screen.findByText("没有匹配的用户")).toBeInTheDocument();
  });

  it("filters by status and sort, and marks disabled users", async () => {
    listUsers.mockResolvedValue({ users: [{ ...user(1), disabled_at: "2026-10-09T09:00:00Z" }], page: 1, next: null, total: 1 });
    renderPage();
    expect(await screen.findByText("user1")).toBeInTheDocument();
    expect(screen.getAllByText("已停用").length).toBeGreaterThan(1); // the chip and the badge
    await userEvent.click(screen.getByRole("button", { name: "已停用" }));
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith("", 1, { status: "disabled", sort: "recent" }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "storage");
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith("", 1, { status: "disabled", sort: "storage" }));
  });
});
