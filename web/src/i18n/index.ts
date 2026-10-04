import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enjoyEn from "@/i18n/en.json";
import enjoyEs from "@/i18n/es.json";
import enjoyZh from "@/i18n/zh-CN.json";

export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "es"] as const;
export type UiLanguage = (typeof SUPPORTED_LANGUAGES)[number];

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function deepMerge(target: Dict, source: Dict): Dict {
  const out: Dict = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isDict(value) && isDict(out[key]) ? deepMerge(out[key] as Dict, value) : value;
  }
  return out;
}

// 各目录自带的 i18n/<语言>.json(裁定 R11),新增功能不必改本文件。
const webFiles = import.meta.glob<Dict>("../**/i18n/*.json", { eager: true, import: "default" });

export function webMessages(lang: "en" | "zh-CN"): Dict {
  return Object.entries(webFiles)
    .filter(([file]) => file.endsWith(`/${lang}.json`))
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Dict>((acc, [, dict]) => deepMerge(acc, dict), {});
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: deepMerge(enjoyEn as Dict, webMessages("en")) },
    "zh-CN": { translation: deepMerge(enjoyZh as Dict, webMessages("zh-CN")) },
    es: { translation: enjoyEs as Dict },
  },
  lng: "en",
  supportedLngs: [...SUPPORTED_LANGUAGES],
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
});

export default i18n;
