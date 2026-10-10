import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AchievementsPage } from "./achievements-page";
import { CONTRACT, inChinese } from "./test-contract";

function setup(achievements: unknown[], enabled = true) {
  const mock = createFetchMock({
    "GET /api/rank/config": () => json({ ...CONTRACT.config, enabled }),
    "GET /api/rank/achievements": () => json({ achievements }),
  });
  renderWithProviders(<AchievementsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}

describe("AchievementsPage", () => {
  inChinese();

  it("groups achievements, marks locked ones and names season badges", async () => {
    setup([
      { key: "streak_3", group: "streak", icon: "flame", unlocked_at: "2026-11-05T08:00:00+00:00" },
      { key: "streak_7", group: "streak", icon: "flame", unlocked_at: null },
      { key: "season_1_gold", group: "season", icon: "shield-star", unlocked_at: "2026-12-28T00:00:00+00:00" },
    ]);
    const cells = await screen.findAllByTestId("achievement");
    expect(cells.map((c) => c.dataset.unlocked)).toEqual(["true", "false", "true"]);
    expect(screen.getByText("三日不辍")).toBeTruthy();
    expect(screen.getByText("连续活跃 7 天")).toBeTruthy();
    expect(screen.getByText("S1 黄金")).toBeTruthy();
    expect(screen.getByText("坚持")).toBeTruthy();
    expect(screen.getByTestId("achievements-count").textContent).toBe("2/3");
  });

  it("colours unlocked badges by meaning and greys out locked ones", async () => {
    setup([
      { key: "streak_3", group: "streak", icon: "flame", unlocked_at: "2026-11-05T08:00:00+00:00" },
      { key: "tier_gold", group: "rank", icon: "shield-star", unlocked_at: "2026-11-05T08:00:00+00:00" },
      { key: "vocab_100", group: "vocab", icon: "cards", unlocked_at: null },
    ]);
    const cells = await screen.findAllByTestId("achievement");
    const disc = (i: number) => cells[i].querySelector("[data-testid=achievement-icon]")!.className;
    expect(disc(0)).toContain("text-amber");
    expect(disc(1)).toContain("text-ink");
    expect(disc(2)).toContain("text-ink-3");
    expect(cells[0].innerHTML).not.toMatch(/text-red|bg-red/);
  });

  it("names the wordbook achievements and colours them teal with a book icon", async () => {
    setup([
      { key: "words_mastered_100", group: "vocab", icon: "book", unlocked_at: "2026-11-05T08:00:00+00:00" },
      { key: "words_mastered_500", group: "vocab", icon: "book", unlocked_at: null },
    ]);
    const cells = await screen.findAllByTestId("achievement");
    expect(screen.getByText("小有积累")).toBeTruthy();
    expect(screen.getByText("词汇达人")).toBeTruthy();
    expect(screen.getByText("掌握 500 个单词")).toBeTruthy();
    const disc = (i: number) => cells[i].querySelector("[data-testid=achievement-icon]")!;
    expect(disc(0).className).toContain("bg-teal-tint");
    expect(disc(1).className).toContain("text-ink-3");
    expect(disc(0).querySelector("svg")!.getAttribute("class")).toContain("lucide-library-big");
  });

  it("shows the disabled note when rank is off", async () => {
    setup([], false);
    expect(await screen.findByText("段位赛未开启。")).toBeTruthy();
  });
});
