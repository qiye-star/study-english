import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AccountSettingsPage } from "./account-settings-page";

const ME = { id: "12345678", name: "alice", created_at: "t", nickname: "小明" };

describe("AccountSettingsPage (/me/account)", () => {
  it("shows the account rows and logs out from the button at the bottom", async () => {
    const mock = createFetchMock({ "GET /api/me": () => json(ME) });
    const logout = vi.fn();
    renderWithProviders(<AccountSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), logout });
    expect(screen.getByText("Account settings")).toBeInTheDocument();
    // AccountSection 与邀请码面板都是懒加载块,首次导入较慢,等待时间放宽
    expect(await screen.findByTestId("account-password-open", undefined, { timeout: 10000 })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("account-logout"));
    expect(logout).toHaveBeenCalledWith(true);
  });

  it("labels the logout button with the shared logout copy", () => {
    const mock = createFetchMock({ "GET /api/me": () => json(ME) });
    renderWithProviders(<AccountSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(screen.getByTestId("account-logout")).toHaveTextContent("Log out");
  });
});
