import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { DataPage } from "./data-page";
import { startDownload } from "./download";

vi.mock("./api");
vi.mock("./download", () => ({ startDownload: vi.fn() }));
const renderPage = () => render(<MemoryRouter><DataPage /></MemoryRouter>);

beforeEach(() => {
  for (const fn of [api.listBackups, api.createBackup, api.backupLink, api.deleteBackup, api.scanHousekeeping, api.runHousekeeping, api.getStorage]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(api.getStorage).mockResolvedValue({
    roomAudio: { files: 1, bytes: 3000, stagingBytes: 64, byMonth: [{ month: "2026-10", files: 1, bytes: 3000 }] },
    recordings: { files: 3, bytes: 1048576 },
    topVoiceUsers: [{ userId: 7, username: "lily", bytes: 3000 }],
  });
  vi.mocked(api.listBackups).mockResolvedValue({
    supported: true, hint: null, keep: 7, hourUtc: 3,
    backups: [{ name: "app-20261009-030000.db", bytes: 2048, createdAt: "2026-10-09T03:00:00Z" }],
  });
});

it("shows the pg_dump hint and no backup button on Postgres", async () => {
  vi.mocked(api.listBackups).mockResolvedValue({ supported: false, hint: "docker compose exec postgres pg_dump -U enjoy enjoy", keep: 7, hourUtc: -1, backups: [] });
  renderPage();
  expect(await screen.findByText("PostgreSQL 请用 pg_dump 备份")).toBeInTheDocument();
  expect(screen.getByText(/pg_dump -U enjoy/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "立即备份" })).toBeNull();
});

it("lists backups, backs up now and downloads through a short-lived link", async () => {
  vi.mocked(api.createBackup).mockResolvedValue({ name: "app-20261009-040000.db", bytes: 1, createdAt: "" });
  vi.mocked(api.backupLink).mockResolvedValue("/api/admin/backups/download/tok");
  renderPage();
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
  renderPage();
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

it("shows storage usage for room voice, staging and recordings", async () => {
  renderPage();
  const card = await screen.findByRole("region", { name: "存储" });
  expect(await within(card).findByText("房间语音 1 个文件 · 2.93 KB")).toBeInTheDocument();
  expect(within(card).getByText("暂存 64 B")).toBeInTheDocument();
  expect(within(card).getByText("跟读录音 3 个文件 · 1.00 MB")).toBeInTheDocument();
  expect(within(card).getByRole("row", { name: /2026-10/ })).toHaveTextContent("2.93 KB");
  expect(within(card).getByRole("link", { name: "lily" })).toHaveAttribute("href", "/users/7");
});

it("room audio purge: scan with days, then typed confirmation, reason and token", async () => {
  vi.mocked(api.scanHousekeeping).mockResolvedValue({
    token: "t0k", count: 2, bytes: 3010, rooms: 1, samples: ["room_audio/r1/m1.mp3"], olderThanDays: 400, confirm: "DELETE 2 FILES",
  } as never);
  vi.mocked(api.runHousekeeping).mockResolvedValue({ deleted: 2 });
  renderPage();
  const card = await screen.findByRole("region", { name: "房间语音清理" });
  const days = within(card).getByLabelText("删除结束早于(天)的房间音频");
  expect(days).toHaveValue("365");
  await userEvent.clear(days);
  await userEvent.type(days, "20");
  expect(within(card).getByRole("button", { name: "扫描" })).toBeDisabled();
  expect(within(card).getByText("至少 30 天")).toBeInTheDocument();
  await userEvent.clear(days);
  await userEvent.type(days, "400");
  await userEvent.click(within(card).getByRole("button", { name: "扫描" }));
  expect(api.scanHousekeeping).toHaveBeenCalledWith("room_audio", 400);
  expect(await within(card).findByText("2 个文件 · 2.94 KB")).toBeInTheDocument();
  await userEvent.click(within(card).getByRole("button", { name: "删除这些音频" }));
  const dialog = screen.getByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "删除" });
  await userEvent.type(within(dialog).getByLabelText("理由"), "磁盘快满了");
  expect(confirm).toBeDisabled(); // the phrase is still missing
  await userEvent.type(within(dialog).getByLabelText(/DELETE 2 FILES/), "DELETE 2 FILES");
  await userEvent.click(confirm);
  expect(api.runHousekeeping).toHaveBeenCalledWith("room_audio", {
    token: "t0k", olderThanDays: 400, reason: "磁盘快满了", confirm: "DELETE 2 FILES",
  });
  expect(await within(card).findByText("已删除 2 个")).toBeInTheDocument();
});

it("audit purge cannot go below the retention period", async () => {
  vi.mocked(api.scanHousekeeping).mockResolvedValue({ retentionDays: 365, count: 12 } as never);
  renderPage();
  const card = await screen.findByRole("region", { name: "审计清理" });
  await userEvent.click(within(card).getByRole("button", { name: "扫描" }));
  expect(await within(card).findByText("早于 365 天的记录:12 条")).toBeInTheDocument();
  const input = within(card).getByLabelText("删除早于(天)");
  await userEvent.clear(input);
  await userEvent.type(input, "30");
  expect(within(card).getByRole("button", { name: "清理" })).toBeDisabled();
  expect(within(card).getByText("不能小于保留期 365 天")).toBeInTheDocument();
});
