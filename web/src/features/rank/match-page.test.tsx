import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import camelcaseKeys from "camelcase-keys";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { sharedTtsCache } from "~/features/chat";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { WithShadowSheet } from "~/features/practice/shadow/test-utils";
import { MatchPage } from "./match-page";
import { MatchResult } from "./match-result";
import type { Match, Verdict } from "./rank-api";
import { CONTRACT, inChinese } from "./test-contract";
import { SPEAK_TIMEOUT_MS, useMatch, type MatchDeps } from "./use-match";

const id = CONTRACT.match.id;
/** 与 ApiClient 相同:只转键名,不动值(gates_failed 里的 "task_low" 保持原样) */
const camel = (v: Record<string, unknown>) => camelcaseKeys(v, { deep: true }) as unknown as { match: Match; verdict: Verdict };

/** 真实朗读路径需要的服务端配置与合成接口 */
const TTS_ROUTES: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({}),
  "GET /api/config/default_gpt_preset": () => json({}),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
  "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
};
/** 最近一次被 play() 的 <audio>:play() 立即 resolve(开始播放),ended 由测试自己派发 */
let playing: HTMLMediaElement | null = null;
function fakeMedia() {
  playing = null;
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(function (this: HTMLMediaElement) { playing = this; return Promise.resolve(); }) });
}
const finishPlayback = () => act(() => { playing!.dispatchEvent(new Event("ended")); });
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
});

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
      <p data-testid="mic-error">{m.micError}</p>
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
    await waitFor(() => expect(phase()).toBe("your_turn")); // re-read from the server first
  });

  it("retrying a failed turn asks the server where the match stands instead of recording again", async () => {
    let gets = 0;
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => { gets += 1; return json({ match: gets === 1 ? CONTRACT.match : { ...CONTRACT.match, status: "expired" }, verdict: null }); },
      [`POST /api/rank/matches/${id}/turns`]: () => json({ error: "Match expired" }, 409),
    });
    renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("briefing"));
    fireEvent.click(screen.getByText("begin"));
    await waitFor(() => expect(phase()).toBe("your_turn"));
    await act(async () => { fireEvent.click(screen.getByText("press")); });
    await act(async () => { fireEvent.click(screen.getByText("release")); });
    await waitFor(() => expect(phase()).toBe("error"));
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(phase()).toBe("result")); // not an endless record -> 409 loop
    expect(gets).toBe(2);
  });

  it("a retried first turn the server never stored goes back to the turn, not the briefing", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }),
      [`POST /api/rank/matches/${id}/turns`]: () => json({ error: "Upstream unavailable" }, 502),
    });
    renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("briefing"));
    fireEvent.click(screen.getByText("begin"));
    await waitFor(() => expect(phase()).toBe("your_turn"));
    await act(async () => { fireEvent.click(screen.getByText("press")); });
    await act(async () => { fireEvent.click(screen.getByText("release")); });
    await waitFor(() => expect(phase()).toBe("error"));
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(phase()).toBe("your_turn"));
  });

  it("says why when the microphone can't start", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }) });
    const recordWav = () => ({ start: () => Promise.resolve(false), stop: () => Promise.resolve(null), cancel: (): void => undefined });
    renderWithProviders(<Harness deps={fakeDeps({ recordWav })} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("briefing"));
    fireEvent.click(screen.getByText("begin"));
    await waitFor(() => expect(phase()).toBe("your_turn"));
    expect(screen.getByTestId("mic-error").textContent).toBe("");
    await act(async () => { fireEvent.click(screen.getByText("press")); });
    expect(phase()).toBe("your_turn");
    expect(screen.getByTestId("mic-error").textContent).toBe("录音失败,请重试。");
  });

  it("a stalled examiner line gives the turn back after the safety timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }) });
      renderWithProviders(<Harness deps={fakeDeps({ speak: () => new Promise<void>(() => undefined) })} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
      await waitFor(() => expect(phase()).toBe("briefing"));
      fireEvent.click(screen.getByText("begin"));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(phase()).toBe("ai_speaking");
      await act(async () => { await vi.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS); });
      expect(phase()).toBe("your_turn");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the disabled message when rank is off and ends on abandon", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ error: "Rank is disabled" }, 404),
      [`POST /api/rank/matches/${id}/abandon`]: () => json({ match: CONTRACT.finish_fail.match }),
    });
    renderWithProviders(<Harness />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await waitFor(() => expect(phase()).toBe("disabled"));
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
    fakeMedia();
    resetServerAiConfigCache();
    sharedTtsCache.clear(); // each test synthesises (or fails to) for itself
  });

  it("briefs, then shows a voice-only dock with the partner line hidden until asked", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }), ...TTS_ROUTES });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-briefing")).textContent).toContain("共 6 轮,20 分钟内完成");
    fireEvent.click(screen.getByTestId("match-begin"));
    await screen.findByTestId("match-dock");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("match-ai-line").textContent).not.toContain("How can I help");
    fireEvent.click(screen.getByTestId("match-toggle-text"));
    expect(screen.getByTestId("match-ai-line").textContent).toContain("How can I help");
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));
    await settle();
    finishPlayback();
    await waitFor(() => expect(screen.getByTestId("match-hold")).not.toBeDisabled());
  });

  it("keeps the hold bar disabled until the examiner's line has finished playing, not when it starts", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }), ...TTS_ROUTES });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    fireEvent.click(await screen.findByTestId("match-begin"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));
    await settle();
    expect(playing?.src).toBe("blob:tts"); // the line has started playing
    expect(screen.getByTestId("match-turns").dataset.phase).toBe("ai_speaking");
    expect(screen.getByTestId("match-hold")).toBeDisabled();
    expect(screen.getByTestId("match-ai-line").textContent).toContain("正在说");
    finishPlayback();
    await waitFor(() => expect(screen.getByTestId("match-hold")).not.toBeDisabled());
    expect(screen.getByTestId("match-turns").dataset.phase).toBe("your_turn");
  });

  it("shows the examiner's line when it can't be played", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }), ...TTS_ROUTES,
      "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    fireEvent.click(await screen.findByTestId("match-begin"));
    await waitFor(() => expect(screen.getByTestId("match-hold")).not.toBeDisabled());
    expect(screen.getByTestId("match-ai-line").textContent).toContain("How can I help");
    expect(screen.getByTestId("match-speak-failed").textContent).toBe("没能播放对方的话,已显示文字。");
  });

  it("a match page with rank switched off shows the feature gate, not a retry", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ error: "Rank is disabled" }, 404) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect(await screen.findByText("段位赛未开启。")).toBeTruthy();
    expect(screen.queryByTestId("match-retry")).toBeNull();
  });

  it("shows the English scenario title in English", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "en" })); // inChinese()'s afterEach clears it
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ match: CONTRACT.match, verdict: null }) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    await screen.findByTestId("match-briefing");
    expect(screen.getByText(CONTRACT.match.scenario.title_en)).toBeTruthy();
    expect(screen.queryByText(CONTRACT.match.scenario.title_zh)).toBeNull();
  });

  it("a match whose grading failed offers both 重新打分 and 放弃 (it blocks new matches until one of them)", async () => {
    let finishes = 0;
    const graded = { ...CONTRACT.match, status: "grading_failed", turn_limit: 1, turns: [...CONTRACT.match.turns, { role: "user", text: "My kettle is broken." }] };
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json({ match: graded, verdict: null }),
      [`POST /api/rank/matches/${id}/finish`]: () => { finishes += 1; return json({ error: "Grading failed" }, 502); },
      [`POST /api/rank/matches/${id}/abandon`]: () => json({ match: { ...graded, status: "abandoned", finished_at: "2026-11-09T09:50:00+00:00" } }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-error")).textContent).toContain("评分失败,请重试");
    await waitFor(() => expect(finishes).toBe(1));
    expect(screen.getByTestId("match-retry").textContent).toContain("重新打分");
    expect(screen.getByTestId("match-error-abandon").textContent).toContain("放弃");
    fireEvent.click(screen.getByTestId("match-retry"));
    await waitFor(() => expect(finishes).toBe(2));
    await screen.findByTestId("match-error-abandon");
    await act(async () => { fireEvent.click(screen.getByTestId("match-error-abandon")); });
    expect(confirm).toHaveBeenCalled();
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/abandon"))).toHaveLength(1);
    expect(await screen.findByText("本场已结束")).toBeTruthy();
    confirm.mockRestore();
  });

  it("a failed load says 重试, not 重新打分", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json({ error: "Upstream unavailable" }, 502) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-retry")).textContent).toContain("重试");
    expect(screen.getByTestId("match-retry").textContent).not.toContain("重新打分");
    expect(screen.queryByTestId("match-error-abandon")).toBeNull(); // 没加载到场次:没有可放弃的
  });

  it("shows the result page for a finished match", async () => {
    const mock = createFetchMock({ [`GET /api/rank/matches/${id}`]: () => json(CONTRACT.finish_fail) });
    renderWithProviders(<MatchPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id" });
    expect((await screen.findByTestId("match-result")).dataset.passed).toBe("false");
    expect(screen.queryByTestId("match-dock")).toBeNull();
  });

  it("the drill opens the shadow sheet after saving the sentence, without navigating", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json(CONTRACT.finish_fail),
      "POST /api/practice-items": () => json({ id: "p1", text: "x", source: "manual", created_at: "2026-10-05T00:00:00+00:00" }),
    });
    renderWithProviders(<WithShadowSheet><MatchPage /></WithShadowSheet>, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id",
    });
    fireEvent.click(await screen.findByTestId("match-drill"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("I'd like a refund, please.");
    expect(screen.getByTestId("location")).toHaveTextContent(`/rank/match/${id}`);
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/practice-items")!.body as string)).toEqual({ text: "I'd like a refund, please.", source: "manual" });
  });
});
