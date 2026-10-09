import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { RoomDetailPage } from "./room-detail-page";
import { roomFixture, settingsFixture, timelineFixture } from "./test-fixtures";

vi.mock("./api");
const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getRoom).mockResolvedValue(roomFixture());
  vi.mocked(api.getRoomMessages).mockResolvedValue(timelineFixture());
  asRole("operator");
});
afterEach(() => vi.restoreAllMocks());
const renderPage = () =>
  render(<MemoryRouter initialEntries={["/rooms/r1"]}><Routes><Route path="/rooms/:id" element={<RoomDetailPage />} /></Routes></MemoryRouter>);

it("loads public lane by default and asks before showing private lane", async () => {
  renderPage();
  expect(await screen.findByText("I like chocolate, especially dark chocolate.")).toBeInTheDocument();
  expect(api.getRoomMessages).toHaveBeenLastCalledWith("r1", { lane: "public", beforeSeq: null });
  await userEvent.click(screen.getByRole("switch", { name: "显示私聊" }));
  expect(screen.getByText("查看私聊会写入审计日志")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "继续" }));
  expect(api.getRoomMessages).toHaveBeenLastCalledWith("r1", { lane: "all", beforeSeq: null });
  expect(screen.getByRole("switch", { name: "显示私聊" })).toHaveAttribute("aria-checked", "true");
});

it("hides a message and kicks a member with reasons", async () => {
  vi.mocked(api.hideMessage).mockResolvedValue(undefined);
  vi.mocked(api.kickMember).mockResolvedValue(undefined);
  renderPage();
  const msg = await screen.findByTestId("msg-42");
  await userEvent.click(within(msg).getByRole("button", { name: "隐藏" }));
  await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("理由"), "广告信息");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(api.hideMessage).toHaveBeenCalledWith("r1", "m42", "广告信息");
  const member = screen.getByTestId("member-22222222");
  await userEvent.click(within(member).getByRole("button", { name: "移出" }));
  await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("理由"), "刷屏广告");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(api.kickMember).toHaveBeenCalledWith("r1", 22222222, "刷屏广告");
});

it("shows hidden messages with a badge and system messages as text", async () => {
  renderPage();
  const hidden = await screen.findByTestId("msg-43");
  expect(within(hidden).getByText("已隐藏")).toBeInTheDocument();
  expect(within(hidden).queryByRole("button", { name: "隐藏" })).toBeNull();
  expect(screen.getByTestId("msg-1")).toHaveTextContent("bob 加入了房间");
});

it("closes the room and mutes AI with a reason", async () => {
  vi.mocked(api.closeRoom).mockResolvedValue(undefined);
  vi.mocked(api.setRoomAi).mockResolvedValue({ aiMuted: true });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "禁用本房 AI" }));
  await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("理由"), "AI 被滥用");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
  expect(api.setRoomAi).toHaveBeenCalledWith("r1", true, "AI 被滥用");
  await userEvent.click(screen.getByRole("button", { name: "关闭房间" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "确认" })).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "违规内容");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.closeRoom).toHaveBeenCalledWith("r1", "违规内容");
});

it("gives viewers a read-only view", async () => {
  asRole("viewer");
  renderPage();
  const msg = await screen.findByTestId("msg-42");
  expect(within(msg).queryByRole("button", { name: "隐藏" })).toBeNull();
  expect(screen.queryByRole("button", { name: "关闭房间" })).toBeNull();
  expect(within(screen.getByTestId("member-22222222")).queryByRole("button", { name: "移出" })).toBeNull();
  const card = screen.getByRole("region", { name: "房间设置" });
  expect(within(card).queryByRole("button", { name: "修改" })).toBeNull();
  expect(within(screen.getByTestId("msg-44")).queryByRole("button", { name: "播放" })).toBeNull();
});

it("shows the room settings and edits them with a reason", async () => {
  vi.mocked(api.patchRoomSettings).mockResolvedValue({ settings: settingsFixture({ allowVoice: false }), changes: [] });
  renderPage();
  const card = await screen.findByRole("region", { name: "房间设置" });
  expect(within(card).getByTestId("setting-scenario")).toHaveTextContent(/场景\s*咖啡店点单/);
  expect(within(card).getByTestId("setting-joinMode")).toHaveTextContent("凭房间号");
  expect(within(card).getByTestId("setting-invite")).toHaveTextContent("未生成");
  await userEvent.click(within(card).getByRole("button", { name: "修改" }));
  const dialog = screen.getByRole("dialog");
  const save = within(dialog).getByRole("button", { name: "保存" });
  expect(save).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "允许语音" }));
  expect(save).toBeDisabled(); // a reason is still missing
  await userEvent.type(within(dialog).getByLabelText("理由"), "语音被滥用");
  await userEvent.click(save);
  expect(api.patchRoomSettings).toHaveBeenCalledWith("r1", { allowVoice: false }, "语音被滥用");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(api.getRoom).toHaveBeenCalledTimes(2);
});

it("rejects a size below the current members before saving", async () => {
  renderPage();
  const card = await screen.findByRole("region", { name: "房间设置" });
  await userEvent.click(within(card).getByRole("button", { name: "修改" }));
  const dialog = screen.getByRole("dialog");
  const size = within(dialog).getByLabelText("人数上限");
  await userEvent.clear(size);
  await userEvent.type(size, "1");
  await userEvent.type(within(dialog).getByLabelText("理由"), "缩小房间");
  expect(within(dialog).getByText("2–8 人,且不少于当前 2 名成员")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
});

it("shows voice messages with duration, transcript, translation and audited playback", async () => {
  vi.mocked(api.fetchRoomAudio).mockResolvedValue(new Blob(["ID3"], { type: "audio/mpeg" }));
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  const urls = { create: vi.fn(() => "blob:audio"), revoke: vi.fn() };
  Object.assign(URL, { createObjectURL: urls.create, revokeObjectURL: urls.revoke });
  renderPage();
  const voice = await screen.findByTestId("msg-44");
  expect(within(voice).getByText("0:06")).toBeInTheDocument();
  expect(within(voice).getByText("已转写")).toBeInTheDocument();
  expect(within(voice).getByText("Could I get a flat white, please?")).toBeInTheDocument();
  expect(within(voice).getByText("可以给我一杯馥芮白吗?")).toBeInTheDocument();
  await userEvent.click(within(voice).getByRole("button", { name: "播放" }));
  expect(api.fetchRoomAudio).toHaveBeenCalledWith("r1", "m44");
  await waitFor(() => expect(play).toHaveBeenCalled());
  expect(urls.create).toHaveBeenCalled();
  const purged = screen.getByTestId("msg-45");
  expect(within(purged).getByText("音频已清理")).toBeInTheDocument();
  expect(within(purged).queryByRole("button", { name: "播放" })).toBeNull();
});

it("shows a deleted owner's kept room as read-only with 已删除用户", async () => {
  vi.mocked(api.getRoom).mockResolvedValue(
    roomFixture({ status: "closed", code: null, closeReason: "admin", owner: { id: null, name: null }, members: [] }),
  );
  renderPage();
  expect(await screen.findByText(/已删除用户/)).toBeInTheDocument();
});

it("titles a v2 room by its name", async () => {
  vi.mocked(api.getRoom).mockResolvedValue(roomFixture({ name: "咖啡角", topic: "" }));
  renderPage();
  expect(await screen.findByRole("heading", { name: "咖啡角" })).toBeInTheDocument();
});
