import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { encodeWavPcm16 } from "~/audio/wav";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { resetBestCache } from "./attempts-api";
import "./locales";
import { useShadowing, type UseShadowingOptions } from "./use-shadowing";

/** 已是 16 kHz 单声道 16 位的 WAV:toAssessmentWav 走直通路径,不需要解码。 */
const WAV = new Blob([encodeWavPcm16(new Float32Array(1600).fill(0.1), 16000)], { type: "audio/wav" });
const ASSESS = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 100,
  detail_result: { display: "Hello world.", words: [
    { word: "hello", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
    { word: "world", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
  ] },
  assessment_id: "a1",
};

/** 录音会话:result 在 stop() 时才完成(立即完成的 result 会被 useRecorder 当成「录音自己结束了」)。 */
function fakeStarter(log: string[], extra: Partial<RecordingResult> = {}) {
  return async (): Promise<RecordingSession> => {
    log.push("mic");
    let done!: (r: RecordingResult) => void;
    const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
    const stop = () => {
      done({ blob: WAV, mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user", ...extra });
      return result;
    };
    return { startedAt: 0, result, stop, cancel: vi.fn() };
  };
}

function setup(routes: Record<string, Handler>, extra: Partial<RecordingResult> = {}) {
  const log: string[] = [];
  const mock = createFetchMock({ "GET /api/library/items/i1/attempts": () => json([]), ...routes });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const pauseMedia = vi.fn(() => { log.push("pause"); });
  const initialProps: UseShadowingOptions = {
    itemId: "i1", segment: { idx: 3, text: "Hello world." }, pauseMedia, starter: fakeStarter(log, extra),
  };
  const hook = renderHook((p: UseShadowingOptions) => useShadowing(p), {
    initialProps, wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders>,
  });
  return { hook, mock, log, pauseMedia, initialProps };
}

const posts = (mock: ReturnType<typeof createFetchMock>, pathname: string) =>
  mock.calls.filter((c) => c.method === "POST" && c.url.pathname === pathname);

async function recordOnce(hook: ReturnType<typeof setup>["hook"]) {
  await act(async () => { await hook.result.current.toggle(); });
  expect(hook.result.current.phase).toBe("recording");
  await act(async () => { await hook.result.current.toggle(); });
}

describe("useShadowing (spec §11.4)", () => {
  beforeEach(() => {
    resetBestCache();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("pauses the media before the mic, assesses the exact sentence as source=library, then records the attempt", async () => {
    const { hook, mock, log } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ seg_idx: 3, best_score: 82, count: 1 }),
    });
    await recordOnce(hook);
    expect(log).toEqual(["pause", "mic"]);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    const form = posts(mock, "/api/speech/assessments")[0].body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("save")).toBe("true");
    expect(form.get("reference")).toBe("Hello world.");
    expect(form.get("language")).toBe("en-US");
    expect(JSON.parse(posts(mock, "/api/library/items/i1/attempts")[0].body as string)).toEqual({ seg_idx: 3, assessment_id: "a1" });
    expect(hook.result.current.result).toMatchObject({ segIdx: 3, assessmentId: "a1", attemptSaved: true, scores: { pronunciationScore: 82 } });
    expect(hook.result.current.result!.words.map((w) => w.word)).toEqual(["hello", "world"]);
    expect(hook.result.current.best).toMatchObject({ segIdx: 3, bestScore: 82, count: 1 });
    expect(hook.result.current.canPlayMine).toBe(true);
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("does not upload a recording without speech", async () => {
    const { hook, mock } = setup({ "POST /api/speech/assessments": () => json(ASSESS) }, { noSpeech: true });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("error"));
    expect(hook.result.current.error).toBe(i18n.t("web.library.shadow.noSpeech"));
    expect(posts(mock, "/api/speech/assessments")).toHaveLength(0);
  });

  it("shows the existing practice error when the recording quota is full and records nothing", async () => {
    const { hook, mock } = setup({ "POST /api/speech/assessments": () => json({ error: "Recording storage quota exceeded" }, 413) });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("error"));
    expect(hook.result.current.error).toBe(i18n.t("web.practice.errors.quota"));
    expect(posts(mock, "/api/library/items/i1/attempts")).toHaveLength(0);
    expect(hook.result.current.result).toBeNull();
  });

  it("still shows the score when recording the attempt fails, without a local best", async () => {
    const { hook } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ error: "boom" }, 500),
    });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    expect(hook.result.current.result!.attemptSaved).toBe(false);
    expect(hook.result.current.best).toBeNull();
  });

  it("drops a late result after the sentence changes", async () => {
    let release: (() => void) | undefined;
    const { hook, mock, initialProps } = setup({
      "POST /api/speech/assessments": () => new Promise<Response>((resolve) => { release = () => resolve(json(ASSESS)); }),
    });
    await act(async () => { await hook.result.current.toggle(); });
    act(() => { void hook.result.current.toggle(); });
    await waitFor(() => expect(release).toBeDefined());
    expect(hook.result.current.phase).toBe("assessing");
    hook.rerender({ ...initialProps, segment: { idx: 4, text: "Next one." } });
    expect(hook.result.current.phase).toBe("idle");
    await act(async () => {
      release!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hook.result.current.result).toBeNull();
    expect(hook.result.current.phase).toBe("idle");
    expect(posts(mock, "/api/library/items/i1/attempts")).toHaveLength(0);
  });

  it("shows the best score recorded earlier for the current sentence", async () => {
    const { hook } = setup({
      "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 3, best_score: 91.6, count: 2, last_at: "2026-10-13T00:00:00Z" }]),
    });
    await waitFor(() => expect(hook.result.current.best).toMatchObject({ segIdx: 3, bestScore: 91.6, count: 2 }));
  });

  it("asks for the best scores once, however often the panel remounts", async () => {
    const first = setup({});
    await waitFor(() => expect(first.mock.calls.filter((c) => c.url.pathname === "/api/library/items/i1/attempts")).toHaveLength(1));
    first.hook.unmount();
    const second = setup({});
    await new Promise((r) => setTimeout(r, 0));
    expect(second.mock.calls.filter((c) => c.url.pathname === "/api/library/items/i1/attempts")).toHaveLength(0);
  });

  it("plays my recording after pausing the media, and toggles it off", async () => {
    const { hook, pauseMedia } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({}),
    });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    act(() => hook.result.current.playMine());
    expect(pauseMedia).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(hook.result.current.playingMine).toBe(true);
    act(() => hook.result.current.playMine());
    expect(hook.result.current.playingMine).toBe(false);
  });
});
