import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { MatchPage } from "./match-page";
import { matchFixture } from "./test-fixtures";

vi.mock("./api");

const asRole = (role: session.Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null, totpEnabled: true,
    safeMode: false, maintenanceMode: "off",
  });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/rank/matches/m-failed"]}>
      <Routes>
        <Route path="/rank/matches/:id" element={<MatchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getMatch).mockResolvedValue(matchFixture());
});

it("shows the transcript turn by turn with markers, the judge result and the gate reason", async () => {
  asRole("viewer");
  renderPage();
  expect(await screen.findByText("I want to return this jacket")).toBeInTheDocument();
  expect(screen.getByText("Hello, how can I help you today?")).toBeInTheDocument();
  const turns = screen.getByRole("list", { name: "逐轮转写" });
  const echoTurn = within(turns).getByText("do you have the receipt").closest("li")!;
  expect(within(echoTurn).getByText("复读")).toBeInTheDocument();
  expect(within(turns).getAllByText("复读")).toHaveLength(1);
  expect(screen.getByText("任务完成不足")).toBeInTheDocument();
  expect(screen.getByText("Could I get a refund, please?")).toBeInTheDocument();
  expect(screen.getByText(/仅用于审核,勿外传/)).toBeInTheDocument();
  expect(screen.getByText("规则 v3")).toBeInTheDocument();
  expect(api.getMatch).toHaveBeenCalledWith("m-failed");
  expect(screen.queryByRole("button", { name: "作废" })).toBeNull();
});

it("voids a failed match with a reason", async () => {
  asRole("operator");
  vi.mocked(api.voidMatch).mockResolvedValue({ ...matchFixture().match, status: "voided", restored: true });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "作废" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "评委上游故障");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认" }));
  expect(api.voidMatch).toHaveBeenCalledWith("m-failed", "评委上游故障");
  expect(screen.queryByRole("button", { name: "重评" })).toBeNull();
});
