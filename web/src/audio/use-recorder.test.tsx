import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { useRecorder } from "./use-recorder";

describe("useRecorder", () => {
  it("starts and stops", async () => {
    const fake = createFakeRecorderEnv();
    const { result } = renderHook(() => useRecorder({ env: fake.env }));
    await act(async () => { expect(await result.current.start()).toBe(true); });
    expect(result.current.state).toBe("recording");
    let recording: Awaited<ReturnType<typeof result.current.stop>> = null;
    await act(async () => { recording = await result.current.stop(); });
    expect(recording!.stoppedBy).toBe("user");
    expect(result.current.state).toBe("idle");
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
