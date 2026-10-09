import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RankCard } from "./rank-card";
import { CONTRACT, inChinese } from "./test-contract";

function setup(enabled: boolean, me = CONTRACT.me) {
  const mock = createFetchMock({
    "GET /api/rank/config": () => json({ ...CONTRACT.config, enabled }),
    "GET /api/rank/me": () => json(me),
  });
  renderWithProviders(<RankCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice", path: "/practice" });
  return mock;
}

describe("RankCard", () => {
  inChinese();

  it("renders nothing when rank is disabled", async () => {
    const mock = setup(false);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("rank-card")).toBeNull();
  });

  it("renders nothing when the request fails", async () => {
    const mock = createFetchMock({});
    renderWithProviders(<RankCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("rank-card")).toBeNull();
  });

  it("shows tier, division, progress and the eligible hint, and opens /rank", async () => {
    setup(true);
    const card = await screen.findByTestId("rank-card");
    expect(card.textContent).toContain("黄金 I");
    expect(card.textContent).toContain("可以打晋级赛了");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    fireEvent.click(card);
    expect(screen.getByTestId("location").textContent).toBe("/rank");
  });

  it("shows the points still needed when locked", async () => {
    setup(true, { ...CONTRACT.me, division: 2, rp: 30, promotion: { ...CONTRACT.me.promotion, state: "locked", reason: "rp" } });
    expect((await screen.findByTestId("rank-card")).textContent).toContain("再练 210 点到晋级门");
  });
});
