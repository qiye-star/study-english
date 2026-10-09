import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { JoinRequestBanner } from "./join-requests";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const REQ = { id: "q1", roomId: "r1", roomName: "美食", userId: 3, name: "lily", status: "pending" as const, createdAt: "" };
const WIRE = { id: "q1", room_id: "r1", room_name: "美食", user_id: 3, name: "lily", status: "pending", created_at: "" };

describe("JoinRequestBanner", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("approves a pending request", async () => {
    const mock = createFetchMock({ "POST /api/rooms/r1/requests/q1/approve": () => json({ request: { ...WIRE, status: "approved" } }) });
    const onDecided = vi.fn();
    renderWithProviders(<JoinRequestBanner roomId="r1" requests={[REQ]} onDecided={onDecided} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(screen.getByText("lily 想加入")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "同意" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith("q1"));
  });

  it("renders nothing without requests", () => {
    renderWithProviders(<JoinRequestBanner roomId="r1" requests={[]} onDecided={vi.fn()} />);
    expect(screen.queryByTestId("room-join-banner")).toBeNull();
  });

  it("summarises several requests and expands to decide each", async () => {
    const mock = createFetchMock({ "POST /api/rooms/r1/requests/q2/deny": () => json({ request: { ...WIRE, id: "q2", status: "denied" } }) });
    const onDecided = vi.fn();
    const reqs = [REQ, { ...REQ, id: "q2", name: "tom" }, { ...REQ, id: "q3", name: "ann" }];
    renderWithProviders(<JoinRequestBanner roomId="r1" requests={reqs} onDecided={onDecided} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(screen.getByText("lily 等 3 人想加入")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "同意" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(screen.getAllByTestId("room-join-request")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "拒绝 tom 加入" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith("q2"));
  });

  it("keeps the request when the room is full and drops it when it is gone", async () => {
    const mock = createFetchMock({
      "POST /api/rooms/r1/requests/q1/approve": () => json({ error: "Room is full" }, 409),
      "POST /api/rooms/r1/requests/q1/deny": () => json({ error: "Request not found" }, 404),
    });
    const onDecided = vi.fn();
    renderWithProviders(<JoinRequestBanner roomId="r1" requests={[REQ]} onDecided={onDecided} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.click(screen.getByRole("button", { name: "同意" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("房间已满"));
    expect(onDecided).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("申请不存在或已失效"));
    expect(onDecided).toHaveBeenCalledWith("q1");
  });
});
