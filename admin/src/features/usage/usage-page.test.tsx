import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { summaryFixture } from "./test-fixtures";
import { UsagePage } from "./usage-page";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getSummary: vi.fn(), getTopUsers: vi.fn(), getHealth: vi.fn() };
});

const viewer = {
  username: "v", role: "viewer" as const, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
  totpEnabled: false, safeMode: false, maintenanceMode: "off" as const,
};

beforeEach(() => {
  vi.mocked(api.getSummary).mockReset().mockResolvedValue(summaryFixture({ costComplete: false }));
  vi.mocked(api.getTopUsers).mockReset().mockResolvedValue([{ userId: 1, username: "alice", calls: 120, cost: 3.2 }]);
  vi.mocked(api.getHealth).mockReset().mockResolvedValue([]);
  vi.spyOn(session, "useAdminSession").mockReturnValue(viewer);
});

it("shows KPIs labelled as estimates and switches ranges", async () => {
  render(<MemoryRouter><UsagePage /></MemoryRouter>);
  expect(await screen.findByText("¥12.48")).toBeInTheDocument();
  expect(screen.getByText("估算")).toBeInTheDocument();
  expect(screen.getByText("部分模型缺单价")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "去设置单价表" })).toHaveAttribute("href", "/settings/ops");
  await userEvent.click(screen.getByRole("radio", { name: "30 天" }));
  expect(api.getSummary).toHaveBeenLastCalledWith(30);
  await waitFor(() => expect(api.getTopUsers).toHaveBeenLastCalledWith(30, "cost"));
  expect(await screen.findByRole("link", { name: "alice" })).toHaveAttribute("href", "/users/1");
});

it("hides the price warning when every call is priced and breaks errors down", async () => {
  vi.mocked(api.getSummary).mockResolvedValue(summaryFixture({ costComplete: true }));
  render(<MemoryRouter><UsagePage /></MemoryRouter>);
  expect(await screen.findByText("¥12.48")).toBeInTheDocument();
  expect(screen.queryByText("部分模型缺单价")).toBeNull();
  expect(screen.getByText("429 限流")).toBeInTheDocument();
  expect(screen.getByText("5 · 41.7%")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "按调用数" }));
  expect(api.getTopUsers).toHaveBeenLastCalledWith(7, "calls");
});

it("shows the probe shortcut only to superadmins", async () => {
  vi.mocked(api.getHealth).mockResolvedValue([
    { kind: "llm", provider: "deepseek", calls: 10, errors: 1, successRate: 0.9, lastErrorStatus: 429, lastErrorAt: null },
  ]);
  const { unmount } = render(<MemoryRouter><UsagePage /></MemoryRouter>);
  expect(await screen.findByText("deepseek")).toBeInTheDocument();
  expect(screen.getByText("90.0%")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "测试连接" })).toBeNull();
  unmount();
  vi.spyOn(session, "useAdminSession").mockReturnValue({ ...viewer, role: "superadmin" });
  render(<MemoryRouter><UsagePage /></MemoryRouter>);
  expect(await screen.findByRole("link", { name: "测试连接" })).toBeInTheDocument();
});
