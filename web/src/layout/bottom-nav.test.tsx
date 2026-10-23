import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { BottomNav } from "./bottom-nav";

// 联机的开关不再影响导航(计划 L6 R8/R9):配置仍注册,用来证明「开了也不出现、也不请求」。
const rooms = (enabled: boolean) => ({ "GET /api/rooms/config": () => json({ enabled, ai_available: enabled, max_members: 8, max_text: 500 }) });
const library = (enabled: boolean) => ({ "GET /api/library/config": () => json({ enabled, link_import: false, asr: false, ai: false, limits: null }) });
const callsTo = (mock: ReturnType<typeof createFetchMock>, path: string) => mock.calls.filter((c) => c.url.pathname === path);
const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

async function mount(libraryOn: boolean, route = "/practice") {
  const mock = createFetchMock({ ...rooms(true), ...library(libraryOn) });
  const view = renderWithProviders(<BottomNav />, { route, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(callsTo(mock, "/api/library/config")).toHaveLength(1));
  await settle();
  return { mock, ...view };
}

describe("BottomNav", () => {
  it("shows three tabs when the library is off (对话 is the only chat entry)", async () => {
    await mount(false);
    expect(hrefs()).toEqual(["/chat", "/practice", "/me"]);
  });

  it("adds the library tab between 练习 and 我的 when it is on (spec E9)", async () => {
    await mount(true);
    expect(hrefs()).toEqual(["/chat", "/practice", "/library", "/me"]);
    expect(screen.getByTestId("nav-library")).toHaveTextContent("Library");
    expect(screen.getByTestId("nav-library").className).toMatch(/\bmin-h-14\b/);
  });

  it("never shows a rooms tab and never asks for the rooms config (plan L6 R8/R9)", async () => {
    const { mock } = await mount(true);
    expect(screen.queryByTestId("nav-rooms")).toBeNull();
    expect(hrefs()).not.toContain("/rooms");
    expect(callsTo(mock, "/api/rooms/config")).toHaveLength(0);
  });

  it("removes the web.nav.rooms label", () => {
    expect(i18n.exists("web.nav.rooms")).toBe(false);
  });

  it("sizes the columns for the glass bar: at most four tabs (plan L6 R8)", async () => {
    await mount(true);
    expect(screen.getByRole("list").style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("sizes three columns when the library is off", async () => {
    await mount(false);
    expect(screen.getByRole("list").style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  // 4 列 ≈ 360 px 下每格约 82 px(按类名算,未在真机量过):仍按 ≤ 8 个英文字符 / ≤ 4 个汉字(计划 L6 R11)
  it("keeps every label short enough for a 360 px phone (E9, R11)", () => {
    for (const key of ["practice", "chat", "library", "me"]) {
      expect([...i18n.getFixedT("en")(`web.nav.${key}`)].length, `en ${key}`).toBeLessThanOrEqual(8);
      expect([...i18n.getFixedT("zh-CN")(`web.nav.${key}`)].length, `zh-CN ${key}`).toBeLessThanOrEqual(4);
    }
  });

  it("highlights the library tab on /library and below, and only there", async () => {
    for (const route of ["/library", "/library/i1"]) {
      const { unmount } = await mount(true, route);
      expect(screen.getByTestId("nav-library")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
      unmount();
    }
    await mount(true, "/libraryx");
    expect(screen.getByTestId("nav-library")).not.toHaveAttribute("aria-current");
  });

  it.each([
    "/chat", "/chat/c1", "/rooms", "/rooms/ended", "/rooms/r/r1", "/rooms/r/r1/summary", "/rooms/invite/t",
  ])("highlights 对话 on %s, the whole chat area including the rooms section (plan L6 R8)", async (route) => {
    const { unmount } = await mount(true, route);
    expect(screen.getByTestId("nav-chat")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
    unmount();
  });

  it("does not highlight 对话 for a look-alike path", async () => {
    await mount(false, "/roomsx");
    expect(screen.getByTestId("nav-chat")).not.toHaveAttribute("aria-current");
  });

  it("highlights 练习 on wordbook pages (they are entered from the practice tab)", async () => {
    for (const route of ["/wordbook", "/wordbook/learn", "/wordbook/spell"]) {
      const { unmount } = await mount(false, route);
      expect(screen.getByTestId("nav-practice")).toHaveAttribute("aria-current", "page");
      expect(screen.getByTestId("nav-me")).not.toHaveAttribute("aria-current");
      unmount();
    }
  });

  it("does not highlight 练习 for look-alike paths", async () => {
    await mount(false, "/wordbooks");
    expect(screen.getByTestId("nav-practice")).not.toHaveAttribute("aria-current");
  });
});
