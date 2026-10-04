import type { ApiClient } from "./client";

export interface VoiceOption {
  label: string;
  value: string;
  language?: string;
}

export interface ServerAiConfig {
  llmModels: string[];
  defaultLlmModel: string;
  ttsModels: string[];
  voices: Record<string, VoiceOption[]>;
  defaultTts: { model: string; voice: string };
}

type RawVoice = string | { label?: string; value?: string; language?: string } | null;

export function normalizeVoices(raw: Record<string, RawVoice[]> | undefined): Record<string, VoiceOption[]> {
  const out: Record<string, VoiceOption[]> = {};
  for (const [provider, list] of Object.entries(raw ?? {})) {
    out[provider] = (Array.isArray(list) ? list : []).flatMap((voice): VoiceOption[] => {
      if (typeof voice === "string") return [{ label: voice, value: voice }];
      if (voice && typeof voice.value === "string") {
        return [{ label: voice.label ?? voice.value, value: voice.value, ...(voice.language ? { language: voice.language } : {}) }];
      }
      return [];
    });
  }
  return out;
}

export function voicesFor(config: ServerAiConfig, ttsModel: string, languagePrefix = "en"): VoiceOption[] {
  const list = config.voices[ttsModel.split("/")[0]] ?? [];
  const matching = list.filter((v) => !v.language || v.language.toLowerCase().startsWith(languagePrefix.toLowerCase()));
  return matching.length ? matching : list;
}

let cached: Promise<ServerAiConfig> | null = null;

export function resetServerAiConfigCache(): void {
  cached = null;
}

export function loadServerAiConfig(api: ApiClient): Promise<ServerAiConfig> {
  if (!cached) {
    cached = Promise.all([
      api.getConfig<any>("gpt_providers"),
      api.getConfig<any>("default_gpt_preset"),
      api.getConfig<any>("tts_providers_v2"),
      api.getConfig<any>("default_tts_preset"),
    ])
      .then(([gpt, gptPreset, tts, ttsPreset]): ServerAiConfig => {
        const ttsModels: string[] = tts?.enjoyai?.models ?? [];
        return {
          llmModels: gpt?.enjoyai?.models ?? [],
          defaultLlmModel: gptPreset?.configuration?.model ?? "",
          ttsModels,
          voices: normalizeVoices(tts?.enjoyai?.voices),
          defaultTts: {
            model: ttsPreset?.configuration?.tts?.model ?? ttsModels[0] ?? "",
            voice: ttsPreset?.configuration?.tts?.voice ?? "",
          },
        };
      })
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}
