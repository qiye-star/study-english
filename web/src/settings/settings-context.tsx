import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import i18n, { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { readJson, writeJson } from "~/lib/storage";

const KEY = "enjoy-web.settings";

interface SettingsValue {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
  /** 「我的 → 联机语音自动转文字」(spec 2026-10-10 §4.7,R2-9:存在本设备,默认关) */
  roomVoiceAutoText: boolean;
  setRoomVoiceAutoText(value: boolean): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

interface StoredSettings { language?: unknown; roomVoiceAutoText?: unknown }
const isObject = (v: unknown): v is StoredSettings => typeof v === "object" && v !== null && !Array.isArray(v);

/** 逐项校验存储(旧版本只有 language;损坏的项各自回落默认值,不连累另一项)。 */
function readStored(): { language: UiLanguage | null; roomVoiceAutoText: boolean } {
  const raw = readJson(KEY, isObject);
  const language = SUPPORTED_LANGUAGES.includes(raw?.language as UiLanguage) ? (raw?.language as UiLanguage) : null;
  return { language, roomVoiceAutoText: raw?.roomVoiceAutoText === true };
}

export function detectLanguage(navLang?: string): UiLanguage {
  const lang = (navLang ?? "").toLowerCase();
  if (lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("es")) return "es";
  return "en";
}

export function nativeLanguageCode(language: UiLanguage): "en-US" | "zh-CN" | "es-ES" {
  return language === "zh-CN" ? "zh-CN" : language === "es" ? "es-ES" : "en-US";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(() => {
    const initial = readStored().language ?? detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
    // 资源是内联的,changeLanguage 同步生效;放在初始化器里避免首屏先闪一下默认语言。
    if (i18n.language !== initial) void i18n.changeLanguage(initial);
    return initial;
  });
  const [roomVoiceAutoText, setAutoTextState] = useState(() => readStored().roomVoiceAutoText);
  // 两项共用一个存储键:写一项时带上另一项的当前值
  const current = useRef({ language, roomVoiceAutoText });
  current.current = { language, roomVoiceAutoText };
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    current.current = { ...current.current, language: next };
    writeJson(KEY, current.current);
  }, []);
  const setRoomVoiceAutoText = useCallback((next: boolean) => {
    setAutoTextState(next);
    current.current = { ...current.current, roomVoiceAutoText: next };
    writeJson(KEY, current.current);
  }, []);
  const value = useMemo(() => ({ language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText }),
    [language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
