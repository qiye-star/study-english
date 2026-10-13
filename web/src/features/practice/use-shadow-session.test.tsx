import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { useShadowSession, type ShadowSessionOptions } from "./use-shadow-session";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

const OK = {
  pronunciation_score: 88, accuracy_score: 90, fluency_score: 80, completeness_score: 100, assessment_id: "a1",
  detail_result: { words: [{ word: "hello", pronunciation_assessment: { accuracy_score: 99, error_type: "None" } }] },
};

function setup(routes: Record<string, Handler>, options: Partial<ShadowSessionOptions> = {}, envOverrides = {}) {
  const mock = createFetchMock(routes);
  const fake = createFakeRecorderEnv(envOverrides);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const view = renderHook(() => useShadowSession({ reference: "  Hello world  ", recorderEnv: fake.env, ...options }), { wrapper });
  return { mock, fake, ...view };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");

describe("useShadowSession", () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
  });

  it("records, assesses with save=true and no source, and keeps the scored words", async () => {
    const onAssessed = vi.fn();
    const { result, mock } = setup({ "POST /api/speech/assessments": () => json(OK) }, { onAssessed });
    expect(result.current.phase).toBe("idle");
    await act(async () => { await result.current.toggle(); });
    expect(result.current.phase).toBe("recording");
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(result.current.result).toEqual({
      assessmentId: "a1",
      scores: { pronunciationScore: 88, accuracyScore: 90, fluencyScore: 80, completenessScore: 100 },
      words: [{ word: "hello", accuracyScore: 99, errorType: "None" }],
    });
    expect(result.current.kept).toBeNull();
    expect(onAssessed).toHaveBeenCalledWith("a1");
    const form = assessCalls(mock)[0].body as FormData;
    expect(form.get("reference")).toBe("Hello world");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    expect(form.get("source")).toBeNull(); // R-S03:不带 source,成绩才会出现在练习历史里
  });

  it("keeps the recording after a failed upload and retries it", async () => {
    let attempt = 0;
    const { result, mock } = setup({
      "POST /api/speech/assessments": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json(OK)),
    });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toContain("assessment service is unavailable");
    expect(result.current.kept).not.toBeNull();
    await act(async () => { await result.current.assessKept(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(assessCalls(mock)).toHaveLength(2);
    expect(result.current.kept).toBeNull();
  });

  it("keeps audio that stopped in the background, and can discard it without uploading", async () => {
    const { result, mock, fake } = setup({});
    await act(async () => { await result.current.toggle(); });
    await act(async () => fake.setHidden());
    await waitFor(() => expect(result.current.kept).not.toBeNull());
    expect(result.current.phase).toBe("error");
    expect(result.current.kept?.stoppedBy).toBe("background");
    act(() => result.current.discardKept());
    expect(result.current.phase).toBe("idle");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("does not submit twice on a double tap", async () => {
    const { result, mock, fake } = setup({ "POST /api/speech/assessments": () => json(OK) });
    await act(async () => { await result.current.toggle(); });
    await act(async () => fake.setHidden());
    await waitFor(() => expect(result.current.kept).not.toBeNull());
    await act(async () => { void result.current.assessKept(); void result.current.assessKept(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("rejects a silent recording before upload when silenceError is set", async () => {
    const starter = async (): Promise<RecordingSession> => ({
      startedAt: 0,
      result: new Promise<RecordingResult>(() => undefined),
      stop: async () => ({ blob: new Blob(["x"]), mimeType: "audio/wav", durationMs: 400, stoppedBy: "user", noSpeech: true }),
      cancel: vi.fn(),
    });
    const { result, mock } = setup({}, { starter, silenceError: "quiet please" });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    expect(result.current.error).toBe("quiet please");
    expect(result.current.kept).toBeNull();
    expect(result.current.phase).toBe("error");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("calls beforeRecord synchronously before the microphone is requested", async () => {
    const order: string[] = [];
    const base = createFakeRecorderEnv();
    const env = { ...base.env, getUserMedia: async (c: MediaStreamConstraints) => { order.push("mic"); return base.env.getUserMedia!(c); } };
    const { result } = setup({}, { recorderEnv: env, beforeRecord: () => order.push("before") });
    await act(async () => { await result.current.toggle(); });
    expect(order).toEqual(["before", "mic"]);
  });

  it("keeps the assessed WAV as a blob URL only when keepAudio is on, and drops it on the next recording", async () => {
    const on = setup({ "POST /api/speech/assessments": () => json(OK) }, { keepAudio: true });
    await act(async () => { await on.result.current.toggle(); });
    await act(async () => { await on.result.current.toggle(); });
    await waitFor(() => expect(on.result.current.phase).toBe("result"));
    expect(on.result.current.mineUrl).toBe("blob:mine");
    await act(async () => { await on.result.current.toggle(); }); // 开始下一次录音
    expect(on.result.current.mineUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mine");
    on.unmount();

    vi.mocked(URL.createObjectURL).mockClear();
    const off = setup({ "POST /api/speech/assessments": () => json(OK) });
    await act(async () => { await off.result.current.toggle(); });
    await act(async () => { await off.result.current.toggle(); });
    await waitFor(() => expect(off.result.current.phase).toBe("result"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(off.result.current.mineUrl).toBeNull();
  });

  it("reset aborts the upload, drops the late response and returns to idle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { result, mock } = setup({ "POST /api/speech/assessments": async () => { await gate; return json(OK); } });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { void result.current.toggle(); }); // toggle 会等到上传结束,这里不 await
    await waitFor(() => expect(assessCalls(mock)).toHaveLength(1));
    expect(result.current.phase).toBe("assessing");
    const signal = assessCalls(mock)[0].signal!;
    act(() => result.current.reset());
    expect(signal.aborted).toBe(true);
    expect(result.current.phase).toBe("idle");
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("idle");
  });

  it("releases the microphone when unmounted mid-recording", async () => {
    const { result, fake, unmount } = setup({});
    await act(async () => { await result.current.toggle(); });
    expect(fake.track.stop).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
  });

  it("aborts the upload when unmounted mid-upload", async () => {
    const { result, mock, unmount } = setup({ "POST /api/speech/assessments": () => new Promise<Response>(() => undefined) });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { void result.current.toggle(); }); // toggle 会等到上传结束,这里不 await
    await waitFor(() => expect(assessCalls(mock)).toHaveLength(1));
    expect(assessCalls(mock)[0].signal?.aborted).toBe(false);
    unmount();
    expect(assessCalls(mock)[0].signal?.aborted).toBe(true);
  });
});
