import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { encodeWavPcm16 } from "~/audio/wav";
import { LookupLayer } from "~/features/lookup";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { resetAnalysisCache } from "./analysis-card";
import { resetBestCache } from "./attempts-api";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { SegmentText, ShadowPanel, mergeSaved, type ShadowPanelProps } from "./shadow-panel";
import type { PlayerHandle } from "./use-media-player";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi, Toaster: (): null => null }));

const WAV = new Blob([encodeWavPcm16(new Float32Array(1600).fill(0.1), 16000)], { type: "audio/wav" });
const ASSESS = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 100,
  detail_result: { display: "Hello world.", words: [
    { word: "hello", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
    { word: "world", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
  ] },
  assessment_id: "a1",
};
// spec §9 的 GET /api/library/config(ai = D8 增补,§5.2)
const CONFIG = (ai: boolean) => ({
  enabled: true, link_import: false, asr: false, ai,
  limits: { max_upload_mb: 500, max_duration_minutes: 90, quota_mb: 2000, used_bytes: 0, max_items: 100, chunk_bytes: 8_388_608, formats: ["mp4", "mp3"] },
});
const SEG = { idx: 1, startMs: 1000, endMs: 3000, text: "Hello world." } as LibrarySegment;

function starter() {
  return async (): Promise<RecordingSession> => {
    let done!: (r: RecordingResult) => void;
    const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
    const stop = () => {
      done({ blob: WAV, mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user" });
      return result;
    };
    return { startedAt: 0, result, stop, cancel: vi.fn() };
  };
}

const makePlayer = () => ({ pause: vi.fn(), playOnce: vi.fn(), seekTo: vi.fn(), getState: vi.fn() }) as unknown as PlayerHandle;

function setup(routes: Record<string, Handler> = {}, over: Partial<ShadowPanelProps> = {}, ai = true) {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(CONFIG(ai)),
    "GET /api/library/items/i1/attempts": () => json([]),
    ...routes,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const props: ShadowPanelProps = {
    itemId: "i1", segment: SEG, active: true, durationMs: 10_000, prevEndMs: 900, nextStartMs: 3300,
    player: makePlayer(), onSegmentSaved: vi.fn(), starter: starter(), ...over,
  };
  const tree = (p: ShadowPanelProps) => (
    <TestProviders api={api}>
      <SegmentText segment={p.segment} active={p.active} />
      <ShadowPanel {...p} />
    </TestProviders>
  );
  const view = render(tree(props));
  return { mock, props, view, rerender: (next: Partial<ShadowPanelProps>) => view.rerender(tree({ ...props, ...next })) };
}

describe("SegmentText (spec §11.4 点词查词, plan W2 R-SH15)", () => {
  afterEach(() => document.getSelection()?.removeAllRanges());

  it("renders one lookup context of tappable words; a word tap selects it and does not trigger the row's tap-to-play", () => {
    const rowTap = vi.fn();
    render(<div onClick={rowTap}><SegmentText segment={SEG} active /></div>);
    const sentence = document.querySelector("[data-lookup-context]") as HTMLElement;
    expect(sentence).toHaveTextContent("Hello world.");
    expect(sentence).toHaveAttribute("data-segment-text", "1");
    fireEvent.click(sentence.querySelector('[data-word="1"]') as HTMLElement);
    expect(document.getSelection()!.toString()).toBe("world");
    expect(rowTap).not.toHaveBeenCalled();
    fireEvent.click(sentence); // 点在词之外:照常冒泡给 W1 的容器(跳播)
    expect(rowTap).toHaveBeenCalledTimes(1);
  });

  it("makes the real LookupLayer show its selection action bar after a word is tapped", async () => {
    const api = new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({}).fetch });
    render(<TestProviders api={api}><SegmentText segment={SEG} active /><LookupLayer /></TestProviders>);
    fireEvent.click(document.querySelector('[data-word="0"]') as HTMLElement);
    expect(await screen.findByTestId("lookup-bar", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("lookup-trigger")).toBeInTheDocument();
  });
});

describe("ShadowPanel (spec §11.4, D8; plan W2 R-SH03)", () => {
  beforeEach(() => {
    resetBestCache();
    resetAnalysisCache();
    toastApi.success.mockClear();
    toastApi.info.mockClear();
    toastApi.error.mockClear();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.getSelection()?.removeAllRanges();
  });

  it("renders controls only for the active row", () => {
    const { view } = setup({}, { active: false });
    expect(view.container.querySelector("[data-shadow-row]")).toBeNull();
    expect(screen.queryByTestId("shadow-panel")).toBeNull();
    expect(screen.queryByTestId("shadow-record")).toBeNull();
  });

  it("records, scores, rolls the score up and colours the words of the sentence, then shows the new best", async () => {
    const { mock, props } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ seg_idx: 1, best_score: 82, count: 1 }),
    });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await waitFor(() => expect(screen.getByTestId("shadow-record")).toHaveAttribute("data-state", "recording"));
    expect(props.player!.pause).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("assessment-scores")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("score-main")).toHaveTextContent("82"), { timeout: 3000 });
    const sentence = document.querySelector("[data-lookup-context]") as HTMLElement;
    expect((sentence.querySelector('[data-word="0"]') as HTMLElement).className).toContain("text-green");
    expect((sentence.querySelector('[data-word="1"]') as HTMLElement).className).toContain("underline");
    const form = mock.calls.find((c) => c.url.pathname === "/api/speech/assessments")!.body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("reference")).toBe("Hello world.");
    expect(await screen.findByTestId("shadow-best")).toHaveTextContent("Best 82");
    expect(screen.getByTestId("shadow-mine")).not.toBeDisabled();
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("clears the score card and the word colours when another sentence becomes current", async () => {
    const { rerender } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({}),
    });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await waitFor(() => expect(screen.getByTestId("shadow-record")).toHaveAttribute("data-state", "recording"));
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("assessment-scores")).toBeInTheDocument();
    act(() => rerender({ segment: { ...SEG, idx: 2, text: "Next one." } as LibrarySegment }));
    expect(screen.queryByTestId("assessment-scores")).toBeNull();
    expect(document.querySelector('[data-word="0"]')!.className).not.toContain("text-green");
  });

  it("plays the original sentence through the player, and disables it without a player", async () => {
    const { props } = setup();
    await userEvent.click(screen.getByTestId("shadow-listen"));
    expect(props.player!.playOnce).toHaveBeenCalledWith(1);
  });

  it("disables listening to the original while the media is not ready", () => {
    setup({}, { player: null });
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
  });

  it("shows the best score from earlier attempts", async () => {
    setup({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 91.6, count: 2, last_at: null }]) });
    expect(await screen.findByTestId("shadow-best")).toHaveTextContent("Best 92");
  });

  it("saves the sentence to the practice list from the menu", async () => {
    const { mock } = setup({ "POST /api/practice-items": () => json({ id: "p1", text: "Hello world.", source: "library", created_at: "x" }) });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/practice-items")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/practice-items")!.body as string)).toEqual({ text: "Hello world.", source: "library" });
  });

  it("opens the AI analysis card from the menu and requests it once", async () => {
    const { mock } = setup({ "POST /api/library/items/i1/segments/1/analysis": () => json({ analysis: "### Grammar\nbe going to", cached: false }) });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-analysis"));
    expect(await screen.findByTestId("analysis-card")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/analysis"))).toHaveLength(1);
  });

  it("hides the AI analysis item when the server has the AI features off", async () => {
    const { mock } = setup({}, {}, false);
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/library/config")).toBe(true));
    await new Promise((r) => setTimeout(r, 50)); // 让配置的响应落到钩子里:否则「还没加载」与「关闭」分不开
    await userEvent.click(screen.getByTestId("shadow-more"));
    await screen.findByTestId("menu-copy");
    expect(screen.queryByTestId("menu-analysis")).toBeNull();
  });

  it("adjusts timing from the menu and hands the saved sentence to the player list", async () => {
    const { props } = setup({
      "PATCH /api/library/items/i1/segments/1": () => json({ segment: { idx: 1, start_ms: 1000, end_ms: 3200, text: "Hello world.", zh: "你好,世界。", zh_lang: "zh-CN", has_analysis: false, analysis_lang: null } }),
    }, { segment: { ...SEG, zh: "你好,世界。", zhLang: "zh-CN" } as LibrarySegment });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-edit"));
    expect(await screen.findByTestId("segment-editor")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("segment-end-later"));
    await userEvent.click(screen.getByTestId("segment-save"));
    await waitFor(() => expect(props.onSegmentSaved).toHaveBeenCalledTimes(1));
    expect(props.onSegmentSaved).toHaveBeenCalledWith({ ...SEG, endMs: 3200, zh: "你好,世界。", zhLang: "zh-CN" });
    await waitFor(() => expect(screen.queryByTestId("segment-editor")).toBeNull());
  });

  it("clears the stored translation and analysis flag when the text is edited (E11)", () => {
    const base = { ...SEG, zh: "你好,世界。", zhLang: "zh-CN", hasAnalysis: true, analysisLang: "zh-CN" } as LibrarySegment;
    expect(mergeSaved(base, { idx: 1, startMs: 1000, endMs: 3000, text: "Hello there." })).toEqual({
      ...SEG, text: "Hello there.", zh: null, zhLang: null, hasAnalysis: false, analysisLang: null,
    });
    expect(mergeSaved(base, { idx: 1, startMs: 1200, endMs: 3000, text: "Hello world." })).toEqual({ ...base, startMs: 1200 });
  });
});
