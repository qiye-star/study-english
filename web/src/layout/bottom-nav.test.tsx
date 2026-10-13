import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { BottomNav } from "./bottom-nav";

const rooms = (enabled: boolean) => ({ "GET /api/rooms/config": () => json({ enabled, ai_available: enabled, max_members: 8, max_text: 500 }) });
const library = (enabled: boolean) => ({ "GET /api/library/config": () => json({ enabled, link_import: false, asr: false, ai: false, limits: null }) });
const callsTo = (mock: ReturnType<typeof createFetchMock>, path: string) => mock.calls.filter((c) => c.url.pathname === path);
const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(roomsOn: boolean, libraryOn: boolean, route = "/practice") {
  const mock = createFetchMock({ ...rooms(roomsOn), ...library(libraryOn) });
  const view = renderWithProviders(<BottomNav />, { route, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(callsTo(mock, "/api/rooms/config")).toHaveLength(1));
  await waitFor(() => expect(callsTo(mock, "/api/library/config")).toHaveLength(1));
  await settle();
  return { mock, ...view };
}

describe("BottomNav", () => {
  it("shows four tabs when only rooms are enabled", async () => {
    await mount(true, false);
    expect(hrefs()).toEqual(["/practice", "/chat", "/rooms", "/me"]);
  });

  it("shows four tabs when only the library is enabled, between 对话 and 我的 (spec E9)", async () => {
    await mount(false, true);
    expect(hrefs()).toEqual(["/practice", "/chat", "/library", "/me"]);
  });

  it("shows five tabs in the order 练习 · 对话 · 联机 · 跟读库 · 我的 when both are enabled", async () => {
    await mount(true, true);
    expect(hrefs()).toEqual(["/practice", "/chat", "/rooms", "/library", "/me"]);
    expect(screen.getByTestId("nav-library")).toHaveTextContent("Library");
    expect(screen.getByTestId("nav-library").className).toMatch(/\bmin-h-14\b/);
  });

  it("keeps three tabs when both are disabled, or the library is missing (old server)", async () => {
    await mount(false, false);
    expect(screen.queryByTestId("nav-rooms")).toBeNull();
    expect(screen.queryByTestId("nav-library")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("sizes five columns for the glass bar and keeps every label short enough for a 360 px phone (E9)", async () => {
    await mount(true, true);
    expect(screen.getByRole("list").style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
    // 360 px / 5 = 72 px per tab:标签 ≤ 8 个英文字符 / ≤ 4 个汉字(spec E9)
    for (const key of ["practice", "chat", "rooms", "library", "me"]) {
      expect([...i18n.getFixedT("en")(`web.nav.${key}`)].length, `en ${key}`).toBeLessThanOrEqual(8);
      expect([...i18n.getFixedT("zh-CN")(`web.nav.${key}`)].length, `zh-CN ${key}`).toBeLessThanOrEqual(4);
    }
  });

  it("highlights the library tab on /library and below, and only there", async () => {
    for (const route of ["/library", "/library/i1"]) {
      const { unmount } = await mount(true, true, route);
      expect(screen.getByTestId("nav-library")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
      unmount();
    }
    await mount(true, true, "/libraryx");
    expect(screen.getByTestId("nav-library")).not.toHaveAttribute("aria-current");
  });

  it("highlights 练习 on wordbook pages (they are entered from the practice tab)", async () => {
    for (const route of ["/wordbook", "/wordbook/learn", "/wordbook/spell"]) {
      const { unmount } = await mount(false, false, route);
      expect(screen.getByTestId("nav-practice")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-me")).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("does not highlight 练习 for look-alike paths", async () => {
    await mount(false, false, "/wordbooks");
    expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
  });
});
