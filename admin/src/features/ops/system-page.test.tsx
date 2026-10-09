import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { SystemPage } from "./system-page";

vi.mock("./api");

const status = (over: Partial<api.SystemStatus> = {}): api.SystemStatus => ({
  version: "0.7.9",
  buildSha: "abc1234",
  python: "3.12.1",
  startedAt: "2026-10-09T08:00:00Z",
  uptimeSeconds: 3700,
  workers: 1,
  db: { backend: "sqlite", sizeBytes: 2048, alembicCurrent: "0008", alembicHead: "0008" },
  disk: { path: "/data", total: 1000, used: 500, free: 500 },
  recordingsBytes: 4096,
  realtimeActive: 2,
  roomsConnections: 5,
  meter: { depth: 3, dropped: 0 },
  tasks: { watcher: true, metering: true, rooms_sweeper: true, backups: true },
  settings: { revision: 4, safeMode: false, pendingRestart: [], invalid: {}, loadError: null },
  findings: { error: 0, warn: 0 },
  ...over,
});

beforeEach(() => vi.mocked(api.getSystem).mockReset());

it("renders grouped cards with no warnings when healthy", async () => {
  vi.mocked(api.getSystem).mockResolvedValue(status());
  render(<SystemPage />);
  expect(await screen.findByText("一切正常")).toBeInTheDocument();
  expect(screen.getByText("0008 / 0008")).toBeInTheDocument();
  expect(screen.queryByText("数据库未迁移到最新")).toBeNull();
  expect(screen.getByText("1 小时 1 分")).toBeInTheDocument();
});

it("flags an outdated migration, low disk and stopped tasks", async () => {
  vi.mocked(api.getSystem).mockResolvedValue(
    status({
      db: { backend: "sqlite", sizeBytes: null, alembicCurrent: "0007", alembicHead: "0008" },
      disk: { path: "/data", total: 1000, used: 950, free: 50 },
      tasks: { watcher: true, metering: false, rooms_sweeper: null, backups: true },
      findings: { error: 2, warn: 1 },
    }),
  );
  render(<SystemPage />);
  expect(await screen.findByText("数据库未迁移到最新")).toHaveClass("text-warn");
  expect(screen.getByText("磁盘可用空间不足 10%")).toBeInTheDocument();
  const tasks = screen.getByRole("region", { name: "后台任务" });
  const row = within(tasks).getByText("计量刷写").closest("div")!;
  expect(within(row).getByText("已停止")).toBeInTheDocument();
  expect(row.querySelector(".bg-bad")).not.toBeNull();
  expect(within(tasks).getByText("未启动")).toBeInTheDocument();
  expect(screen.getByText("2 个错误 · 1 个提醒")).toBeInTheDocument();
});
