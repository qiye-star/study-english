// 英英释义与释义显示偏好的运行时辅助(计划 2026-10-12-wordbook-definitions-web R-DW2 / R-DW4,AD-1)。
// 只被懒加载块引用:类型在 wordbook-api.ts(擦除),这里的运行时代码不进主包。
import type { ApiClient } from "~/api/client";
import type { DefEn, DefLang, WordbookConfig } from "./wordbook-api";

export const DEF_LANGS: readonly DefLang[] = ["both", "zh", "en"];
export const isDefLang = (v: unknown): v is DefLang => typeof v === "string" && (DEF_LANGS as readonly string[]).includes(v);

/** 配置里的偏好;老服务端没有这个键 / 值不认识 / 配置没到 → "both"。 */
export const defLangOf = (config: WordbookConfig | null): DefLang =>
  config?.enabled && isDefLang(config.defLang) ? config.defLang : "both";

/**
 * 保存偏好的端点(AD-1 覆盖 R-DW2:服务端没有 /settings,偏好随 `PATCH /api/wordbook/enrollment` 的 `def_lang` 写入;
 * 单独传时不需要有在学的书)。体里的 defLang 由 ApiClient 转成 def_lang;响应在原响应上多一个 `def_lang`。
 */
export const DEF_LANG_PATH = "/api/wordbook/enrollment";
export const saveDefLang = async (api: ApiClient, defLang: DefLang): Promise<{ defLang: DefLang }> => {
  const res = await api.request<{ defLang?: unknown }>("PATCH", DEF_LANG_PATH, { json: { defLang } });
  return { defLang: isDefLang(res?.defLang) ? res.defLang : defLang };
};

/** 每个词性最多显示几条英文释义(服务端也限 2 条;客户端再截一次作防御)。 */
export const MAX_DEFS_PER_POS = 2;

/** 服务端词性码 → 显示标签,与中文行的标签写法一致(posLabel:`n.` `v.` `adj.` `adv.` …)。 */
export const EN_POS_LABELS: Readonly<Record<string, string>> = {
  n: "n.", v: "v.", a: "adj.", r: "adv.", prep: "prep.", pron: "pron.", conj: "conj.", art: "art.", num: "num.", aux: "aux.", int: "int.",
};
export const DEF_POS_CODES: readonly string[] = Object.keys(EN_POS_LABELS);

export const enPosLabel = (pos: string): string =>
  Object.prototype.hasOwnProperty.call(EN_POS_LABELS, pos) ? EN_POS_LABELS[pos] : pos && !pos.endsWith(".") ? `${pos}.` : pos;

export interface DefGroup { pos: string; label: string; texts: string[] }

/** 按词性分组(保持服务端顺序),每组最多 MAX_DEFS_PER_POS 条,丢掉空文本;缺省 / 形状不对 → []。 */
export function groupDefs(defs: readonly DefEn[] | undefined): DefGroup[] {
  if (!Array.isArray(defs)) return [];
  const groups: DefGroup[] = [];
  for (const d of defs) {
    const text = typeof d?.text === "string" ? d.text.trim() : "";
    if (!text || typeof d.pos !== "string") continue;
    let group = groups.find((g) => g.pos === d.pos);
    if (!group) {
      group = { pos: d.pos, label: enPosLabel(d.pos), texts: [] };
      groups.push(group);
    }
    if (group.texts.length < MAX_DEFS_PER_POS) group.texts.push(text);
  }
  return groups;
}
