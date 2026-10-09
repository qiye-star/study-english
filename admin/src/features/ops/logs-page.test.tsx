import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { LogsPage } from "./logs-page";

vi.mock("./api");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(api.getLogs)
    .mockReset()
    .mockResolvedValueOnce([{ id: 1, at: "2026-10-09T09:00:00Z", level: "WARNING", logger: "app.timing", message: "slow ticket=[redacted]" }])
    .mockResolvedValue([{ id: 2, at: "2026-10-09T09:00:05Z", level: "INFO", logger: "app.x", message: "next" }]);
});
afterEach(() => vi.useRealTimers());

it("polls incrementally with after_id when auto refresh is on", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<LogsPage />);
  expect(await screen.findByText("slow ticket=[redacted]")).toHaveClass("text-warn");
  expect(screen.getByText("仅内存中最近 2000 条,已脱敏;重启后清空")).toBeInTheDocument();
  const toggle = screen.getByRole("switch", { name: "自动刷新(5 秒)" });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-checked", "true");
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(api.getLogs).toHaveBeenLastCalledWith(expect.objectContaining({ afterId: 1 }));
  expect(await screen.findByText("next")).toBeInTheDocument();
  expect(screen.getByText("slow ticket=[redacted]")).toBeInTheDocument(); // appended, not replaced
});

it("filters by level, logger prefix and keyword", async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<LogsPage />);
  await screen.findByText("slow ticket=[redacted]");
  await user.selectOptions(screen.getByLabelText("级别"), "ERROR");
  await user.type(screen.getByLabelText("logger 前缀"), "app.rooms");
  await user.type(screen.getByLabelText("关键字"), "boom");
  await user.click(screen.getByRole("button", { name: "查询" }));
  expect(api.getLogs).toHaveBeenLastCalledWith({ level: "ERROR", logger: "app.rooms", q: "boom", afterId: undefined });
});
