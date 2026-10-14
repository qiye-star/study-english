import type { TFunction } from "i18next";

/**
 * CEFR 级别的显示文字(计划 2026-10-14-level-annotations R-LV1–R-LV5)。只管「给人看的字」:
 * 存储、提交、URL 里的值永远是原样的代码。`t` 由调用方传入(文案在 components/i18n 的 web.level.*)。
 * 注意:chat/levels.ts 的 levelHint() 是给 AI 的提示词,与这里无关。
 */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export interface ParsedLevel { base: CefrLevel; plus: boolean }

const PATTERN = /^([ABC][12])(\+)?$/;

/** "B1" / " b1+ " → { base, plus };其他(含 "auto"、空、非字符串)→ null。 */
export function parseLevel(code: unknown): ParsedLevel | null {
  if (typeof code !== "string") return null;
  const m = PATTERN.exec(code.trim().toUpperCase());
  return m ? { base: m[1] as CefrLevel, plus: m[2] === "+" } : null;
}

/** 级别名:「中级」;段位的 "B1+" →「中级+」;未知 → null。 */
export function levelName(t: TFunction, code: unknown): string | null {
  const p = parseLevel(code);
  return p ? `${t(`web.level.name.${p.base}`)}${p.plus ? "+" : ""}` : null;
}

/** 行内标注:「B1 · 中级」;未知值原样(去首尾空格),空 / 非字符串 → ""。 */
export function levelLabel(t: TFunction, code: unknown): string {
  const p = parseLevel(code);
  if (!p) return typeof code === "string" ? code.trim() : "";
  return `${p.base}${p.plus ? "+" : ""} · ${levelName(t, code)}`;
}

/** 一句话说明(「能应对大多数日常场景」);带 + 的用基础级别的说明;未知 → null。 */
export function levelMeaning(t: TFunction, code: unknown): string | null {
  const p = parseLevel(code);
  return p ? t(`web.level.meaning.${p.base}`) : null;
}
