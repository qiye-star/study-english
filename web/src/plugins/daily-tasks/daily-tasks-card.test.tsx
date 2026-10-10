import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { GOAL_MET_TODAY, PAUSED_TODAY } from "~/features/wordbook/goals-test-fixtures";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "daily_tasks"])) as LinkFlags["links"] };
const PLAN = { new_target: 20, new_done: 20, new_left: 0, review_due: 30, review_done: 12, review_left: 18, backlog_guard: false };
const TASKS: Record<string, unknown>[] = [
  { key: "assess", kind: "assess", done: 3, target: 3, min_score: null, complete: true },
  { key: "chat", kind: "chat_turns", done: 4, target: 10, min_score: null, complete: false },
];
const ME: Record<string, unknown> = {
  tier: "silver", tier_index: 1, division: 2, rp: 126, division_rp: 200, stars: 0, stage_tasks: TASKS,
  promotion: { state: "locked", reason: "rp", cooldown_until: null, attempts_left: 3, target_tier: null },
  season: null, season_rp: 0, recent_events: [], new_achievements: [], active_match_id: null,
};

function client(overrides: Record<string, () => Response> = {}) {
  const mock = createFetchMock({
    "GET /api/links/today": () => json({ practice_today: 1, chat_messages_today: 0, conversations_today: 0 }),
    "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }),
    "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: PLAN, progress: null, tomorrow_due: 0 }),
    "GET /api/rank/config": () => json({ enabled: false, match_available: false, tiers: [], season: null }),
    ...overrides,
  });
  return { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), calls: mock.calls };
}

const rankOn = {
  "GET /api/rank/config": () => json({ enabled: true, match_available: false, tiers: [], season: null }),
  "GET /api/rank/me": () => json(ME),
};

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("今日任务卡", () => {
  it("renders nothing while the link is off", () => {
    const { api, calls } = client();
    const { container } = renderWithProviders(<Slot point="practiceHome" props={{}} />, { api });
    expect(container.querySelector("[data-testid=daily-tasks-card]")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("renders nothing when only another link is on", () => {
    setLinkFlags({ enabled: true, links: { ...ON.links, daily_tasks: false, mistakes: true } });
    const { container } = renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client().api });
    expect(container.querySelector("[data-testid=daily-tasks-card]")).toBeNull();
  });

  it("aggregates the providers and counts what is done", async () => {
    setLinkFlags(ON);
    renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client().api });
    const card = await screen.findByTestId("daily-tasks-card");
    await waitFor(() => expect(screen.getByTestId("daily-task-practice.shadow")).toHaveAttribute("data-state", "done"));
    await waitFor(() => expect(screen.getByTestId("daily-task-wordbook.today")).toHaveAttribute("data-state", "todo"));
    expect(screen.getByTestId("daily-task-wordbook.today")).toHaveTextContent("复习 12/30");
    expect(screen.getByTestId("daily-task-chat.talk")).toHaveAttribute("data-state", "todo");
    expect(screen.queryByTestId("daily-task-rank.stage")).toBeNull(); // rank is off on this server
    await waitFor(() => expect(card).toHaveTextContent("1/3 完成"));
    expect(screen.getByRole("link", { name: /跟读一句,已完成/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /对话一次,0\/1/ })).toHaveAttribute("href", "/chat");
    expect(screen.getByRole("link", { name: /背单词,32\/50/ })).toHaveAttribute("href", "/wordbook");
    const ids = [...card.querySelectorAll("[data-testid^=daily-task-]")].map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual(["daily-task-wordbook.today", "daily-task-practice.shadow", "daily-task-chat.talk"]);
  });

  it("uses the wordbook goal (bonus words do not undo it) and hides the row while paused", async () => {
    setLinkFlags(ON);
    const bonus = { ...GOAL_MET_TODAY, plan: { ...GOAL_MET_TODAY.plan, new_left: 5, bonus: 5 } };
    const first = renderWithProviders(<Slot point="practiceHome" props={{}} />,
      { api: client({ "GET /api/wordbook/today": () => json(bonus) }).api });
    await waitFor(() => expect(screen.getByTestId("daily-task-wordbook.today")).toHaveAttribute("data-state", "done"));
    expect(screen.getByRole("link", { name: /背单词,已完成/ })).toBeInTheDocument();
    first.unmount();

    renderWithProviders(<Slot point="practiceHome" props={{}} />,
      { api: client({ "GET /api/wordbook/today": () => json(PAUSED_TODAY) }).api });
    await waitFor(() => expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("1/2 完成"));
    expect(screen.queryByTestId("daily-task-wordbook.today")).toBeNull();
  });

  it("has no wordbook row while the wordbook is disabled", async () => {
    setLinkFlags(ON);
    const { calls } = (() => {
      const c = client({ "GET /api/wordbook/config": () => json({ enabled: false, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }) });
      renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: c.api });
      return c;
    })();
    await waitFor(() => expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("1/2 完成"));
    expect(screen.queryByTestId("daily-task-wordbook.today")).toBeNull();
    expect(calls.some((c) => c.url.pathname === "/api/wordbook/today")).toBe(false);
  });

  it("shows the rank stage tasks and reuses /api/rank/me for 30 seconds per client", async () => {
    setLinkFlags(ON);
    const c = client(rankOn);
    const first = renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: c.api });
    const row = await screen.findByTestId("daily-task-rank.stage");
    expect(row).toHaveAttribute("data-state", "todo");
    expect(row).toHaveTextContent("阶段任务 1/2");
    expect(screen.getByRole("link", { name: /段位阶段任务,1\/2/ })).toHaveAttribute("href", "/rank");
    await waitFor(() => expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("1/4 完成"));
    first.unmount();
    renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: c.api });
    await screen.findByTestId("daily-task-rank.stage");
    expect(c.calls.filter((x) => x.url.pathname === "/api/rank/me")).toHaveLength(1);
  });

  it("marks the rank row done when every stage task is complete", async () => {
    setLinkFlags(ON);
    const all = { ...ME, stage_tasks: TASKS.map((x) => ({ ...x, done: x.target, complete: true })) };
    renderWithProviders(<Slot point="practiceHome" props={{}} />,
      { api: client({ ...rankOn, "GET /api/rank/me": () => json(all) }).api });
    await waitFor(() => expect(screen.getByTestId("daily-task-rank.stage")).toHaveAttribute("data-state", "done"));
  });

  it("shows a dash on the rows that need today's counts when they fail to load", async () => {
    setLinkFlags(ON);
    renderWithProviders(<Slot point="practiceHome" props={{}} />,
      { api: client({ "GET /api/links/today": () => json({ error: "Link is off" }, 404) }).api });
    const shadow = await screen.findByTestId("daily-task-practice.shadow");
    await waitFor(() => expect(screen.getByTestId("daily-task-wordbook.today")).toBeInTheDocument());
    expect(shadow).toHaveAttribute("data-state", "todo");
    expect(shadow).toHaveTextContent("—");
    expect(screen.getByTestId("daily-task-chat.talk")).toHaveTextContent("—");
    expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("0/3 完成");
  });

  it("scrolls to the shadowing area from the shadowing row", async () => {
    setLinkFlags(ON);
    const target = document.createElement("div");
    target.id = "shadowing";
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    try {
      renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client().api, route: "/practice" });
      fireEvent.click(await screen.findByRole("link", { name: /跟读一句/ }));
      expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      target.remove();
    }
  });

  it("is in English when the language is English", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" }));
    await i18n.changeLanguage("en");
    setLinkFlags(ON);
    renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client().api });
    await waitFor(() => expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("1/3 done"));
    expect(screen.getByTestId("daily-tasks-card")).toHaveTextContent("Today's tasks");
  });
});
