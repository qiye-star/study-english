import { describe, expect, it } from "vitest";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { RecorderError, startRecording } from "./recorder";

describe("startRecording", () => {
  it("refuses insecure contexts and missing APIs", async () => {
    await expect(startRecording({ env: createFakeRecorderEnv({ isSecureContext: false }).env })).rejects.toMatchObject({ code: "insecure_context" });
    await expect(startRecording({ env: createFakeRecorderEnv({ MediaRecorder: undefined }).env })).rejects.toMatchObject({ code: "unsupported" });
    await expect(startRecording({ env: createFakeRecorderEnv({ getUserMedia: undefined }).env })).rejects.toMatchObject({ code: "unsupported" });
  });

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "no_device"],
    ["NotReadableError", "mic_busy"],
    ["AbortError", "failed"],
  ])("maps getUserMedia %s to %s", async (name, code) => {
    const { env } = createFakeRecorderEnv({ getUserMedia: async () => { throw Object.assign(new Error(name), { name }); } });
    const err = await startRecording({ env }).catch((e) => e);
    expect(err).toBeInstanceOf(RecorderError);
    expect(err.code).toBe(code);
  });

  it("requests processed audio and lets the browser choose the format", async () => {
    const fake = createFakeRecorderEnv();
    await startRecording({ env: fake.env });
    expect(fake.constraints[0]).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    expect(fake.recorders[0].options).toBeUndefined();
    expect(fake.recorders[0].timeslice).toBe(1000);
  });

  it("stop() returns the collected audio and releases the microphone", async () => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env });
    fake.recorders[0].emit([1, 2]);
    fake.advance(2500);
    const result = await session.stop();
    expect(result).toMatchObject({ mimeType: "audio/mp4", durationMs: 2500, stoppedBy: "user" });
    expect(result.blob.size).toBe(3);
    expect(result.blob.type).toBe("audio/mp4");
    expect(fake.track.stop).toHaveBeenCalled();
    expect(await session.stop()).toBe(result);
  });

  it.each([
    ["max_duration", (f: ReturnType<typeof createFakeRecorderEnv>) => f.fireTimer()],
    ["background", (f: ReturnType<typeof createFakeRecorderEnv>) => f.setHidden()],
    ["track_ended", (f: ReturnType<typeof createFakeRecorderEnv>) => f.track.fireEnded()],
  ] as const)("stops automatically on %s and keeps the data", async (reason, trigger) => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env, maxDurationMs: 300_000 });
    fake.recorders[0].emit([1, 2, 3]);
    trigger(fake);
    const result = await session.result;
    expect(result.stoppedBy).toBe(reason);
    expect(result.blob.size).toBe(4);
  });

  it("releases everything and throws RecorderError(failed) when start() throws", async () => {
    const fake = createFakeRecorderEnv();
    fake.behavior.startError = Object.assign(new Error("boom"), { name: "InvalidStateError" });
    const err = await startRecording({ env: fake.env, maxDurationMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(RecorderError);
    expect(err.code).toBe("failed");
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.track.listenerCount()).toBe(0);
    expect(fake.docListenerCount()).toBe(0);
    expect(fake.pendingTimers()).toBe(0);
  });

  it("cancel() stops, releases the mic and settles with stoppedBy user", async () => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env, maxDurationMs: 1000 });
    expect(fake.docListenerCount()).toBe(1);
    session.cancel();
    expect((await session.result).stoppedBy).toBe("user");
    expect(fake.track.stop).toHaveBeenCalled();
    expect(fake.docListenerCount()).toBe(0);
    expect(fake.track.listenerCount()).toBe(0);
    expect(fake.pendingTimers()).toBe(0);
  });

  it("keeps chunks when the recorder errors after recording something", async () => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env });
    fake.recorders[0].emit([1, 2]);
    fake.emitError(fake.recorders[0]);
    const result = await session.result;
    expect(result.blob.size).toBe(2);
    expect(result.stoppedBy).toBe("track_ended");
    expect(fake.track.stop).toHaveBeenCalled();
  });

  it("rejects with failed when the recorder errors with no data", async () => {
    const fake = createFakeRecorderEnv();
    const session = await startRecording({ env: fake.env });
    fake.emitError(fake.recorders[0]);
    await expect(session.result).rejects.toMatchObject({ code: "failed" });
    expect(fake.track.stop).toHaveBeenCalled();
  });

  it("force-finishes via the fallback timer when the stop event never fires", async () => {
    const fake = createFakeRecorderEnv();
    fake.behavior.silentStop = true;
    const session = await startRecording({ env: fake.env });
    fake.recorders[0].emit([1]);
    const pending = session.stop();
    expect(fake.track.stop).not.toHaveBeenCalled();
    fake.fireTimer();
    const result = await pending;
    expect(result.blob.size).toBe(1);
    expect(fake.track.stop).toHaveBeenCalled();
  });
});
