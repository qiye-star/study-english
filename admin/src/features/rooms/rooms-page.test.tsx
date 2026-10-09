import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { RoomsPage } from "./rooms-page";
import { roomRow } from "./test-fixtures";

vi.mock("./api");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listRooms).mockResolvedValue({ rooms: [roomRow({ openReports: 2 })], page: 1, next: null, total: 1 });
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/rooms"]}>
      <Routes>
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:id" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>,
  );

it("lists open rooms first and switches status", async () => {
  renderPage();
  expect(await screen.findByText("美食")).toBeInTheDocument();
  expect(api.listRooms).toHaveBeenLastCalledWith({ status: "open", q: "", page: 1 });
  expect(screen.getByText("2 条待处理举报")).toBeInTheDocument();
  expect(screen.getByText("2 / 1")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("tab", { name: "已结束" }));
  await waitFor(() => expect(api.listRooms).toHaveBeenLastCalledWith({ status: "closed", q: "", page: 1 }));
  await userEvent.click(screen.getByRole("tab", { name: "全部" }));
  await waitFor(() => expect(api.listRooms).toHaveBeenLastCalledWith({ status: "all", q: "", page: 1 }));
});

it("searches and shows the empty state", async () => {
  renderPage();
  await screen.findByText("美食");
  vi.mocked(api.listRooms).mockResolvedValue({ rooms: [], page: 1, next: null, total: 0 });
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索房间号、话题或房主" }), "482913");
  await waitFor(() => expect(api.listRooms).toHaveBeenLastCalledWith({ status: "open", q: "482913", page: 1 }));
  expect(await screen.findByText("没有符合条件的房间")).toBeInTheDocument();
});

it("shows the open-rooms empty state and opens a room", async () => {
  vi.mocked(api.listRooms).mockResolvedValueOnce({ rooms: [], page: 1, next: null, total: 0 });
  renderPage();
  expect(await screen.findByText("现在没有进行中的房间")).toBeInTheDocument();
});

it("navigates to the detail page on row click", async () => {
  renderPage();
  await userEvent.click(await screen.findByText("美食"));
  expect(await screen.findByText("detail page")).toBeInTheDocument();
});
