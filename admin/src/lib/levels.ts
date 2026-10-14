/**
 * CEFR 级别的中文说明(计划 2026-10-14-level-annotations R-LV8)。管理后台不能导入网页代码,所以自带一份;
 * 必须与 web/src/components/i18n/zh-CN.json 的 web.level 逐字一致(levels.test.ts 读那个文件比对)。
 * 只用于显示:存储与提交的值不变。
 */
export const LEVELS_ZH: Record<string, { name: string; meaning: string }> = {
  A1: { name: "入门", meaning: "能听懂、会用最常用的词和简单句" },
  A2: { name: "初级", meaning: "能进行简单的日常交流" },
  B1: { name: "中级", meaning: "能应对大多数日常场景" },
  B2: { name: "中高级", meaning: "能流利地讨论熟悉的话题" },
  C1: { name: "高级", meaning: "能自如地表达复杂的想法" },
  C2: { name: "精通", meaning: "接近母语,几乎没有障碍" },
};

function parse(code: string | null | undefined): { base: string; plus: boolean } | null {
  const m = /^([ABC][12])(\+)?$/.exec((code ?? "").trim().toUpperCase());
  return m ? { base: m[1], plus: m[2] === "+" } : null;
}

/** 「B1 · 中级」;未知原样,空 → ""。 */
export function levelText(code: string | null | undefined): string {
  const p = parse(code);
  if (!p) return (code ?? "").trim();
  return `${p.base}${p.plus ? "+" : ""} · ${LEVELS_ZH[p.base].name}${p.plus ? "+" : ""}`;
}

/** 「B1 · 中级(能应对大多数日常场景)」,用于下拉选项;未知同 levelText。 */
export function levelLong(code: string | null | undefined): string {
  const p = parse(code);
  return p ? `${levelText(code)}(${LEVELS_ZH[p.base].meaning})` : levelText(code);
}
