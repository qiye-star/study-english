import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { synthesizeSpeech, transcribe } from "./speech-api";

describe("speech api", () => {
  it("transcribes a WAV via the server whisper endpoint", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello", segments: [] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await transcribe(api, new Blob(["RIFF"], { type: "audio/wav" }))).toMatchObject({ text: "hello" });
    const form = mock.calls[0].body as FormData;
    expect((form.get("file") as File).name).toBe("recording.wav");
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("json");
  });
  it("omits the language hint when asked and forwards the abort signal", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hi" }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await transcribe(api, new Blob(["RIFF"]), null);
    expect((mock.calls[0].body as FormData).has("language")).toBe(false);
    const controller = new AbortController();
    controller.abort();
    await transcribe(api, new Blob(["RIFF"]), null, controller.signal).catch((): void => undefined);
    expect(mock.calls[1].signal?.aborted).toBe(true); // 调用方的 signal 传到了 fetch
  });

  it("synthesizes speech as a blob", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "audio/mpeg" } }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect((await synthesizeSpeech(api, { input: "Hi", model: "openai/tts-1", voice: "alloy" })).size).toBe(2);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ input: "Hi", model: "openai/tts-1", voice: "alloy" });
  });
});
