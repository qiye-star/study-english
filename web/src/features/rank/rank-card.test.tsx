import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { setLiquid } from "~/test/glass";
import { renderWithProviders } from "~/test/render";
import { RankCard } from "./rank-card";
import { CONTRACT, inChinese } from "./test-contract";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

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
  beforeEach(() => vi.mocked(toast.success).mockClear());

  it("renders nothing when rank is disabled", async () => {
    const mock = setup(false);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await flush();
    expect(mock.calls).toHaveLength(1); // never asks for /me
    expect(screen.queryByTestId("rank-card")).toBeNull();
  });

  it("announces achievements unlocked by this fetch (the server returns them only once)", async () => {
    setup(true);
    await screen.findByTestId("rank-card");
    expect(toast.success).toHaveBeenCalledWith("解锁了 1 个新成就");
  });

  it("renders nothing when the request fails", async () => {
    const mock = createFetchMock({});
    renderWithProviders(<RankCard />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await flush();
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

  it("liquid: E1 panel with the accent progress bar on a wash track (plan 2026-10-15-liquid-glass L8)", async () => {
    setLiquid(true);
    try {
      setup(true);
      const bar = await screen.findByRole("progressbar");
      expect(bar.className).toContain("liquid:bg-wash-2");
      expect(bar.closest("a")!.className).toContain("mat-surface");
    } finally {
      setLiquid(false);
    }
  });
});
