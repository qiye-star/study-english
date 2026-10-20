import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RankMiniCard } from "./rank-mini-card";
import { CONTRACT, inChinese } from "./test-contract";

function setup(enabled: boolean, meStatus = 200) {
  const mock = createFetchMock({
    "GET /api/rank/config": () => json({ ...CONTRACT.config, enabled }),
    "GET /api/rank/me": () => (meStatus === 200 ? json(CONTRACT.me) : json({ error: "x" }, meStatus)),
  });
  renderWithProviders(<RankMiniCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice", path: "/practice" });
  return mock;
}

describe("RankMiniCard", () => {
  inChinese();

  it("renders nothing when rank is disabled", async () => {
    const mock = setup(false);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("rank-mini-card")).toBeNull();
  });

  it("shows the tier and one line of guidance, and links to /rank", async () => {
    setup(true);
    const card = await screen.findByTestId("rank-mini-card");
    expect(card.textContent).toContain("黄金 I");
    expect(card.textContent).toContain("可以打晋级赛了");
    expect(card).toHaveAttribute("href", "/rank");
  });

  it("shows a dash and a hint when there is no rank data yet", async () => {
    setup(true, 500);
    const card = await screen.findByTestId("rank-mini-card");
    expect(card.textContent).toContain("—");
    expect(card.textContent).toContain("完成一次跟读就会上榜");
  });
});
