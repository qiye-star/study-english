import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAuth, loadAuth, saveAuth } from "~/api/auth-storage";
import { AuthProvider } from "~/auth/auth-context";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AccountSection } from "./account-section";

const ME = { id: "12345678", name: "alice", created_at: "t", nickname: "小明", display_name: "小明" };

function renderSection(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock({ "GET /api/me": () => json(ME), ...routes });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider fetchImpl={mock.fetch}>{children}</AuthProvider>
    </MemoryRouter>
  );
  render(<AccountSection />, { wrapper });
  return mock;
}

describe("AccountSection", () => {
  beforeEach(() => {
    clearAuth();
    saveAuth({ token: "tok", user: { id: "12345678", name: "alice" } });
  });

  it("shows the current nickname and saves a new one with PATCH /api/me", async () => {
    const mock = renderSection({
      "PATCH /api/me": (call) => {
        const nickname = JSON.parse(call.body as string).nickname as string;
        return json({ nickname, display_name: nickname });
      },
    });
    const input = await screen.findByLabelText("Nickname");
    await waitFor(() => expect(input).toHaveValue("小明"));
    await userEvent.clear(input);
    await userEvent.type(input, "Emma Lee");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("account-nickname-status")).toHaveTextContent("Nickname saved"));
    const patch = mock.calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch?.body as string)).toEqual({ nickname: "Emma Lee" });
    expect(patch?.headers.get("Authorization")).toBe("Bearer tok");
    expect(loadAuth()?.user.displayName).toBe("Emma Lee");
  });

  it("shows a localized message when the server rejects the nickname (422), without echoing the input", async () => {
    renderSection({ "PATCH /api/me": () => json({ error: "invalid nickname" }, 422) });
    const input = await screen.findByLabelText("Nickname");
    await waitFor(() => expect(input).toHaveValue("小明"));
    await userEvent.clear(input);
    await userEvent.type(input, "AI");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("account-nickname-status")).toHaveTextContent("This nickname can't be used");
    expect(screen.getByTestId("account-nickname-status").textContent).not.toContain("AI");
  });

  it("validates the new password locally (8 characters) and changes it through the auth context", async () => {
    const mock = renderSection({
      "POST /api/me/password": () => json({ access_token: "rotated" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "old-password");
    await userEvent.type(within(dialog).getByLabelText("New password"), "short");
    await userEvent.click(within(dialog).getByRole("button", { name: "Update password" }));
    expect(within(dialog).getByTestId("account-password-error")).toHaveTextContent("Use at least 8 characters.");
    expect(mock.calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.clear(within(dialog).getByLabelText("New password"));
    await userEvent.type(within(dialog).getByLabelText("New password"), "new-password1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(screen.getByTestId("account-password-status")).toHaveTextContent("Password changed"));
    expect(JSON.parse(mock.calls.find((c) => c.method === "POST")?.body as string)).toEqual({
      current_password: "old-password",
      new_password: "new-password1",
    });
  });

  it("shows the wrong-password message from a 403 and keeps the sheet open", async () => {
    renderSection({ "POST /api/me/password": () => json({ error: "Wrong password" }, 403) });
    await userEvent.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Current password"), "nope");
    await userEvent.type(within(dialog).getByLabelText("New password"), "new-password1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Update password" }));
    expect(await within(dialog).findByTestId("account-password-error")).toHaveTextContent("Current password is incorrect");
  });

  it("keeps the primary button label on one line", async () => {
    renderSection({});
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save.className).toContain("whitespace-nowrap");
  });

  it("shows the masked email and its verified state, and links to the bind page to change it", async () => {
    renderSection({
      "GET /api/me": () => json({ ...ME, email_masked: "a***@example.com", email_verified: true, email_binding: { state: "none", deadline: null } }),
    });
    const row = await screen.findByTestId("account-email-open");
    expect(row).toHaveTextContent("a***@example.com");
    expect(row).toHaveTextContent("Verified");
    expect(row).toHaveTextContent("Change email");
    expect(row).toHaveAttribute("href", "/account/email");
  });

  it("offers to bind an email when none is bound, without showing any address", async () => {
    renderSection({
      "GET /api/me": () => json({ ...ME, email_verified: false, email_binding: { state: "none", deadline: null } }),
    });
    const row = await screen.findByTestId("account-email-open");
    expect(row).toHaveTextContent("Not bound");
    expect(row).toHaveTextContent("Bind email");
    expect(row).toHaveAttribute("href", "/account/email");
    expect(row.textContent).not.toMatch(/@/);
  });
});
