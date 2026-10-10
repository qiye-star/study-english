import { act, renderHook, waitFor } from "@testing-library/react";
import camelcaseKeys from "camelcase-keys";
import { StrictMode, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { GOALS_ENROLLMENT, GOALS_TODAY, LIMITS } from "./goals-test-fixtures";
import { optimistic, useGoals } from "./use-goals";
import type { Today } from "./wordbook-api";

const today = () => camelcaseKeys(GOALS_TODAY, { deep: true }) as unknown as Today;

describe("optimistic (plan GP-4)", () => {
  it("raises today's new words at once and keeps progress", () => {
    const next = optimistic(today(), { dailyNew: 35 }, LIMITS);
    expect(next.enrollment?.dailyNew).toBe(35);
    expect(next.plan).toMatchObject({ newTarget: 35, newDone: 8, newLeft: 27 });
    expect(next.progress).toEqual(today().progress);
  });

  it("lowers below today's count without going negative", () => {
    expect(optimistic(today(), { dailyNew: 5 }, LIMITS).plan).toMatchObject({ newLeft: 0, newDone: 8 });
  });

  it("switches to unlimited reviews and back", () => {
    const unlimited = optimistic(today(), { reviewUnlimited: true }, LIMITS);
    expect(unlimited.enrollment).toMatchObject({ reviewUnlimited: true, reviewCap: 0 });
    expect(unlimited.plan?.reviewLeft).toBe(34);
    const capped = optimistic(unlimited, { reviewCap: 20 }, LIMITS);
    expect(capped.enrollment).toMatchObject({ reviewUnlimited: false, reviewCap: 20 });
    // reviewCap 20、到期 34 > 20 → 积压;已学 8 ≥ 5 → 还能学 0
    expect(capped.plan).toMatchObject({ reviewLeft: 20, backlogGuard: true, newLeft: 0 });
  });

  it("leaves a day without an active book alone", () => {
    const paused: Today = { ...today(), enrollment: null, plan: null };
    expect(optimistic(paused, { dailyNew: 5 }, LIMITS)).toBe(paused);
  });
});

/** useGoals 的宿主:today 放在 state 里,和首页用 useWordbookToday 时一样。 */
function harness(routes: Parameters<typeof createFetchMock>[0], { strict = false } = {}) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const reload = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <TestProviders api={api}>{children}</TestProviders>;
    return strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  const view = renderHook(() => {
    const [state, setState] = useState<Today>(today());
    return { state, goals: useGoals({ today: state, setToday: setState, reload, limits: LIMITS }) };
  }, { wrapper });
  return { mock, reload, view };
}

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("useGoals (spec §12.2)", () => {
  it("shows the change at once and reloads from the server after success", async () => {
    let release!: () => void;
    const { view, reload } = harness({
      "PATCH /api/wordbook/enrollment": () => new Promise((r) => { release = () => r(json(GOALS_ENROLLMENT)); }),
    });
    let done!: Promise<boolean>;
    act(() => { done = view.result.current.goals.patch({ dailyNew: 30 }); });
    expect(view.result.current.state.plan?.newLeft).toBe(22);
    expect(view.result.current.goals.saving).toBe(true);
    await act(async () => { release(); expect(await done).toBe(true); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(view.result.current.goals.saving).toBe(false);
    expect(view.result.current.goals.error).toBeNull();
  });

  it("rolls back a refused change and translates the reason", async () => {
    const { view, reload } = harness({ "PATCH /api/wordbook/enrollment": () => json({ error: "Review cap out of range" }, 422) });
    await act(async () => { expect(await view.result.current.goals.patch({ reviewCap: 20 })).toBe(false); });
    expect(view.result.current.state.enrollment?.reviewCap).toBe(100);
    expect(view.result.current.state.plan?.reviewLeft).toBe(34);
    expect(view.result.current.goals.error).toBe("每日复习上限超出允许范围");
    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores an older response that lands after a newer change", async () => {
    const pending: ((r: Response) => void)[] = [];
    const { view, reload } = harness({ "PATCH /api/wordbook/enrollment": () => new Promise((r) => { pending.push(r); }) });
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => { first = view.result.current.goals.patch({ dailyNew: 30 }); });
    act(() => { second = view.result.current.goals.patch({ dailyNew: 50 }); });
    expect(view.result.current.state.enrollment?.dailyNew).toBe(50);
    // 旧请求失败:不能把新值改回去
    await act(async () => { pending[0](json({ error: "Too many settings changes today" }, 429)); await first; });
    expect(view.result.current.state.enrollment?.dailyNew).toBe(50);
    expect(view.result.current.goals.error).toBeNull();
    expect(view.result.current.goals.saving).toBe(true);
    await act(async () => { pending[1](json(GOALS_ENROLLMENT)); await second; });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(view.result.current.goals.saving).toBe(false);
  });

  it("does not update optimistically for extra words and reports the reason", async () => {
    const { view, reload, mock } = harness({ "POST /api/wordbook/bonus": () => json({ error: "Finish today's new words first" }, 409) });
    await act(async () => { expect(await view.result.current.goals.bonus(10)).toBeNull(); });
    expect(view.result.current.state).toEqual(today());
    expect(view.result.current.goals.error).toBe("先学完今天的新词再加练");
    expect(view.result.current.goals.busy).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect(mock.calls).toHaveLength(1);
  });

  it("sends exactly one request per action under StrictMode (double-mount regression)", async () => {
    const { view, mock, reload } = harness({
      "PATCH /api/wordbook/enrollment": () => json(GOALS_ENROLLMENT),
      "POST /api/wordbook/enrollment/pause": () => json({ ...GOALS_ENROLLMENT, status: "paused" }),
    }, { strict: true });
    await act(async () => { await view.result.current.goals.patch({ dailyNew: 30 }); });
    await act(async () => { await view.result.current.goals.pause(); });
    expect(mock.calls.map((c) => `${c.method} ${c.url.pathname}`))
      .toEqual(["PATCH /api/wordbook/enrollment", "POST /api/wordbook/enrollment/pause"]);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(view.result.current.goals.saving).toBe(false);
  });
});
