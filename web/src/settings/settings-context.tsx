import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import i18n, { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { readJson, writeJson } from "~/lib/storage";

const KEY = "enjoy-web.settings";

interface SettingsValue {
  language: UiLanguage;
  setLanguage(language: UiLanguage): void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

const isSettings = (v: unknown): v is { language: UiLanguage } =>
  SUPPORTED_LANGUAGES.includes((v as { language?: UiLanguage })?.language as UiLanguage);

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
    const initial = readJson(KEY, isSettings)?.language ?? detectLanguage(typeof navigator === "undefined" ? undefined : navigator.language);
    // 资源是内联的,changeLanguage 同步生效;放在初始化器里避免首屏先闪一下默认语言。
    if (i18n.language !== initial) void i18n.changeLanguage(initial);
    return initial;
  });
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    writeJson(KEY, { language: next });
  }, []);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
