import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { DataPage } from "./data-page";
import { startDownload } from "./download";

vi.mock("./api");
vi.mock("./download", () => ({ startDownload: vi.fn() }));

beforeEach(() => {
  for (const fn of [api.listBackups, api.createBackup, api.backupLink, api.deleteBackup, api.scanHousekeeping, api.runHousekeeping]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(api.listBackups).mockResolvedValue({
    supported: true, hint: null, keep: 7, hourUtc: 3,
    backups: [{ name: "app-20261009-030000.db", bytes: 2048, createdAt: "2026-10-09T03:00:00Z" }],
  });
});

it("shows the pg_dump hint and no backup button on Postgres", async () => {
  vi.mocked(api.listBackups).mockResolvedValue({ supported: false, hint: "docker compose exec postgres pg_dump -U enjoy enjoy", keep: 7, hourUtc: -1, backups: [] });
  render(<DataPage />);
  expect(await screen.findByText("PostgreSQL 请用 pg_dump 备份")).toBeInTheDocument();
  expect(screen.getByText(/pg_dump -U enjoy/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "立即备份" })).toBeNull();
});

it("lists backups, backs up now and downloads through a short-lived link", async () => {
  vi.mocked(api.createBackup).mockResolvedValue({ name: "app-20261009-040000.db", bytes: 1, createdAt: "" });
  vi.mocked(api.backupLink).mockResolvedValue("/api/admin/backups/download/tok");
  render(<DataPage />);
  expect(await screen.findByText("app-20261009-030000.db")).toBeInTheDocument();
  expect(screen.getByText(/保留最近 7 份;每日自动备份:UTC 3 点/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "立即备份" }));
  await waitFor(() => expect(api.listBackups).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "下载" }));
  await waitFor(() => expect(api.backupLink).toHaveBeenCalledWith("app-20261009-030000.db"));
  expect(startDownload).toHaveBeenCalledWith("/api/admin/backups/download/tok");
});

it("scans orphan recordings and deletes them with the scan token after confirmation", async () => {
  vi.mocked(api.scanHousekeeping).mockResolvedValue({ token: "t0k", count: 1, bytes: 8, samples: ["recordings/1/ghost.wav"] } as never);
  vi.mocked(api.runHousekeeping).mockResolvedValue({ deleted: 1 });
  render(<DataPage />);
  const card = await screen.findByRole("region", { name: "孤儿录音" });
  await userEvent.click(within(card).getByRole("button", { name: "扫描" }));
  expect(await within(card).findByText("1 个文件 · 8 B")).toBeInTheDocument();
  expect(within(card).getByText("recordings/1/ghost.wav")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "删除这些文件" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "清理孤儿录音");
  await userEvent.click(within(dialog).getByRole("button", { name: "删除" }));
  expect(api.runHousekeeping).toHaveBeenCalledWith("orphan_recordings", expect.objectContaining({ token: "t0k", reason: "清理孤儿录音" }));
  expect(await within(card).findByText("已删除 1 个")).toBeInTheDocument();
});

it("audit purge cannot go below the retention period", async () => {
  vi.mocked(api.scanHousekeeping).mockResolvedValue({ retentionDays: 365, count: 12 } as never);
  render(<DataPage />);
  const card = await screen.findByRole("region", { name: "审计清理" });
  await userEvent.click(within(card).getByRole("button", { name: "扫描" }));
  expect(await within(card).findByText("早于 365 天的记录:12 条")).toBeInTheDocument();
  const input = within(card).getByLabelText("删除早于(天)");
  await userEvent.clear(input);
  await userEvent.type(input, "30");
  expect(within(card).getByRole("button", { name: "清理" })).toBeDisabled();
  expect(within(card).getByText("不能小于保留期 365 天")).toBeInTheDocument();
});
