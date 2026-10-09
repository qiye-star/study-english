import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { PracticePage } from "~/features/practice";
import { CONTRACT } from "~/features/rank/test-contract";
import { MePage } from "~/pages/me-page";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { BottomNav } from "./bottom-nav";

/** RANK_ENABLED / ROOMS_ENABLED(spec §13):关闭时 = 原样的 3 个标签、没有任何入口;开启时 4 个标签 + 段位卡。 */
function setup(enabled: boolean, page: "practice" | "me") {
  const mock = createFetchMock({
    // 关闭时的服务端原样回包(server/app/routers/rank.py、rooms.py 的 /config)
    "GET /api/rank/config": () => json(enabled ? CONTRACT.config : { enabled: false, match_available: false, tiers: [], season: null }),
    "GET /api/rank/me": () => (enabled ? json(CONTRACT.me) : json({ error: "Rank is disabled" }, 404)),
    "GET /api/rooms/config": () => json({ enabled, ai_available: enabled, max_members: 8, max_text: 500 }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  renderWithProviders(<><BottomNav />{page === "practice" ? <PracticePage /> : <MePage />}</>, { api, route: `/${page}` });
  return mock;
}

const called = (mock: ReturnType<typeof setup>, path: string) => mock.calls.some((c) => c.url.pathname === path);
const linksTo = (prefix: string) => [...document.querySelectorAll("a[href]")].filter((a) => a.getAttribute("href")!.startsWith(prefix));

describe("feature flags", () => {
  it.each(["practice", "me"] as const)("off: 3 tabs and no rank or rooms entry on %s", async (page) => {
    const mock = setup(false, page);
    await waitFor(() => expect(called(mock, "/api/rank/config") && called(mock, "/api/rooms/config")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("[data-testid^='nav-']"))).toHaveLength(3);
    expect(screen.queryByTestId("nav-rooms")).toBeNull();
    expect(screen.queryByTestId("rank-card")).toBeNull();
    expect(linksTo("/rank")).toEqual([]);
    expect(linksTo("/rooms")).toEqual([]);
    expect(called(mock, "/api/rank/me")).toBe(false); // nothing beyond /config is touched when off
  });

  it.each(["practice", "me"] as const)("on: 4 tabs and the rank card on %s", async (page) => {
    setup(true, page);
    expect(await screen.findByTestId("nav-rooms")).toBeTruthy();
    for (const id of ["nav-practice", "nav-chat", "nav-rooms", "nav-me"]) expect(screen.getByTestId(id)).toBeTruthy();
    expect(await screen.findByTestId("rank-card")).toBeTruthy();
    expect(linksTo("/rank").length).toBeGreaterThan(0);
  });
});
