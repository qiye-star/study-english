import type { ApiClient } from "./client";

export type VoiceAccent = "us" | "gb" | "other";

export interface VoiceOption {
  label: string;
  value: string;
  language?: string;
  accent?: VoiceAccent;
}

export interface ServerAiConfig {
  llmModels: string[];
  defaultLlmModel: string;
  ttsModels: string[];
  voices: Record<string, VoiceOption[]>;
  defaultTts: { model: string; voice: string };
}

type RawVoice = string | { label?: string; value?: string; language?: string; accent?: string } | null;

/** 口音:优先用服务端给的 accent;否则由 language(en-US / en-GB)或音色 id 里的 "british" 推断;没有语言信息则为 undefined */
export function deriveAccent(value: string, language?: string, given?: string): VoiceAccent | undefined {
  if (given === "us" || given === "gb" || given === "other") return given;
  const lang = language?.toLowerCase();
  if (lang === "en-gb" || value.toLowerCase().includes("british")) return "gb";
  if (lang === "en-us") return "us";
  return lang ? "other" : undefined;
}

export function normalizeVoices(raw: Record<string, RawVoice[]> | undefined): Record<string, VoiceOption[]> {
  const out: Record<string, VoiceOption[]> = {};
  for (const [provider, list] of Object.entries(raw ?? {})) {
    out[provider] = (Array.isArray(list) ? list : []).flatMap((voice): VoiceOption[] => {
      if (typeof voice === "string") return [{ label: voice, value: voice }];
      if (voice && typeof voice.value === "string") {
        const accent = deriveAccent(voice.value, voice.language, voice.accent);
        return [{
          label: voice.label ?? voice.value, value: voice.value,
          ...(voice.language ? { language: voice.language } : {}),
          ...(accent ? { accent } : {}),
        }];
      }
      return [];
    });
  }
  return out;
}

/** 第三个参数:语言前缀(字符串,兼容旧调用)或 { language, accent };accent 过滤不回退(没有该口音就是空) */
export function voicesFor(config: ServerAiConfig, ttsModel: string, opts: string | { language?: string; accent?: "us" | "gb" } = "en"): VoiceOption[] {
  const { language = "en", accent } = typeof opts === "string" ? { language: opts } : opts;
  const list = config.voices[ttsModel.split("/")[0]] ?? [];
  const matching = list.filter((v) => !v.language || v.language.toLowerCase().startsWith(language.toLowerCase()));
  const base = matching.length ? matching : list;
  return accent ? base.filter((v) => v.accent === accent) : base;
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
