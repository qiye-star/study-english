import { useSyncExternalStore } from "react";
import type { ServerAiConfig } from "~/api/server-config";
import { TTS_VOICE_PREF_KEY, readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 朗读音色偏好(「我的 → 朗读音色」,路由 /me/voice):按场景存一对 {model, voice},没存的场景跟随服务端默认 ai.defaultTts。
 * - word:单词 / 短语朗读(词汇、单词本、听写、选词朗读)
 * - sentence:句子朗读(跟读范读、拼写句子)
 * - message:对话消息朗读与自动朗读(对话页会话里显式选过音色时,那个音色优先,见 features/chat)
 * 只存在本机,不上传;没有 React 依赖的部分可以在任何地方用。
 */
export const TTS_SCENES = ["word", "sentence", "message"] as const;
export type TtsScene = (typeof TTS_SCENES)[number];

export interface TtsVoiceChoice {
  model: string;
  voice: string;
}

export type TtsVoicePref = Partial<Record<TtsScene, TtsVoiceChoice>>;

/** 解析音色只需要的服务端配置片段(ServerAiConfig 的子集,便于测试) */
export type TtsVoiceSource = Pick<ServerAiConfig, "voices" | "defaultTts"> | null;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 逐项校验:只有 model、voice 都是非空字符串的场景才保留,其余丢弃(不连累其他场景)。 */
function parseChoice(value: unknown): TtsVoiceChoice | undefined {
  if (!isObject(value)) return undefined;
  const { model, voice } = value;
  return typeof model === "string" && typeof voice === "string" && model !== "" && voice !== "" ? { model, voice } : undefined;
}

export function parseTtsVoicePref(raw: unknown): TtsVoicePref {
  if (!isObject(raw)) return {};
  const out: TtsVoicePref = {};
  for (const scene of TTS_SCENES) {
    const choice = parseChoice(raw[scene]);
    if (choice) out[scene] = choice;
  }
  return out;
}

// 内存副本:useSyncExternalStore 要求同一份快照引用稳定,所以只在变化时换新对象
let current: TtsVoicePref | null = null;
const listeners = new Set<() => void>();

export function getTtsVoicePref(): TtsVoicePref {
  if (!current) current = parseTtsVoicePref(readJson(TTS_VOICE_PREF_KEY, isObject));
  return current;
}

/** 设置某个场景的音色;传 null 表示恢复「默认」(跟随服务端)。存储失败时内存里仍然生效。 */
export function setTtsVoice(scene: TtsScene, choice: TtsVoiceChoice | null): void {
  const next: TtsVoicePref = { ...getTtsVoicePref() };
  const valid = parseChoice(choice);
  if (valid) next[scene] = valid;
  else delete next[scene];
  current = next;
  if (Object.keys(next).length === 0) removeKey(TTS_VOICE_PREF_KEY);
  else writeJson(TTS_VOICE_PREF_KEY, next);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 登出(auth/device-data)或测试:丢掉内存副本,下次从存储重新读。 */
export function resetTtsVoicePrefMemory(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

export function useTtsVoicePref(): { pref: TtsVoicePref; setTtsVoice: typeof setTtsVoice } {
  const pref = useSyncExternalStore(subscribe, getTtsVoicePref, getTtsVoicePref);
  return { pref, setTtsVoice };
}

/**
 * 场景里存的音色,但仅当它仍在服务端的音色列表里(同一个 provider 前缀下)才有效;否则 null(已下架、换了服务端等)。
 * ai 还没加载时也是 null。
 */
export function storedTtsVoice(scene: TtsScene, ai: TtsVoiceSource, pref: TtsVoicePref = getTtsVoicePref()): TtsVoiceChoice | null {
  const choice = pref[scene];
  if (!ai || !choice) return null;
  const list = ai.voices[choice.model.split("/")[0]] ?? [];
  return list.some((v) => v.value === choice.voice) ? choice : null;
}

/** 场景实际用的音色:存的有效音色,否则服务端默认。ai 未加载时返回空串(调用方据此跳过朗读)。 */
export function resolveTtsVoice(scene: TtsScene, ai: TtsVoiceSource, pref: TtsVoicePref = getTtsVoicePref()): TtsVoiceChoice {
  return storedTtsVoice(scene, ai, pref) ?? { model: ai?.defaultTts.model ?? "", voice: ai?.defaultTts.voice ?? "" };
}
