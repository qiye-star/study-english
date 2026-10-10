import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { BottomNav } from "./bottom-nav";

const config = (enabled: boolean) => ({ "GET /api/rooms/config": () => json({ enabled, ai_available: enabled, max_members: 8, max_text: 500 }) });

describe("BottomNav", () => {
  it("shows four tabs when rooms are enabled", async () => {
    const mock = createFetchMock(config(true));
    renderWithProviders(<BottomNav />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(screen.getByTestId("nav-rooms")).toBeTruthy());
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/practice", "/chat", "/rooms", "/me"]);
  });

  it("keeps three tabs when rooms are disabled", async () => {
    const mock = createFetchMock(config(false));
    renderWithProviders(<BottomNav />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("nav-rooms")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("highlights 练习 on wordbook pages (they are entered from the practice tab)", async () => {
    for (const route of ["/wordbook", "/wordbook/learn", "/wordbook/spell"]) {
      const mock = createFetchMock(config(false));
      const { unmount } = renderWithProviders(<BottomNav />, { route, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
      await waitFor(() => expect(mock.calls).toHaveLength(1));
      expect(screen.getByTestId("nav-practice")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-me")).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("does not highlight 练习 for look-alike paths", async () => {
    const mock = createFetchMock(config(false));
    renderWithProviders(<BottomNav />, { route: "/wordbooks", api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
  });
});
