import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RankHomePage } from "./rank-home-page";
import { CONTRACT, inChinese } from "./test-contract";

function setup(me: Record<string, unknown> = CONTRACT.me, start = () => json({ match: CONTRACT.match }), config: Record<string, unknown> = CONTRACT.config) {
  const mock = createFetchMock({
    "GET /api/rank/config": () => json(config),
    "GET /api/rank/me": () => json(me),
    "POST /api/rank/matches": start,
  });
  renderWithProviders(<RankHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rank", path: "/rank" });
  return mock;
}

describe("RankHomePage", () => {
  inChinese();

  it("shows the tier, stage tasks and season", async () => {
    setup();
    expect(await screen.findByTestId("rank-hero")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "黄金 I" }).textContent).toBe("黄金");
    expect(screen.getByTestId("tier-badge").dataset.tier).toBe("gold");
    expect(screen.getAllByTestId("stage-task")[0].dataset.complete).toBe("true");
    expect(screen.getByText("跟读 20 句且 ≥75 分")).toBeTruthy();
    expect(screen.getByTestId("rank-season").textContent).toContain("S1 赛季");
    expect(screen.getByTestId("rank-season").textContent).toContain("赛季积分 486");
    expect(screen.getAllByTestId("rank-event")[0].textContent).toBe("跟读+4");
    expect(screen.getByTestId("rank-achievements-link").getAttribute("href")).toBe("/rank/achievements");
  });

  it("names and explains the tier's CEFR level (plan 2026-10-14-level-annotations W16)", async () => {
    const tiers = [...CONTRACT.config.tiers, { key: "gold", index: 2, cefr: "B1+", divisions: 3, division_rp: 120 }];
    setup(CONTRACT.me, undefined, { ...CONTRACT.config, tiers });
    expect(await screen.findByTestId("rank-cefr")).toHaveTextContent("对齐 CEFR B1+ · 中级+");
    expect(screen.getByTestId("rank-cefr-hint")).toHaveTextContent("能应对大多数日常场景");
  });

  it("links unfinished stage tasks to their practice page", async () => {
    setup({ ...CONTRACT.me, stage_tasks: [{ key: "voice", kind: "voice_turns", done: 3, target: 20, min_score: null, complete: false }] });
    const row = (await screen.findAllByTestId("stage-task"))[0];
    expect(row.dataset.complete).toBe("false");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/chat");
    expect(row.textContent).toContain("3/20");
  });

  it("names the wordbook stage task and RP events", async () => {
    setup({
      ...CONTRACT.me,
      stage_tasks: [{ key: "words", kind: "words_learned", done: 12, target: 50, min_score: null, complete: false }],
      recent_events: [
        { kind: "spelling_set", points: 2, day: "2026-11-09", created_at: "2026-11-09T09:42:00+00:00" },
        { kind: "word_learned", points: 1, day: "2026-11-09", created_at: "2026-11-09T09:41:00+00:00" },
      ],
    });
    const row = (await screen.findAllByTestId("stage-task"))[0];
    expect(row.textContent).toContain("背单词学会 50 个新词");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/wordbook");
    expect(screen.getAllByTestId("rank-event").map((e) => e.textContent)).toEqual(["拼写练习+2", "学会新词+1"]);
  });

  it("starts a match and navigates to it", async () => {
    const mock = setup();
    fireEvent.click(await screen.findByTestId("rank-start"));
    await screen.findByText(`/rank/match/${CONTRACT.match.id}`);
    expect(mock.calls.find((c) => c.method === "POST")?.url.search).toMatch(/^\?tz_offset_minutes=-?\d+$/);
  });

  it("explains each locked state", async () => {
    setup({ ...CONTRACT.me, promotion: { ...CONTRACT.me.promotion, state: "locked", reason: "tasks" } });
    const card = await screen.findByTestId("promotion-card");
    expect(card.dataset.state).toBe("locked");
    expect(card.textContent).toContain("完成全部阶段练习后解锁");
    expect(screen.queryByTestId("rank-start")).toBeNull();
  });

  it("counts down a cooldown", async () => {
    const until = new Date(Date.now() + 65_000).toISOString();
    setup({ ...CONTRACT.me, promotion: { ...CONTRACT.me.promotion, state: "cooldown", cooldown_until: until } });
    expect((await screen.findByTestId("promotion-card")).textContent).toMatch(/冷却中,1:0\d 后可再战/);
  });

  it("refreshes when the cooldown runs out so the start button appears", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let mes = 0;
      const until = new Date(Date.now() + 3_000).toISOString();
      const cooling = { ...CONTRACT.me, promotion: { ...CONTRACT.me.promotion, state: "cooldown", cooldown_until: until } };
      const mock = createFetchMock({
        "GET /api/rank/config": () => json(CONTRACT.config),
        "GET /api/rank/me": () => { mes += 1; return json(mes === 1 ? cooling : { ...CONTRACT.me, new_achievements: [] }); },
      });
      renderWithProviders(<RankHomePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rank", path: "/rank" });
      await screen.findByTestId("promotion-card");
      expect(screen.queryByTestId("rank-start")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
      expect(await screen.findByTestId("rank-start")).toBeTruthy();
      expect(mes).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers resume when a match is in progress", async () => {
    setup({ ...CONTRACT.me, active_match_id: "m-1" });
    fireEvent.click(await screen.findByTestId("rank-resume"));
    expect(screen.getByTestId("location").textContent).toBe("/rank/match/m-1");
  });

  it("maps a server refusal to a message", async () => {
    setup(CONTRACT.me, () => json({ error: "No attempts left" }, 429));
    fireEvent.click(await screen.findByTestId("rank-start"));
    expect(await screen.findByText("今天的次数已用完")).toBeTruthy();
  });

  it("shows the disabled note when rank is off", async () => {
    setup(CONTRACT.me, undefined, { ...CONTRACT.config, enabled: false });
    expect(await screen.findByText("段位赛未开启。")).toBeTruthy();
    expect(screen.queryByTestId("rank-achievements-link")).toBeNull();
  });
});
