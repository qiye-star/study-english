import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { UserInviteCard } from "./user-invite-card";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });

const status = (over: Partial<api.UserInviteStatus> = {}): api.UserInviteStatus => ({
  current: { uses: 3, cap: 10, createdAt: "2026-10-01T00:00:00Z", revokedAt: null, state: "active" },
  historyCodes: 2, redemptions: 5, disabledInvitees: 1,
  invitees: [{ displayName: "bob", redeemedAt: "2026-10-02T00:00:00Z", disabled: false }],
  ...over,
});

const renderCard = () => render(<MemoryRouter><UserInviteCard userId={7} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  asRole("operator");
  vi.mocked(api.getUserInvite).mockResolvedValue(status());
});

it("shows usage against the cap and the history summary, never a code", async () => {
  const { container } = renderCard();
  expect(await screen.findByText("已用 3 / 上限 10")).toBeInTheDocument();
  expect(screen.getByText("历史码 2 个 · 累计兑换 5 · 其中已停用 1")).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}/);
});

it("with no current code it says so and disables revoke and replace", async () => {
  vi.mocked(api.getUserInvite).mockResolvedValue(status({ current: null }));
  renderCard();
  expect(await screen.findByText("当前没有有效的邀请码")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "更换" })).toBeDisabled();
});

it("links the cap to the quota row of the same key on the admin tab", async () => {
  renderCard();
  const link = await screen.findByRole("link", { name: "调整上限" });
  expect(link.getAttribute("href")).toMatch(/\?tab=admin#quota-invites_user_code_max_uses$/);
});

it("is not shown to a viewer, who cannot read the invite status", () => {
  asRole("viewer");
  const { container } = renderCard();
  expect(container).toBeEmptyDOMElement();
  expect(api.getUserInvite).not.toHaveBeenCalled();
});

it("revoke needs a reason of at least four characters before it can be confirmed", async () => {
  vi.mocked(api.revokeUserInvite).mockResolvedValue(undefined);
  renderCard();
  await userEvent.click(await screen.findByRole("button", { name: "撤销" }));
  const dialog = await screen.findByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "撤销" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByRole("textbox"), "违规");
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByRole("textbox"), "转发");
  await userEvent.click(confirm);
  expect(api.revokeUserInvite).toHaveBeenCalledWith(7, "违规转发");
  expect(await screen.findByText("已撤销该用户的邀请码")).toBeInTheDocument();
});

it("replace states that the new code inherits the used count and is shown only to the owner", async () => {
  vi.mocked(api.rotateUserInvite).mockResolvedValue(undefined);
  renderCard();
  await userEvent.click(await screen.findByRole("button", { name: "更换" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("新码沿用旧码已用的次数,不会增加名额;新码只显示给用户本人,管理员看不到。");
  await userEvent.type(within(dialog).getByRole("textbox"), "用户丢失旧码");
  await userEvent.click(within(dialog).getByRole("button", { name: "更换" }));
  expect(api.rotateUserInvite).toHaveBeenCalledWith(7, "用户丢失旧码");
  expect(await screen.findByText("已更换;新码只显示给用户本人")).toBeInTheDocument();
});
