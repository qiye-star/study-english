import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { RoomDetailPage } from "./room-detail-page";
import { roomFixture, timelineFixture } from "./test-fixtures";

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
});

it("shows a deleted owner's kept room as read-only with 已删除用户", async () => {
  vi.mocked(api.getRoom).mockResolvedValue(
    roomFixture({ status: "closed", code: null, closeReason: "admin", owner: { id: null, name: null }, members: [] }),
  );
  renderPage();
  expect(await screen.findByText(/已删除用户/)).toBeInTheDocument();
});
