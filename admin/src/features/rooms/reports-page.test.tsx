import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as api from "./api";
import { ReportsPage } from "./reports-page";
import { reportFixture } from "./test-fixtures";

vi.mock("./api");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listReports).mockResolvedValue({ reports: [reportFixture()], page: 1, next: null });
});

const renderPage = () => render(<MemoryRouter><ReportsPage /></MemoryRouter>);

it("shows the reported message, people and reason", async () => {
  renderPage();
  expect(await screen.findByText("buy cheap followers")).toBeInTheDocument();
  expect(screen.getByText("bob")).toBeInTheDocument();
  expect(screen.getByText("alice")).toBeInTheDocument();
  expect(screen.getByText("垃圾信息")).toBeInTheDocument();
  expect(api.listReports).toHaveBeenLastCalledWith("open", 1);
});

it("resolves by kicking the sender with a reason", async () => {
  vi.mocked(api.resolveReport).mockResolvedValue(undefined);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "处理" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("radio", { name: /移出发送者/ }));
  const confirm = within(dialog).getByRole("button", { name: "确认" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "反复发广告");
  await userEvent.click(confirm);
  expect(api.resolveReport).toHaveBeenCalledWith(7, "kicked", "反复发广告");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("switches to resolved reports and shows the empty state", async () => {
  renderPage();
  await screen.findByText("buy cheap followers");
  vi.mocked(api.listReports).mockResolvedValue({ reports: [], page: 1, next: null });
  await userEvent.click(screen.getByRole("tab", { name: "已处理" }));
  await waitFor(() => expect(api.listReports).toHaveBeenLastCalledWith("resolved", 1));
  expect(await screen.findByText("还没有处理过的举报")).toBeInTheDocument();
});

it("links the report to the room by its name", async () => {
  vi.mocked(api.listReports).mockResolvedValue({ reports: [reportFixture({ room: { id: "r1", name: "咖啡角", topic: "", code: "482913" } })], page: 1, next: null });
  renderPage();
  expect(await screen.findByRole("link", { name: "咖啡角" })).toHaveAttribute("href", "/rooms/r1");
});
