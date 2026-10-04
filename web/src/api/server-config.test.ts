import { beforeEach, describe, expect, it } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient } from "./client";
import { loadServerAiConfig, normalizeVoices, resetServerAiConfigCache, voicesFor, type ServerAiConfig } from "./server-config";

const ROUTES = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o-mini", "gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({
    enjoyai: {
      models: ["openai/tts-1", "azure/speech"],
      voices: {
        openai: ["alloy", "echo"],
        azure: [
          { label: "Ava (Female)", value: "en-US-AvaNeural", language: "en-US" },
          { label: "Katja (Female)", value: "de-DE-KatjaNeural", language: "de-DE" },
        ],
      },
    },
  }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

describe("server AI config", () => {
  beforeEach(() => resetServerAiConfigCache());

  it("maps the four config snapshots", async () => {
    const mock = createFetchMock(ROUTES);
    const config = await loadServerAiConfig(new ApiClient({ getToken: () => null, fetchImpl: mock.fetch }));
    expect(config).toEqual({
      llmModels: ["gpt-4o-mini", "gpt-4o"],
      defaultLlmModel: "gpt-4o",
      ttsModels: ["openai/tts-1", "azure/speech"],
      voices: {
        openai: [{ label: "alloy", value: "alloy" }, { label: "echo", value: "echo" }],
        azure: [
          { label: "Ava (Female)", value: "en-US-AvaNeural", language: "en-US" },
          { label: "Katja (Female)", value: "de-DE-KatjaNeural", language: "de-DE" },
        ],
      },
      defaultTts: { model: "openai/tts-1", voice: "alloy" },
    });
  });

  it("deduplicates and caches, but retries after a failure", async () => {
    let fail = true;
    const mock = createFetchMock({ ...ROUTES, "GET /api/config/gpt_providers": () => (fail ? json({ error: "x" }, 500) : json({ enjoyai: { models: [] } })) });
    const api = new ApiClient({ getToken: () => null, fetchImpl: mock.fetch });
    await expect(loadServerAiConfig(api)).rejects.toBeTruthy();
    fail = false;
    const [a, b] = await Promise.all([loadServerAiConfig(api), loadServerAiConfig(api)]);
    expect(a).toBe(b);
    const before = mock.calls.length;
    await loadServerAiConfig(api);
    expect(mock.calls.length).toBe(before);
  });

  it("filters voices by provider and language, falling back to all", () => {
    const config: ServerAiConfig = {
      llmModels: [], defaultLlmModel: "", ttsModels: [], defaultTts: { model: "", voice: "" },
      voices: normalizeVoices({ azure: [{ label: "K", value: "de-DE-K", language: "de-DE" }, { label: "A", value: "en-US-A", language: "en-US" }], openai: ["alloy"] }),
    };
    expect(voicesFor(config, "azure/speech").map((v) => v.value)).toEqual(["en-US-A"]);
    expect(voicesFor(config, "openai/tts-1").map((v) => v.value)).toEqual(["alloy"]);
    expect(voicesFor(config, "azure/speech", "fr").map((v) => v.value)).toEqual(["de-DE-K", "en-US-A"]);
    expect(voicesFor(config, "volcengine/seed-tts-2.0")).toEqual([]);
  });
});
