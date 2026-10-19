import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { UserEmailCard } from "./user-email-card";

vi.mock("./api");

const asRole = (role: Role) =>
  vi.spyOn(session, "useAdminSession").mockReturnValue({
    username: "ops", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: true, safeMode: false, maintenanceMode: "off",
  });

beforeEach(() => {
  vi.clearAllMocks();
  asRole("operator");
});
afterEach(() => vi.restoreAllMocks());

it("shows the masked address and verified state to viewers, without a clear action", () => {
  asRole("viewer");
  render(<UserEmailCard userId={11111111} emailMasked="a***@qq.com" emailVerified onChanged={() => {}} />);
  expect(screen.getByText("a***@qq.com")).toBeInTheDocument();
  expect(screen.getByText("已验证")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清除邮箱" })).toBeNull();
});

it("says the account has no email, and offers no clear action", () => {
  render(<UserEmailCard userId={11111111} emailMasked={null} emailVerified={false} onChanged={() => {}} />);
  expect(screen.getByText("未绑定")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清除邮箱" })).toBeNull();
});

it("clears the email only after a reason, explains the effect, and refreshes the row", async () => {
  vi.mocked(api.clearUserEmail).mockResolvedValue({ userId: 11111111, emailMasked: null, emailVerified: false });
  const onChanged = vi.fn();
  render(<UserEmailCard userId={11111111} emailMasked="a***@qq.com" emailVerified onChanged={onChanged} />);
  await userEvent.click(screen.getByRole("button", { name: "清除邮箱" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/需要重新绑定邮箱/)).toBeInTheDocument();
  expect(within(dialog).getByText(/登录令牌不会被撤销/)).toBeInTheDocument();
  const confirm = within(dialog).getByRole("button", { name: "清除邮箱" });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText("理由"), "用户申请换绑");
  await userEvent.click(confirm);
  expect(api.clearUserEmail).toHaveBeenCalledWith(11111111, "用户申请换绑");
  expect(await screen.findByText("已清除邮箱")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});
