import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import type { Role } from "../../api/session";
import * as api from "./api";
import { UserAvatarCard } from "./user-avatar-card";

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

it("renders nothing when the user has no avatar", () => {
  const { container } = render(<UserAvatarCard userId="11" username="alice" avatarUrl={null} onChanged={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows the thumbnail and removes it with a reason, then tells the page to refresh", async () => {
  vi.mocked(api.removeUserAvatar).mockResolvedValue({ userId: "11", reportsResolved: 0 });
  const onChanged = vi.fn();
  const { container } = render(<UserAvatarCard userId="11" username="alice" avatarUrl="/api/avatars/abc123" onChanged={onChanged} />);
  const img = container.querySelector("img");
  expect(img).toHaveAttribute("src", "/api/avatars/abc123");
  expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  await userEvent.click(screen.getByRole("button", { name: "移除头像" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("理由"), "违规头像");
  await userEvent.click(within(dialog).getByRole("button", { name: "移除头像" }));
  expect(api.removeUserAvatar).toHaveBeenCalledWith("11", "违规头像");
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});

it("hides the remove action from viewers", () => {
  asRole("viewer");
  render(<UserAvatarCard userId="11" username="alice" avatarUrl="/api/avatars/abc123" onChanged={() => {}} />);
  expect(screen.queryByRole("button", { name: "移除头像" })).toBeNull();
});
