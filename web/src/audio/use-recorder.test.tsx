import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { useRecorder } from "./use-recorder";

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
});
