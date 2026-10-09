import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import camelcaseKeys from "camelcase-keys";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MatchPage } from "./match-page";
import { MatchResult } from "./match-result";
import type { Match, Verdict } from "./rank-api";
import { CONTRACT, inChinese } from "./test-contract";
import { useMatch, type MatchDeps } from "./use-match";

const id = CONTRACT.match.id;
/** 与 ApiClient 相同:只转键名,不动值(gates_failed 里的 "task_low" 保持原样) */
const camel = (v: Record<string, unknown>) => camelcaseKeys(v, { deep: true }) as unknown as { match: Match; verdict: Verdict };

const fakeDeps = (over: Partial<MatchDeps> = {}): MatchDeps => ({
  speak: () => Promise.resolve(),
  recordWav: () => ({ start: () => Promise.resolve(true), stop: () => Promise.resolve(new Blob([new Uint8Array(44)])), cancel: () => undefined }),
  ...over,
});

function Harness({ deps = fakeDeps() }: { deps?: MatchDeps }) {
  const m = useMatch(id, deps);
  return (
    <div>
      <p data-testid="phase">{m.state.phase}</p>
      <p data-testid="error">{m.state.error}</p>
      <button onClick={m.begin}>begin</button>
      <button onClick={() => void m.press()}>press</button>
      <button onClick={m.release}>release</button>
      <button onClick={m.retry}>retry</button>
      <button onClick={() => void m.abandon()}>abandon</button>
    </div>
  );
}

const phase = () => screen.getByTestId("phase").textContent;

describe("useMatch", () => {
  inChinese();
  beforeEach(() => {
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("plays a full two-turn match against the API", async () => {
    let turn = 0;
    const speak = vi.fn(() => Promise.resolve());
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ match: { ...CONTRACT.match, turn_limit: 2 }, verdict: null }),
      [`POST /api/rank/matches/${id}/turns`]: () => { turn += 1; return json({ ...CONTRACT.turn, turn_index: turn, done: turn === 2, ai_line: turn === 2 ? null : "Go on." }); },
      [`POST /api/rank/matches/${id}/finish`]: () => json(CONTRACT.finish_pass),
    });
    renderWithProviders(<Harness deps={fakeDeps({ speak })} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("briefing"));
    fireEvent.click(screen.getByText("begin"));
    for (let i = 0; i < 2; i += 1) {
      await waitFor(() => expect(phase()).toBe("your_turn"));
      await act(async () => { fireEvent.click(screen.getByText("press")); });
      await act(async () => { fireEvent.click(screen.getByText("release")); });
    }
    await waitFor(() => expect(phase()).toBe("result"));
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/turns"))).toHaveLength(2);
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/finish"))).toHaveLength(1);
    expect(speak.mock.calls.map((c) => (c as unknown[])[1])).toEqual([CONTRACT.match.turns[0].text, "Go on."]);
  });

  it("reports a too-short recording and lets the user retry the turn", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }),
      [`POST /api/rank/matches/${id}/turns`]: () => json({ error: "Audio too short" }, 400),
    });
    renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("briefing"));
    fireEvent.click(screen.getByText("begin"));
    await waitFor(() => expect(phase()).toBe("your_turn"));
    await act(async () => { fireEvent.click(screen.getByText("press")); });
    await act(async () => { fireEvent.click(screen.getByText("release")); });
    await waitFor(() => expect(phase()).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("说得太短了,至少 1.5 秒");
    fireEvent.click(screen.getByText("retry"));
    expect(phase()).toBe("your_turn");
  });

  it("shows the disabled message when rank is off and ends on abandon", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ error: "Rank is disabled" }, 404),
      [`POST /api/rank/matches/${id}/abandon`]: () => json({ match: CONTRACT.finish_fail.match }),
    });
    renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("error"));
    expect(screen.getByTestId("error").textContent).toBe("段位赛未开启。");
    await act(async () => { fireEvent.click(screen.getByText("abandon")); });
    expect(phase()).toBe("result");
  });
});

describe("MatchResult", () => {
  inChinese();

  it("celebrates a pass in green and lists dimensions", () => {
    const pass = camel(CONTRACT.finish_pass)
    renderWithProviders(<MatchResult match={pass.match} verdict={pass.verdict} onDrill={vi.fn()} />);
    expect(screen.getByTestId("match-result").dataset.passed).toBe("true");
    expect(screen.getByText("晋级成功").className).toContain("text-green");
    expect(screen.getAllByTestId("dimension")).toHaveLength(5);
    expect(screen.getAllByTestId("dimension")[4].textContent).toContain("81");
    expect(screen.getByTestId("tier-badge").dataset.tier).toBe("platinum");
  });

  it("explains a fail without red and offers the drill", () => {
    const fail = camel(CONTRACT.finish_fail)
    const onDrill = vi.fn();
    renderWithProviders(<MatchResult match={fail.match} verdict={fail.verdict} onDrill={onDrill} />);
    expect(screen.getByText("差一点")).toBeTruthy();
    expect(screen.getByText("任务完成不足")).toBeTruthy();
    expect(screen.getByTestId("match-result").innerHTML).not.toMatch(/text-red|bg-red/);
    fireEvent.click(screen.getByTestId("match-drill"));
    expect(onDrill).toHaveBeenCalledWith("I'd like a refund, please.");
  });

  it("drops the speech bar when pronunciation was not scored", () => {
    const pass = camel(CONTRACT.finish_pass)
    const verdict: Verdict = { ...pass.verdict, speechAvailable: false, dimensions: { ...pass.verdict.dimensions, speech: null } };
    renderWithProviders(<MatchResult match={pass.match} verdict={verdict} onDrill={vi.fn()} />);
    expect(screen.getAllByTestId("dimension")).toHaveLength(4);
    expect(screen.getByText("本场未评发音")).toBeTruthy();
  });

  it("says the match ended when there is no verdict", () => {
    const fail = camel(CONTRACT.finish_fail)
    renderWithProviders(<MatchResult match={{ ...fail.match, status: "abandoned" }} verdict={null} onDrill={vi.fn()} />);
    expect(screen.getByText("本场已结束")).toBeTruthy();
  });
});

describe("MatchPage", () => {
  inChinese();
  beforeEach(() => {
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("briefs, then shows a voice-only dock with the partner line hidden until asked", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-briefing")).textContent).toContain("共 6 轮,20 分钟内完成");
    fireEvent.click(screen.getByTestId("match-begin"));
    await screen.findByTestId("match-dock");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("match-ai-line").textContent).not.toContain("How can I help");
    fireEvent.click(screen.getByTestId("match-toggle-text"));
    expect(screen.getByTestId("match-ai-line").textContent).toContain("How can I help");
    await waitFor(() => expect(screen.getByTestId("match-hold")).not.toBeDisabled());
  });

  it("shows the result page for a finished match", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json(CONTRACT.finish_fail) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-result")).dataset.passed).toBe("false");
    expect(screen.queryByTestId("match-dock")).toBeNull();
  });
});
