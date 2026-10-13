import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import i18n, { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { readJson, writeJson } from "~/lib/storage";
import { DEFAULT_COLOR_SCHEME, SETTINGS_KEY, isColorScheme, type ColorScheme } from "./color-scheme-pref";

interface SettingsValue {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
  /** 「我的 → 联机语音自动转文字」(spec 2026-10-10 §4.7,R2-9:存在本设备,默认关) */
  roomVoiceAutoText: boolean;
  setRoomVoiceAutoText(value: boolean): void;
  /** 「我的 → 外观」(spec 2026-10-13 D12:存在本设备,默认跟随系统);应用到 html.dark 由 layout/color-scheme-sync 负责 */
  colorScheme: ColorScheme;
  setColorScheme(value: ColorScheme): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

interface StoredSettings { language?: unknown; roomVoiceAutoText?: unknown; colorScheme?: unknown }
const isObject = (v: unknown): v is StoredSettings => typeof v === "object" && v !== null && !Array.isArray(v);

interface Stored { language: UiLanguage | null; roomVoiceAutoText: boolean; colorScheme: ColorScheme }

/** 逐项校验存储(旧版本只有 language;损坏的项各自回落默认值,不连累其他项)。 */
function readStored(): Stored {
  const raw = readJson(SETTINGS_KEY, isObject);
  const language = SUPPORTED_LANGUAGES.includes(raw?.language as UiLanguage) ? (raw?.language as UiLanguage) : null;
  const scheme = raw?.colorScheme;
  return {
    language,
    roomVoiceAutoText: raw?.roomVoiceAutoText === true,
    colorScheme: isColorScheme(scheme) ? scheme : DEFAULT_COLOR_SCHEME,
  };
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
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>(() => readStored().colorScheme);
  // 三项共用一个存储键:写一项时带上其余项的当前值
  const current = useRef({ language, roomVoiceAutoText, colorScheme });
  current.current = { language, roomVoiceAutoText, colorScheme };
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  const persist = useCallback((patch: Partial<typeof current.current>) => {
    current.current = { ...current.current, ...patch };
    writeJson(SETTINGS_KEY, current.current);
  }, []);
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    persist({ language: next });
  }, [persist]);
  const setRoomVoiceAutoText = useCallback((next: boolean) => {
    setAutoTextState(next);
    persist({ roomVoiceAutoText: next });
  }, [persist]);
  const setColorScheme = useCallback((next: ColorScheme) => {
    setColorSchemeState(next);
    persist({ colorScheme: next });
  }, [persist]);
  const value = useMemo(
    () => ({ language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme }),
    [language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
