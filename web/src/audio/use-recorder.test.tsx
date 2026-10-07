import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { useRecorder } from "./use-recorder";
import { defaultRecordingStarter } from "./use-recorder";

describe("useRecorder", () => {
  it("starts and stops", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(result.current.state).toBe("recording");
    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => { recording = await result.current.stop(); });
    expect(recording!.stoppedBy).toBe("user");
    expect(result.current.state).toBe("idle");
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it("cancels on unmount without calling onAutoStop", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result, unmount } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { await result.current.start(); });
    unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.track.stop).toHaveBeenCalled();
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it("releases the stream when unmounted while starting", async () => {
    let release!: () => void;
    const base = createFakeRecorderEnv();
    const fake = createFakeRecorderEnv({
      getUserMedia: (c) => new Promise((resolve) => { release = () => void base.env.getUserMedia!(c).then(resolve); }),
    });
    const { result, unmount } = renderHook(() => useRecorder({ env: fake.env }));
    let started: Promise<boolean>;
    act(() => { started = result.current.start(); });
    unmount();
    release();
    expect(await started!).toBe(false);
    expect(base.track.stop).toHaveBeenCalled();
    expect(fake.recorders[0].state).toBe("inactive");
  });

  it("ignores a second start() while one is in flight", async () => {
    const fake = createFakeRecorderEnv();
    const { result } = renderHook(() => useRecorder({ env: fake.env }));
    let results: boolean[] = [];
    await act(async () => { results = await Promise.all([result.current.start(), result.current.start()]); });
    expect(results).toEqual([true, false]);
    expect(fake.constraints).toHaveLength(1);
  });

  it("exposes start errors", async () => {
    const fake = createFakeRecorderEnv({ getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } });
    const { result } = renderHook(() => useRecorder({ env: fake.env }));
    await act(async () => { expect(await result.current.start()).toBe(false); });
    expect(result.current.error?.code).toBe("permission_denied");
    expect(result.current.state).toBe("idle");
  });

  it("reports automatic stops through onAutoStop only", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { await result.current.start(); });
    act(() => fake.setHidden());
    await waitFor(() => expect(onAutoStop).toHaveBeenCalledWith(expect.objectContaining({ stoppedBy: "background" })));
    expect(result.current.state).toBe("idle");
  });

  it("cancel discards the recording, releases the microphone and reports nothing", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { await result.current.start(); });
    act(() => result.current.cancel());
    await act(async () => { await Promise.resolve(); });
    expect(fake.track.stop).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(onAutoStop).not.toHaveBeenCalled();
    act(() => result.current.cancel()); // 空闲时调用无副作用
  });

  it("cancel during starting releases the stream once it arrives and start resolves false", async () => {
    let release!: () => void;
    const base = createFakeRecorderEnv();
    const fake = createFakeRecorderEnv({
      getUserMedia: (c) => new Promise((resolve) => { release = () => void base.env.getUserMedia!(c).then(resolve); }),
    });
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    let started: Promise<boolean>;
    act(() => { started = result.current.start(); });
    act(() => result.current.cancel());
    expect(result.current.state).toBe("idle");
    release();
    await act(async () => { expect(await started!).toBe(false); });
    expect(base.track.stop).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it("cancel while stopping discards the result and stop resolves null", async () => {
    const fake = createFakeRecorderEnv();
    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useRecorder({ env: fake.env, onAutoStop }));
    await act(async () => { await result.current.start(); });
    let stopped: Promise<unknown>;
    act(() => { stopped = result.current.stop(); });
    act(() => result.current.cancel());
    await act(async () => { expect(await stopped!).toBeNull(); });
    expect(fake.track.stop).toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it("a stale stop() settling after cancel + new start does not force idle", async () => {
    const fake = createFakeRecorderEnv();
    const { result } = renderHook(() => useRecorder({ env: fake.env, maxDurationMs: 0 }));
    await act(async () => { await result.current.start(); });
    fake.behavior.silentStop = true; // old stop stays pending until the fallback timer fires
    let stopped: Promise<unknown>;
    act(() => { stopped = result.current.stop(); });
    act(() => result.current.cancel());
    fake.behavior.silentStop = false;
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(result.current.state).toBe("recording");
    await act(async () => { fake.fireTimer(); expect(await stopped!).toBeNull(); });
    expect(result.current.state).toBe("recording");
    expect(fake.recorders[1].state).toBe("recording");
    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => { recording = await result.current.stop(); });
    expect(recording!.stoppedBy).toBe("user");
    expect(result.current.state).toBe("idle");
  });

  it("unmounting while stopping releases the microphone even if stop never completes", async () => {
    const fake = createFakeRecorderEnv();
    const { result, unmount } = renderHook(() => useRecorder({ env: fake.env }));
    await act(async () => { await result.current.start(); });
    fake.behavior.silentStop = true;
    act(() => { void result.current.stop(); });
    expect(fake.track.stop).not.toHaveBeenCalled();
    unmount();
    expect(fake.track.stop).toHaveBeenCalled();
  });
});

describe("injectable starter (plan 2026-10-07 Task 2.4)", () => {
  it("uses the given starter instead of MediaRecorder", async () => {
    const result = { blob: new Blob(["x"], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 500, stoppedBy: "user" as const };
    // R30:result 永不完成,否则 useRecorder 会把它当作自动停止处理
    const session = { startedAt: 0, result: new Promise<never>(() => {}), stop: vi.fn(async () => result), cancel: vi.fn() };
    const starter = vi.fn(async () => session);
    const { result: hook } = renderHook(() => useRecorder({ starter }));
    await act(async () => { await hook.current.start(); });
    expect(starter).toHaveBeenCalledWith({ maxDurationMs: expect.any(Number) });
    await act(async () => { expect(await hook.current.stop()).toBe(result); });
  });
});

describe("default starter (plan 2026-10-07 R9/R31)", () => {
  const session = { startedAt: 0, result: new Promise<never>(() => {}), stop: vi.fn(), cancel: vi.fn() };
  const deps = () => ({
    decide: vi.fn(),
    pcm: vi.fn(async () => session),
    legacy: vi.fn(async () => session),
  });

  it("records PCM on the running page-level context", async () => {
    const d = deps();
    const context = {} as AudioContext;
    d.decide.mockReturnValue({ mode: "pcm", context });
    await defaultRecordingStarter(undefined, d)({ maxDurationMs: 60_000 });
    expect(d.pcm).toHaveBeenCalledWith({ maxDurationMs: 60_000, context });
    expect(d.legacy).not.toHaveBeenCalled();
  });

  it("falls back to MediaRecorder when the page context is locked or unsupported", async () => {
    for (const reason of ["audio-locked", "unsupported"] as const) {
      const d = deps();
      d.decide.mockReturnValue({ mode: "media-recorder", reason });
      await defaultRecordingStarter(undefined, d)({ maxDurationMs: 1000 });
      expect(d.legacy).toHaveBeenCalledWith({ maxDurationMs: 1000 });
      expect(d.pcm).not.toHaveBeenCalled();
    }
  });

  it("keeps the MediaRecorder path for an injected recorder env without deciding", async () => {
    const d = deps();
    const fake = createFakeRecorderEnv();
    await defaultRecordingStarter(fake.env, d)({ maxDurationMs: 1000 });
    expect(d.legacy).toHaveBeenCalledWith({ maxDurationMs: 1000, env: fake.env });
    expect(d.decide).not.toHaveBeenCalled();
  });

  it("decides synchronously when start() is called (inside the gesture)", () => {
    const d = deps();
    d.decide.mockReturnValue({ mode: "media-recorder", reason: "audio-locked" });
    void defaultRecordingStarter(undefined, d)({});
    expect(d.decide).toHaveBeenCalledTimes(1);
  });
});
